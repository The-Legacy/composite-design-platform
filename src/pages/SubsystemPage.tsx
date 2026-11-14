import { Link, useNavigate, useParams } from "react-router";
import { useFiles, useTableMutations, useVariables } from "../data/queries";
import { deleteFiles } from "../lib/api";
import type { Subsystem } from "../lib/types";
import { Button, Card, EmptyState } from "../components/ui";
import FilePanel from "../components/FilePanel";
import InlineEdit from "../components/InlineEdit";
import { useProjectCtx } from "./projectContext";

export default function SubsystemPage() {
  const { subsystemId = "" } = useParams();
  const { project, subsystems, parts, canEdit, openNewPart } = useProjectCtx();
  const files = useFiles(project.id).data ?? [];
  const vars = useVariables(project.id).data ?? [];
  const { update, remove } = useTableMutations<Subsystem>("subsystems", project.id);
  const navigate = useNavigate();
  const s = subsystems.find((x) => x.id === subsystemId);
  if (!s) return <div className="p-6 text-slate-500">Subsystem not found.</div>;

  const sParts = parts.filter((p) => p.subsystem_id === s.id);
  const partIds = new Set(sParts.map((p) => p.id));
  const partName = new Map(sParts.map((p) => [p.id, p.name]));
  const allFiles = files.filter((f) => f.subsystem_id === s.id || (f.part_id && partIds.has(f.part_id)));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="text-xs font-medium tracking-wide text-slate-400 uppercase">Subsystem</div>
          <InlineEdit
            value={s.name}
            disabled={!canEdit}
            onSave={(name) => name.trim() && update.mutate({ id: s.id, name })}
            className="text-2xl font-semibold"
          />
          <InlineEdit
            value={s.description}
            disabled={!canEdit}
            multiline
            placeholder="Add a description…"
            onSave={(description) => update.mutate({ id: s.id, description })}
            className="mt-1 text-slate-600"
          />
        </div>
        {canEdit && (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (!confirm(`Delete subsystem “${s.name}”, its ${sParts.length} parts and ${allFiles.length} files? This can't be undone.`)) return;
              await deleteFiles(allFiles.map((f) => f.id));
              await remove.mutateAsync(s.id);
              navigate(`/p/${project.id}`);
            }}
          >
            Delete subsystem
          </Button>
        )}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Parts</h2>
          {canEdit && (
            <Button size="sm" onClick={() => openNewPart(s.id)}>
              + New part
            </Button>
          )}
        </div>
        {sParts.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sParts.map((p) => (
              <Link key={p.id} to={`/p/${project.id}/part/${p.id}`}>
                <Card className="h-full p-4 transition hover:border-accent hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{p.name}</div>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{p.status}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-slate-400">
                    {p.part_number && `${p.part_number} · `}
                    {p.slug}
                  </div>
                  <div className="mt-3 text-xs text-slate-500">
                    {files.filter((f) => f.part_id === p.id).length} files · {vars.filter((v) => v.part_id === p.id).length} variables
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No parts in this subsystem yet" />
        )}
      </section>

      <FilePanel
        title="Subsystem files"
        placement={{ project_id: project.id, subsystem_id: s.id }}
        files={allFiles}
        canEdit={canEdit}
        showLocation={(f) => (f.part_id ? partName.get(f.part_id) ?? null : "subsystem")}
      />
    </div>
  );
}
