import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ACCEPTED_EXTENSIONS, FILE_KINDS, viewerFor, type FileKind } from "../../shared/fileTypes";
import { deleteFile, downloadFile, importFromDrive, uploadFile, type Placement } from "../lib/api";
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
  const [filter, setFilter] = useState<FileKind | "all">("all");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<FileRow | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

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

  const uploadAll = (list: FileList | File[]) => {
    for (const f of Array.from(list)) track(f.name, (onProgress) => uploadFile(f, placement, { onProgress }));
  };

  const importDrive = async () => {
    setDriveError(null);
    try {
      const { files: picked, token } = await pickDriveFiles(user?.email);
      for (const f of picked) track(`${f.name} (Drive)`, () => importFromDrive(f.id, token, placement));
    } catch (e) {
      setDriveError((e as Error).message);
    }
  };

  const shown = files.filter((f) => filter === "all" || f.kind === filter);
  const counts = new Map<string, number>();
  for (const f of files) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);

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
              {driveConfigured && (
                <Button size="sm" onClick={importDrive}>
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
            const c = k.value === "all" ? files.length : counts.get(k.value) ?? 0;
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
            {shown.map((f) => (
              <FileItem
                key={f.id}
                f={f}
                location={showLocation?.(f) ?? null}
                canEdit={canEdit}
                onOpen={() => setViewing(f)}
                onDelete={async () => {
                  if (!confirm(`Delete ${f.name}? This can't be undone.`)) return;
                  await deleteFile(f.id).catch((e) => alert(e.message));
                  refresh();
                }}
                onUpdate={(patch) => update.mutate({ id: f.id, ...patch })}
              />
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState title={files.length ? "No files of this type" : "No files yet"}>
              {canEdit && "Drag & drop STEP, STL, OBJ, PDF, DXF, images or any other files here."}
            </EmptyState>
          </div>
        )}
      </div>
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}

function FileItem({
  f,
  location,
  canEdit,
  onOpen,
  onDelete,
  onUpdate,
}: {
  f: FileRow;
  location: string | null;
  canEdit: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<FileRow>) => void;
}) {
  const previewable = Boolean(viewerFor(f.name));
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
      <span className="text-lg" aria-hidden>
        {KIND_ICON[f.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <button onClick={onOpen} className="block max-w-full truncate text-left text-sm font-medium hover:text-accent">
          {f.name}
        </button>
        <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
          <span>{formatBytes(f.size_bytes)}</span>
          <span>{new Date(f.created_at).toLocaleDateString()}</span>
          {location && <span className="text-slate-600">· {location}</span>}
          {f.source === "drive" && <span className="text-emerald-700">· from Drive</span>}
          {!previewable && <span className="text-slate-400">· download only</span>}
        </div>
      </div>
      {canEdit ? (
        <>
          <input
            defaultValue={f.revision}
            placeholder="Rev"
            title="Revision"
            className="w-14 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-center text-xs hover:border-slate-200 focus:border-accent focus:outline-none"
            onBlur={(e) => e.target.value !== f.revision && onUpdate({ revision: e.target.value })}
          />
          <select
            value={f.kind}
            onChange={(e) => onUpdate({ kind: e.target.value as FileKind })}
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
      ) : (
        f.revision && <span className="text-xs text-slate-500">Rev {f.revision}</span>
      )}
      <div className="flex gap-1 opacity-60 group-hover:opacity-100">
        <Button size="sm" variant="ghost" onClick={() => downloadFile(f).catch((e) => alert(e.message))} title="Download">
          ⬇
        </Button>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={onDelete} title="Delete" className="hover:text-red-600">
            🗑
          </Button>
        )}
      </div>
    </li>
  );
}

