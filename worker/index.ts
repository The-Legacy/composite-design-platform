/**
 * Cloudflare Worker: serves the SPA (via static assets) and the /api/* routes.
 *
 * Every request is authenticated with the caller's Supabase access token, and every
 * database read/write goes through a Supabase client that carries that token, so
 * Postgres RLS decides what the user is allowed to touch. R2 is only accessed after
 * the matching database row has been authorized.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { guessKind, guessMime, isFileKind, type FileKind } from "../shared/fileTypes";

interface Env {
  FILES: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  MAX_UPLOAD_MB?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json({ ok: true });

      const db = await authenticate(request, env);
      const path = url.pathname;
      let m: RegExpMatchArray | null;

      if (path === "/api/files" && request.method === "POST") return await uploadFile(request, url, env, db);
      if (path === "/api/files/bulk-delete" && request.method === "POST") return await bulkDelete(request, env, db);
      if (path === "/api/drive/import" && request.method === "POST") return await importFromDrive(request, env, db);
      if ((m = path.match(/^\/api\/files\/([0-9a-f-]{36})\/content$/)) && request.method === "GET")
        return await downloadFile(m[1], url, env, db);
      if ((m = path.match(/^\/api\/files\/([0-9a-f-]{36})$/)) && request.method === "DELETE")
        return await deleteFile(m[1], env, db);

      return json({ error: "Not found" }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function authenticate(request: Request, env: Env) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Missing access token");

  const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired session");
  return db;
}

type Placement = { project_id: string; subsystem_id: string | null; part_id: string | null };

function parsePlacement(src: { get(k: string): string | null }): Placement {
  const uuid = /^[0-9a-f-]{36}$/;
  const project_id = src.get("project_id") ?? "";
  const subsystem_id = src.get("subsystem_id") || null;
  const part_id = src.get("part_id") || null;
  if (!uuid.test(project_id)) throw new HttpError(400, "project_id is required");
  if (subsystem_id && !uuid.test(subsystem_id)) throw new HttpError(400, "bad subsystem_id");
  if (part_id && !uuid.test(part_id)) throw new HttpError(400, "bad part_id");
  return { project_id, subsystem_id, part_id };
}

function safeName(name: string) {
  const cleaned = name.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 200);
  return cleaned || "file";
}

/** Insert the metadata row first: RLS rejects it if the user can't edit the project. */
async function createFileRow(
  db: SupabaseClient,
  p: Placement,
  fields: { name: string; kind: FileKind; mime_type: string; size_bytes: number; source: "upload" | "drive"; drive_file_id?: string; drive_url?: string; revision?: string },
) {
  const r2_key = `projects/${p.project_id}/${crypto.randomUUID()}/${fields.name}`;
  const { data, error } = await db
    .from("files")
    .insert({ ...p, ...fields, r2_key })
    .select()
    .single();
  if (error) {
    // 42501 = RLS violation; 23503 = bad foreign key (part/subsystem not in this project)
    if (error.code === "42501") throw new HttpError(403, "You don't have edit access to this project");
    if (error.code === "23503") throw new HttpError(400, "Subsystem/part does not belong to this project");
    throw new HttpError(400, error.message);
  }
  return data as { id: string; r2_key: string };
}

async function uploadFile(request: Request, url: URL, env: Env, db: SupabaseClient) {
  const placement = parsePlacement(url.searchParams);
  const name = safeName(url.searchParams.get("name") ?? "");
  const kindParam = url.searchParams.get("kind");
  const kind = isFileKind(kindParam) ? kindParam : guessKind(name);
  const size = Number(request.headers.get("content-length") ?? "NaN");
  const maxBytes = Number(env.MAX_UPLOAD_MB ?? "95") * 1024 * 1024;

  if (!request.body || !Number.isFinite(size)) throw new HttpError(411, "Content-Length required");
  if (size > maxBytes) throw new HttpError(413, `File exceeds ${env.MAX_UPLOAD_MB ?? 95} MB limit`);

  const mime = guessMime(name, request.headers.get("content-type"));
  const row = await createFileRow(db, placement, {
    name,
    kind,
    mime_type: mime,
    size_bytes: size,
    source: "upload",
    revision: url.searchParams.get("revision") ?? "",
  });

  try {
    await env.FILES.put(row.r2_key, request.body, { httpMetadata: { contentType: mime } });
  } catch (err) {
    await db.from("files").delete().eq("id", row.id);
    throw err;
  }
  return json(row, 201);
}

async function downloadFile(id: string, url: URL, env: Env, db: SupabaseClient) {
  const { data: row } = await db.from("files").select("name, r2_key, mime_type").eq("id", id).maybeSingle();
  if (!row) throw new HttpError(404, "File not found");

  const obj = await env.FILES.get(row.r2_key);
  if (!obj) throw new HttpError(404, "File content missing");

  const disposition = url.searchParams.get("download") ? "attachment" : "inline";
  return new Response(obj.body, {
    headers: {
      "content-type": row.mime_type,
      "content-length": String(obj.size),
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "cache-control": "private, max-age=300",
    },
  });
}

async function deleteFile(id: string, env: Env, db: SupabaseClient) {
  const { data, error } = await db.from("files").delete().eq("id", id).select("r2_key");
  if (error) throw new HttpError(400, error.message);
  if (!data?.length) throw new HttpError(403, "File not found or you don't have edit access");
  await env.FILES.delete(data[0].r2_key);
  return json({ ok: true });
}

/** Delete many files (used before deleting a part/subsystem/project so R2 doesn't keep orphans). */
async function bulkDelete(request: Request, env: Env, db: SupabaseClient) {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)) : [];
  if (!ids.length) return json({ deleted: 0 });
  if (ids.length > 1000) throw new HttpError(400, "Too many files in one request");
  const { data, error } = await db.from("files").delete().in("id", ids).select("r2_key");
  if (error) throw new HttpError(400, error.message);
  const keys = (data ?? []).map((r) => r.r2_key as string);
  if (keys.length) await env.FILES.delete(keys);
  return json({ deleted: keys.length });
}

/**
 * Copy a file the user picked in Google Drive into R2.
 * The Google access token comes from the browser's Drive Picker flow (drive.file scope),
 * so the Worker can only read files the user explicitly picked.
 */
async function importFromDrive(request: Request, env: Env, db: SupabaseClient) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new HttpError(400, "JSON body required");
  const placement = parsePlacement({ get: (k) => (typeof body[k] === "string" ? (body[k] as string) : null) });
  const fileId = String(body.file_id ?? "");
  const googleToken = String(body.google_access_token ?? "");
  if (!/^[\w-]+$/.test(fileId) || !googleToken) throw new HttpError(400, "file_id and google_access_token are required");

  const gHeaders = { Authorization: `Bearer ${googleToken}` };
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,webViewLink&supportsAllDrives=true`,
    { headers: gHeaders },
  );
  if (!metaRes.ok) throw new HttpError(metaRes.status === 404 ? 404 : 502, `Google Drive: ${await metaRes.text()}`);
  const meta = (await metaRes.json()) as { id: string; name: string; mimeType: string; size?: string; webViewLink?: string };

  // Google-native docs (Docs/Sheets/Slides/Drawings) are exported to PDF.
  const isGoogleNative = meta.mimeType.startsWith("application/vnd.google-apps.");
  if (meta.mimeType === "application/vnd.google-apps.folder") throw new HttpError(400, "Folders can't be imported");
  const name = safeName(isGoogleNative ? `${meta.name}.pdf` : meta.name);
  const contentUrl = isGoogleNative
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;

  const maxBytes = Number(env.MAX_UPLOAD_MB ?? "95") * 1024 * 1024;
  const declaredSize = meta.size ? Number(meta.size) : null;
  if (declaredSize && declaredSize > maxBytes) throw new HttpError(413, `File exceeds ${env.MAX_UPLOAD_MB ?? 95} MB limit`);

  const contentRes = await fetch(contentUrl, { headers: gHeaders });
  if (!contentRes.ok || !contentRes.body) throw new HttpError(502, `Google Drive download failed (${contentRes.status})`);

  // R2 needs a known length for streams; exports have none, so buffer those (they're small).
  let payload: ReadableStream | ArrayBuffer;
  let size: number;
  if (declaredSize !== null && !isGoogleNative) {
    const fixed = new FixedLengthStream(declaredSize);
    contentRes.body.pipeTo(fixed.writable).catch(() => {});
    payload = fixed.readable;
    size = declaredSize;
  } else {
    payload = await contentRes.arrayBuffer();
    size = payload.byteLength;
    if (size > maxBytes) throw new HttpError(413, "Exported file is too large");
  }

  const kindParam = body.kind;
  const mime = guessMime(name, isGoogleNative ? "application/pdf" : meta.mimeType);
  const row = await createFileRow(db, placement, {
    name,
    kind: isFileKind(kindParam) ? kindParam : guessKind(name),
    mime_type: mime,
    size_bytes: size,
    source: "drive",
    drive_file_id: meta.id,
    drive_url: meta.webViewLink,
  });

  try {
    await env.FILES.put(row.r2_key, payload, { httpMetadata: { contentType: mime } });
  } catch (err) {
    await db.from("files").delete().eq("id", row.id);
    throw err;
  }
  return json(row, 201);
}
