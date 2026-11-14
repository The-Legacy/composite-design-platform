import { supabase } from "./supabase";
import type { FileKind } from "../../shared/fileTypes";
import type { FileRow } from "./types";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function check(res: Response) {
  if (res.ok) return res;
  let msg = `${res.status} ${res.statusText}`;
  try {
    msg = ((await res.json()) as { error?: string }).error ?? msg;
  } catch {
    /* not json */
  }
  throw new Error(msg);
}

export interface Placement {
  project_id: string;
  subsystem_id?: string | null;
  part_id?: string | null;
}

/** Upload with progress (XHR, since fetch has no upload progress). */
export async function uploadFile(
  file: File,
  placement: Placement,
  opts: { kind?: FileKind; revision?: string; replaces?: string; onProgress?: (fraction: number) => void } = {},
): Promise<FileRow> {
  const headers = await authHeader();
  const params = new URLSearchParams({ project_id: placement.project_id, name: file.name });
  if (placement.subsystem_id) params.set("subsystem_id", placement.subsystem_id);
  if (placement.part_id) params.set("part_id", placement.part_id);
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.revision) params.set("revision", opts.revision);
  if (opts.replaces) params.set("replaces", opts.replaces);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files?${params}`);
    xhr.setRequestHeader("Authorization", headers.Authorization);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as FileRow);
      else reject(new Error(body?.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export async function fetchFileBlob(fileId: string): Promise<Blob> {
  const res = await check(await fetch(`/api/files/${fileId}/content`, { headers: await authHeader() }));
  return res.blob();
}

export async function downloadFile(file: FileRow) {
  const blob = await fetchFileBlob(file.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function deleteFile(fileId: string) {
  await check(await fetch(`/api/files/${fileId}`, { method: "DELETE", headers: await authHeader() }));
}

export async function importFromDrive(fileId: string, googleAccessToken: string, placement: Placement, replaces?: string): Promise<FileRow> {
  const res = await check(
    await fetch("/api/drive/import", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ ...placement, file_id: fileId, google_access_token: googleAccessToken, replaces }),
    }),
  );
  return res.json();
}

/** Remove file bytes from R2 (and their rows) before deleting a part/subsystem/project. */
export async function deleteFiles(fileIds: string[]) {
  if (!fileIds.length) return;
  await check(
    await fetch("/api/files/bulk-delete", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ ids: fileIds }),
    }),
  );
}
