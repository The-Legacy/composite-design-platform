import { Link, useNavigate, useParams } from "react-router";
import { useFiles, useTableMutations, useVariables } from "../data/queries";
import { deleteFiles } from "../lib/api";
import type { Subsystem } from "../lib/types";
import { Button, Card, DangerRow, EmptyState, Page, PageHeader, StatusBadge } from "../components/ui";
import { BoxIcon, ComponentIcon, FileTextIcon, PlusIcon, SigmaIcon } from "../components/icons";
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
    <Page>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ComponentIcon size={13} /> Subsystem
          </span>
        }
        title={
          <InlineEdit value={s.name} disabled={!canEdit} onSave={(name) => name.trim() && update.mutate({ id: s.id, name })} className="font-semibold tracking-tight" />
        }
        description={
          <InlineEdit
            value={s.description}
            disabled={!canEdit}
            multiline
            placeholder="Add a description…"
            onSave={(description) => update.mutate({ id: s.id, description })}
          />
        }
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => openNewPart(s.id)}>
              <PlusIcon /> New part
            </Button>
          )
        }
      />

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-slate-900">
          Parts <span className="ml-1 font-normal text-slate-400 tabular-nums">{sParts.length}</span>
        </h2>
        {sParts.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sParts.map((p) => {
              const nf = files.filter((f) => f.part_id === p.id).length;
              const nv = vars.filter((v) => v.part_id === p.id).length;
              return (
                <Link key={p.id} to={`/p/${project.id}/part/${p.id}`} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <Card className="flex h-full flex-col p-4 transition group-hover:-translate-y-px group-hover:border-slate-300 group-hover:shadow-lift">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition group-hover:bg-accent-soft group-hover:text-accent">
                          <BoxIcon size={16} />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">{p.name}</div>
                          <div className="truncate font-mono text-[11px] text-slate-400">
                            {p.part_number && `${p.part_number} · `}
                            {p.slug}
                          </div>
                        </div>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-auto flex gap-4 pt-4 text-xs text-slate-500 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <FileTextIcon size={12} /> {nf} file{nf === 1 ? "" : "s"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <SigmaIcon size={12} /> {nv} variable{nv === 1 ? "" : "s"}
                      </span>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={BoxIcon}
            title="No parts in this subsystem yet"
            action={
              canEdit && (
                <Button onClick={() => openNewPart(s.id)}>
                  <PlusIcon /> New part
                </Button>
              )
            }
          />
        )}
      </section>

      <FilePanel
        title="Subsystem files"
        placement={{ project_id: project.id, subsystem_id: s.id }}
        files={allFiles}
        canEdit={canEdit}
        showLocation={(f) => (f.part_id ? partName.get(f.part_id) ?? null : "subsystem")}
      />

      {canEdit && (
        <DangerRow
          label="Delete subsystem"
          text={`Removes ${s.name}, its ${sParts.length} parts and ${allFiles.length} files.`}
          onClick={async () => {
            if (!confirm(`Delete subsystem “${s.name}”, its ${sParts.length} parts and ${allFiles.length} files? This can't be undone.`)) return;
            await deleteFiles(allFiles.map((f) => f.id));
            await remove.mutateAsync(s.id);
            navigate(`/p/${project.id}`);
          }}
        />
      )}
    </Page>
  );
}
