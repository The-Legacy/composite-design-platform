import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ACCEPTED_EXTENSIONS, FILE_KINDS, viewerFor, type FileKind } from "../../shared/fileTypes";
import { deleteFile, deleteFiles, downloadFile, importFromDrive, uploadFile, type Placement } from "../lib/api";
import { driveConfigured, pickDriveFiles } from "../lib/google";
import { useAuth } from "../auth/AuthProvider";
import { qk, useTableMutations } from "../data/queries";
import type { FileRow } from "../lib/types";
import { Badge, Button, Card, CardHeader, EmptyState, IconButton, cx, formatBytes } from "./ui";
import { BoxIcon, CloudIcon, DownloadIcon, FileTextIcon, FileUpIcon, FolderIcon, ImageIcon, PaperclipIcon, RulerIcon, TrashIcon, UploadIcon } from "./icons";
import FileViewer from "./FileViewer";

const KIND_STYLE: Record<FileKind, { icon: typeof BoxIcon; cls: string }> = {
  model_3d: { icon: BoxIcon, cls: "bg-indigo-50 text-indigo-600 ring-indigo-100" },
  drawing: { icon: RulerIcon, cls: "bg-sky-50 text-sky-600 ring-sky-100" },
  image: { icon: ImageIcon, cls: "bg-emerald-50 text-emerald-600 ring-emerald-100" },
  document: { icon: FileTextIcon, cls: "bg-amber-50 text-amber-600 ring-amber-100" },
  other: { icon: PaperclipIcon, cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};

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
    <Card className={cx("relative overflow-hidden transition", dragging && "border-accent ring-4 ring-accent/15")}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex animate-fade-in items-center justify-center bg-accent-soft/80 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 text-accent">
            <UploadIcon size={28} />
            <span className="text-sm font-medium">Drop to upload</span>
          </div>
        </div>
      )}
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
        <CardHeader
          icon={FolderIcon}
          title={title}
          description={canEdit ? "Drag & drop files anywhere on this panel" : undefined}
          actions={
          canEdit && (
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
                  <CloudIcon size={14} /> Import from Drive
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => inputRef.current?.click()}>
                <UploadIcon size={14} /> Upload
              </Button>
            </>
          )
          }
        />

        {groups.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2 text-xs">
          {[{ value: "all" as const, label: "All" }, ...FILE_KINDS].map((k) => {
            const c = k.value === "all" ? groups.length : counts.get(k.value) ?? 0;
            if (k.value !== "all" && !c) return null;
            return (
              <button
                key={k.value}
                onClick={() => setFilter(k.value)}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-full px-3 font-medium whitespace-nowrap transition",
                  filter === k.value ? "bg-slate-900 text-white shadow-card" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {k.label} <span className={cx("tabular-nums", filter === k.value ? "text-white/60" : "text-slate-400")}>{c}</span>
              </button>
            );
          })}
        </div>
        )}

        {(pending.length > 0 || driveError) && (
          <div className="space-y-2 border-b border-slate-100 bg-slate-50/50 px-4 py-3 text-xs">
            {driveError && <div className="text-red-600">Drive: {driveError}</div>}
            {pending.map((p) => (
              <div key={p.key} className="flex items-center gap-3">
                <UploadIcon size={13} className="shrink-0 text-slate-400" />
                <span className="w-48 truncate font-medium text-slate-700">{p.name}</span>
                {p.error ? (
                  <>
                    <span className="flex-1 text-red-600">{p.error}</span>
                    <button className="font-medium text-slate-500 hover:text-slate-800" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>
                      dismiss
                    </button>
                  </>
                ) : (
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(4, p.progress * 100)}%` }} />
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
            <EmptyState icon={files.length ? undefined : UploadIcon} title={files.length ? "No files of this type" : "No files yet"}>
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
    <Badge tone={latest ? "accent" : "neutral"} className="font-mono" title={latest ? "Current revision" : "Older revision"}>
      r{f.rev_number}
      {f.revision && ` · ${f.revision}`}
    </Badge>
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
      <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/80">
        {(() => {
          const { icon: KindIcon, cls } = KIND_STYLE[f.kind] ?? KIND_STYLE.other;
          return (
            <button onClick={() => onOpen(f)} className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", cls)} title="Open">
              <KindIcon size={17} />
            </button>
          );
        })()}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button onClick={() => onOpen(f)} className="block max-w-full truncate text-left text-sm font-medium text-slate-900 hover:text-accent">
              {f.name}
            </button>
            {(older.length > 0 || f.revision) && <RevBadge f={f} latest />}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500 tabular-nums">
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
              className="h-7 w-16 rounded-md border border-transparent bg-transparent px-1.5 text-center text-xs placeholder:text-slate-300 hover:border-slate-200 hover:bg-white focus:border-accent focus:bg-white focus:outline-none"
              onBlur={(e) => e.target.value !== f.revision && onUpdate(f.id, { revision: e.target.value })}
            />
            <select
              value={f.kind}
              onChange={(e) => group.revs.forEach((r) => onUpdate(r.id, { kind: e.target.value as FileKind }))}
              className="ui-select h-7 rounded-md border border-transparent bg-transparent pl-1.5 text-xs text-slate-500 hover:border-slate-200 hover:bg-white"
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
        <div className="flex gap-0.5 opacity-50 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {canEdit && (
            <IconButton onClick={onNewRevision} title="Upload a new revision of this file">
              <FileUpIcon size={15} />
            </IconButton>
          )}
          {canEdit && onNewRevisionFromDrive && (
            <IconButton onClick={onNewRevisionFromDrive} title="New revision from Google Drive">
              <CloudIcon size={15} />
            </IconButton>
          )}
          <IconButton onClick={() => downloadFile(f).catch((e) => alert(e.message))} title="Download">
            <DownloadIcon size={15} />
          </IconButton>
          {canEdit && (
            <IconButton tone="danger" onClick={onDeleteAll} title={older.length ? "Delete file and all revisions" : "Delete"}>
              <TrashIcon size={15} />
            </IconButton>
          )}
        </div>
      </div>
      {showRevs && (
        <ul className="border-t border-slate-100 bg-slate-50/60 py-1.5 pr-4 pl-16">
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
              <IconButton size="sm" onClick={() => downloadFile(r).catch((e) => alert(e.message))} title="Download">
                <DownloadIcon size={14} />
              </IconButton>
              {canEdit && (
                <IconButton size="sm" tone="danger" onClick={() => onDeleteRevision(r)} title="Delete this revision">
                  <TrashIcon size={14} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
