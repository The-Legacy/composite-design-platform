import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ACCEPTED_EXTENSIONS, FILE_KINDS, viewerFor, type FileKind } from "../../shared/fileTypes";
import { deleteFile, deleteFiles, downloadFile, importFromDrive, uploadFile, type Placement } from "../lib/api";
import { driveConfigured, pickDriveFiles } from "../lib/google";
import { useAuth } from "../auth/AuthProvider";
import { qk, useTableMutations } from "../data/queries";
import type { FileRow } from "../lib/types";
import { Button, Card, EmptyState, cx, formatBytes } from "./ui";
import FileViewer from "./FileViewer";

const KIND_ICON: Record<FileKind, string> = { model_3d: "🧊", drawing: "📐", image: "🖼️", document: "📄", other: "📎" };

interface Pending {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

/** All revisions of one document, newest first. `current` is revs[0]. */
export interface FileGroup {
  current: FileRow;
  revs: FileRow[];
}

export function groupRevisions(files: FileRow[]): FileGroup[] {
  const byLineage = new Map<string, FileRow[]>();
  for (const f of files) {
    const list = byLineage.get(f.lineage_id) ?? [];
    list.push(f);
    byLineage.set(f.lineage_id, list);
  }
  const groups = [...byLineage.values()].map((revs) => {
    revs.sort((a, b) => b.rev_number - a.rev_number);
    return { current: revs[0], revs };
  });
  return groups.sort((a, b) => b.current.created_at.localeCompare(a.current.created_at));
}

const samePlacement = (f: FileRow, p: Placement) => f.part_id === (p.part_id ?? null) && f.subsystem_id === (p.subsystem_id ?? null);

export default function FilePanel({
  placement,
  files,
  canEdit,
  title = "Files",
  showLocation,
}: {
  placement: Placement;
  files: FileRow[];
  canEdit: boolean;
  title?: string;
  /** label shown per file (e.g. which part it belongs to) */
  showLocation?: (f: FileRow) => string | null;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { update } = useTableMutations<FileRow>("files", placement.project_id);
  const inputRef = useRef<HTMLInputElement>(null);
  const revInputRef = useRef<HTMLInputElement>(null);
  const [revTarget, setRevTarget] = useState<FileRow | null>(null);
  const [filter, setFilter] = useState<FileKind | "all">("all");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<FileRow | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const groups = useMemo(() => groupRevisions(files), [files]);

  // Deep link from search: ?file=<id> opens that file if it's in this panel.
  const deepLink = params.get("file");
  useEffect(() => {
    if (!deepLink) return;
    const f = files.find((x) => x.id === deepLink);
    if (f) {
      setViewing(f);
      setParams(
        (p) => {
          p.delete("file");
          return p;
        },
        { replace: true },
      );
    }
  }, [deepLink, files, setParams]);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.files(placement.project_id) });

  const track = async (name: string, run: (onProgress: (p: number) => void) => Promise<unknown>) => {
    const key = crypto.randomUUID();
    setPending((p) => [...p, { key, name, progress: 0 }]);
    try {
      await run((progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))));
      setPending((p) => p.filter((x) => x.key !== key));
      refresh();
    } catch (e) {
      setPending((p) => p.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x)));
    }
  };

  /** For each name, the current file here with the same name (if the user agrees to version it). */
  const matchRevisions = (names: string[]): Map<string, FileRow> => {
    const here = new Map(groups.filter((g) => samePlacement(g.current, placement)).map((g) => [g.current.name.toLowerCase(), g.current]));
    const matches = new Map<string, FileRow>();
    for (const n of names) {
      const m = here.get(n.toLowerCase());
      if (m) matches.set(n, m);
    }
    if (!matches.size) return matches;
    const list = [...matches.keys()].slice(0, 8).join("\n  • ");
    const ok = confirm(
      `Already here:\n  • ${list}${matches.size > 8 ? "\n  • …" : ""}\n\nOK = upload as new revisions (old versions are kept)\nCancel = add as separate files`,
    );
    return ok ? matches : new Map();
  };

  const uploadAll = (list: FileList | File[]) => {
    const arr = Array.from(list);
    const revs = matchRevisions(arr.map((f) => f.name));
    for (const f of arr) {
      const prev = revs.get(f.name);
      track(prev ? `${f.name} (rev ${nextRev(prev)})` : f.name, (onProgress) => uploadFile(f, placement, { onProgress, replaces: prev?.id }));
    }
  };

  const nextRev = (f: FileRow) => (groups.find((g) => g.current.lineage_id === f.lineage_id)?.current.rev_number ?? f.rev_number) + 1;

  const importDrive = async (replaces?: FileRow) => {
    setDriveError(null);
    try {
      const { files: picked, token } = await pickDriveFiles(user?.email);
      if (replaces && picked.length !== 1) throw new Error("Pick exactly one file for a new revision");
      const revs = replaces ? new Map([[picked[0].name, replaces]]) : matchRevisions(picked.map((f) => f.name));
      for (const f of picked) {
        const prev = revs.get(f.name) ?? (replaces && f === picked[0] ? replaces : undefined);
        track(`${f.name} (Drive${prev ? `, rev ${nextRev(prev)}` : ""})`, () => importFromDrive(f.id, token, placement, prev?.id));
      }
    } catch (e) {
      setDriveError((e as Error).message);
    }
  };

  const shown = groups.filter((g) => filter === "all" || g.current.kind === filter);
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g.current.kind, (counts.get(g.current.kind) ?? 0) + 1);

  return (
    <Card className={cx("overflow-hidden", dragging && "ring-2 ring-accent")}>
      <div
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (canEdit && e.dataTransfer.files.length) uploadAll(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="mr-auto font-semibold">{title}</h2>
          {canEdit && (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                accept={ACCEPTED_EXTENSIONS.join(",") + ",*/*"}
                onChange={(e) => {
                  if (e.target.files) uploadAll(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={revInputRef}
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  const target = revTarget;
                  e.target.value = "";
                  if (!f || !target) return;
                  track(`${f.name} (rev ${nextRev(target)})`, (onProgress) => uploadFile(f, placement, { onProgress, replaces: target.id }));
                }}
              />
              {driveConfigured && (
                <Button size="sm" onClick={() => importDrive()}>
                  Import from Drive
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => inputRef.current?.click()}>
                Upload
              </Button>
            </>
          )}
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2 text-xs">
          {[{ value: "all" as const, label: "All" }, ...FILE_KINDS].map((k) => {
            const c = k.value === "all" ? groups.length : counts.get(k.value) ?? 0;
            if (k.value !== "all" && !c) return null;
            return (
              <button
                key={k.value}
                onClick={() => setFilter(k.value)}
                className={cx(
                  "rounded-full px-2.5 py-1 whitespace-nowrap",
                  filter === k.value ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {k.label} <span className="opacity-60">{c}</span>
              </button>
            );
          })}
        </div>

        {(pending.length > 0 || driveError) && (
          <div className="space-y-1 border-b border-slate-100 px-4 py-2 text-xs">
            {driveError && <div className="text-red-600">Drive: {driveError}</div>}
            {pending.map((p) => (
              <div key={p.key} className="flex items-center gap-2">
                <span className="w-48 truncate">{p.name}</span>
                {p.error ? (
                  <>
                    <span className="flex-1 text-red-600">{p.error}</span>
                    <button className="text-slate-400" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>
                      dismiss
                    </button>
                  </>
                ) : (
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-100">
                    <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(4, p.progress * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {shown.length ? (
          <ul className="divide-y divide-slate-100">
            {shown.map((g) => (
              <FileItem
                key={g.current.lineage_id}
                group={g}
                location={showLocation?.(g.current) ?? null}
                canEdit={canEdit}
                onOpen={setViewing}
                onNewRevision={() => {
                  setRevTarget(g.current);
                  revInputRef.current?.click();
                }}
                onNewRevisionFromDrive={driveConfigured ? () => importDrive(g.current) : undefined}
                onDeleteAll={async () => {
                  const n = g.revs.length;
                  if (!confirm(`Delete ${g.current.name}${n > 1 ? ` and all ${n} revisions` : ""}? This can't be undone.`)) return;
                  await deleteFiles(g.revs.map((r) => r.id)).catch((e) => alert(e.message));
                  refresh();
                }}
                onDeleteRevision={async (f) => {
                  if (!confirm(`Delete revision ${f.rev_number} of ${f.name}? This can't be undone.`)) return;
                  await deleteFile(f.id).catch((e) => alert(e.message));
                  refresh();
                }}
                onUpdate={(id, patch) => update.mutate({ id, ...patch })}
              />
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState title={files.length ? "No files of this type" : "No files yet"}>
              {canEdit && "Drag & drop STEP, STL, OBJ, PDF, DXF, images or any other files here. Dropping a file with the same name adds a new revision."}
            </EmptyState>
          </div>
        )}
      </div>
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}

function RevBadge({ f, latest }: { f: FileRow; latest: boolean }) {
  return (
    <span
      className={cx("rounded px-1.5 py-0.5 font-mono text-[11px]", latest ? "bg-accent-soft text-accent" : "bg-slate-100 text-slate-500")}
      title={latest ? "Current revision" : "Older revision"}
    >
      r{f.rev_number}
      {f.revision && ` · ${f.revision}`}
    </span>
  );
}

function FileItem({
  group,
  location,
  canEdit,
  onOpen,
  onNewRevision,
  onNewRevisionFromDrive,
  onDeleteAll,
  onDeleteRevision,
  onUpdate,
}: {
  group: FileGroup;
  location: string | null;
  canEdit: boolean;
  onOpen: (f: FileRow) => void;
  onNewRevision: () => void;
  onNewRevisionFromDrive?: () => void;
  onDeleteAll: () => void;
  onDeleteRevision: (f: FileRow) => void;
  onUpdate: (id: string, patch: Partial<FileRow>) => void;
}) {
  const f = group.current;
  const [showRevs, setShowRevs] = useState(false);
  const previewable = Boolean(viewerFor(f.name));
  const older = group.revs.slice(1);
  return (
    <li className="group">
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
        <span className="text-lg" aria-hidden>
          {KIND_ICON[f.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button onClick={() => onOpen(f)} className="block max-w-full truncate text-left text-sm font-medium hover:text-accent">
              {f.name}
            </button>
            {(older.length > 0 || f.revision) && <RevBadge f={f} latest />}
          </div>
          <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
            <span>{formatBytes(f.size_bytes)}</span>
            <span>{new Date(f.created_at).toLocaleDateString()}</span>
            {location && <span className="text-slate-600">· {location}</span>}
            {f.source === "drive" && <span className="text-emerald-700">· from Drive</span>}
            {!previewable && <span className="text-slate-400">· download only</span>}
            {older.length > 0 && (
              <button className="text-accent hover:underline" onClick={() => setShowRevs(!showRevs)}>
                · {showRevs ? "hide" : "show"} {older.length} older revision{older.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
        {canEdit ? (
          <>
            <input
              key={f.id}
              defaultValue={f.revision}
              placeholder="Label"
              title="Revision label (e.g. B, PDR, released)"
              className="w-16 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-center text-xs hover:border-slate-200 focus:border-accent focus:outline-none"
              onBlur={(e) => e.target.value !== f.revision && onUpdate(f.id, { revision: e.target.value })}
            />
            <select
              value={f.kind}
              onChange={(e) => group.revs.forEach((r) => onUpdate(r.id, { kind: e.target.value as FileKind }))}
              className="rounded border border-transparent bg-transparent text-xs text-slate-500 hover:border-slate-200"
              title="Category"
            >
              {FILE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <div className="flex gap-1 opacity-60 group-hover:opacity-100">
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={onNewRevision} title="Upload a new revision of this file">
              ⤴ New rev
            </Button>
          )}
          {canEdit && onNewRevisionFromDrive && (
            <Button size="sm" variant="ghost" onClick={onNewRevisionFromDrive} title="New revision from Google Drive">
              ⤴ Drive
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => downloadFile(f).catch((e) => alert(e.message))} title="Download">
            ⬇
          </Button>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={onDeleteAll} title={older.length ? "Delete file and all revisions" : "Delete"} className="hover:text-red-600">
              🗑
            </Button>
          )}
        </div>
      </div>
      {showRevs && (
        <ul className="border-t border-slate-100 bg-slate-50/60 py-1 pr-4 pl-12">
          {older.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-1 text-xs">
              <RevBadge f={r} latest={false} />
              <button onClick={() => onOpen(r)} className="min-w-0 truncate text-left hover:text-accent">
                {r.name}
              </button>
              <span className="text-slate-400">
                {formatBytes(r.size_bytes)} · {new Date(r.created_at).toLocaleString()}
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => downloadFile(r).catch((e) => alert(e.message))} title="Download">
                ⬇
              </Button>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => onDeleteRevision(r)} title="Delete this revision" className="hover:text-red-600">
                  🗑
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
