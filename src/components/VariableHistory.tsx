import { useMemo } from "react";
import { Link } from "react-router";
import { useParts, useVariableHistory } from "../data/queries";
import type { Variable, VariableChange } from "../lib/types";
import { Avatar, Button, Card, CardHeader, ErrorText, Modal, Spinner } from "./ui";
import { HistoryIcon } from "./icons";

const who = (c: VariableChange) => c.profiles?.full_name || c.profiles?.email || "someone";

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

function withUnit(expr: string | null, unit: string | null) {
  if (expr === null) return "";
  return unit ? `${expr}  → ${unit}` : expr;
}

function ChangeLine({ c }: { c: VariableChange }) {
  if (c.op === "insert") return <span className="font-mono text-[13px] text-emerald-700">created = {withUnit(c.new_expression, c.new_unit)}</span>;
  if (c.op === "delete") return <span className="font-mono text-[13px] text-red-600">deleted (was {withUnit(c.old_expression, c.old_unit)})</span>;
  return (
    <span className="font-mono text-[13px]">
      {c.old_name && <span className="mr-2 text-slate-500">renamed from {c.old_name};</span>}
      {(c.old_expression !== c.new_expression || c.old_unit !== c.new_unit) && (
        <>
          <span className="text-slate-400 line-through">{withUnit(c.old_expression, c.old_unit)}</span>
          <span className="mx-1.5 text-slate-400">→</span>
          <span className="text-slate-900">{withUnit(c.new_expression, c.new_unit)}</span>
        </>
      )}
    </span>
  );
}

/** Modal with every change to one variable, with a restore button per old value. */
export default function VariableHistory({
  projectId,
  variable,
  canEdit,
  onClose,
  onRestore,
}: {
  projectId: string;
  variable: Variable | null;
  canEdit: boolean;
  onClose: () => void;
  onRestore: (expression: string, displayUnit: string) => void;
}) {
  const history = useVariableHistory(projectId, { variableId: variable?.id, enabled: !!variable });
  return (
    <Modal open={!!variable} onClose={onClose} title={<>History of <span className="font-mono">{variable?.name}</span></>}>
      <ErrorText error={history.error} />
      {history.isLoading ? (
        <Spinner />
      ) : !history.data?.length ? (
        <div className="text-sm text-slate-500">No recorded changes yet.</div>
      ) : (
        <ol className="relative space-y-4 text-sm before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-slate-200">
          {history.data.map((c) => {
            const restorable = c.op === "update" && c.old_expression !== null && (c.old_expression !== variable?.expression || (c.old_unit ?? "") !== variable?.display_unit);
            return (
              <li key={c.id} className="relative pl-6">
                <span
                  className={`absolute top-1.5 left-0 h-[11px] w-[11px] rounded-full border-2 border-white ring-1 ${c.op === "insert" ? "bg-emerald-500 ring-emerald-200" : c.op === "delete" ? "bg-red-500 ring-red-200" : "bg-accent ring-accent-muted"}`}
                />
                <div className="text-xs text-slate-500">
                  {who(c)} · <span title={new Date(c.changed_at).toLocaleString()}>{timeAgo(c.changed_at)}</span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <ChangeLine c={c} />
                  {canEdit && restorable && (
                    <Button size="sm" variant="ghost" title="Set the variable back to the value before this change" onClick={() => onRestore(c.old_expression!, c.old_unit ?? "")}>
                      Restore old
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}

/** Project-wide feed of recent variable changes. */
export function RecentChanges({ projectId, limit = 25 }: { projectId: string; limit?: number }) {
  const history = useVariableHistory(projectId, { limit });
  const parts = useParts(projectId).data ?? [];
  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={HistoryIcon} title="Recent variable changes" description="Every edit is recorded and can be restored from a variable's history." />
      {history.error && (
        <div className="px-4 pt-3">
          <ErrorText error={history.error} />
        </div>
      )}
      {history.isLoading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : !history.data?.length ? (
        <div className="p-8 text-center text-sm text-slate-500">Nothing yet.</div>
      ) : (
        <ul className="max-h-[420px] divide-y divide-slate-100 overflow-auto text-sm">
          {history.data.map((c) => {
            const p = c.part_id ? partById.get(c.part_id) : undefined;
            const ref = c.part_id ? `${p?.slug ?? "(deleted part)"}.${c.name}` : c.name;
            return (
              <li key={c.id} className="flex gap-3 px-4 py-2.5 hover:bg-slate-50/60">
                <Avatar name={who(c)} size={24} />
                <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
                  {p ? (
                    <Link to={`/p/${projectId}/part/${p.id}`} className="font-mono font-medium text-slate-800 hover:text-accent">
                      {ref}
                    </Link>
                  ) : (
                    <span className="font-mono font-medium text-slate-800">{ref}</span>
                  )}
                  <span>
                    {who(c)} · <span title={new Date(c.changed_at).toLocaleString()}>{timeAgo(c.changed_at)}</span>
                  </span>
                </div>
                <div className="mt-0.5 truncate">
                  <ChangeLine c={c} />
                </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
