import { Link } from "react-router";
import { useFiles, useVariables } from "../data/queries";
import { Card, EmptyState, Monogram, Page, PageHeader, Stat, cx, statusDot } from "../components/ui";
import { BoxIcon, ChevronRightIcon, ComponentIcon, FileTextIcon, SigmaIcon } from "../components/icons";
import FilePanel, { groupRevisions } from "../components/FilePanel";
import { useProjectCtx } from "./projectContext";

export default function ProjectOverview() {
  const { project, subsystems, parts, canEdit } = useProjectCtx();
  const files = useFiles(project.id).data ?? [];
  const vars = useVariables(project.id).data ?? [];

  return (
    <Page>
      <PageHeader eyebrow="Project overview" title={project.name} description={project.description || undefined} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={ComponentIcon} label="Subsystems" value={subsystems.length} />
        <Stat icon={BoxIcon} label="Parts" value={parts.length} />
        <Stat icon={FileTextIcon} label="Files" value={groupRevisions(files).length} />
        <Stat icon={SigmaIcon} label="Variables" value={vars.length} />
      </div>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-slate-900">Subsystems</h2>
        {subsystems.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subsystems.map((s) => {
              const sParts = parts.filter((p) => p.subsystem_id === s.id);
              const sPartIds = new Set(sParts.map((p) => p.id));
              const nFiles = files.filter((f) => f.subsystem_id === s.id || (f.part_id && sPartIds.has(f.part_id))).length;
              return (
                <Link key={s.id} to={`s/${s.id}`} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <Card className="flex h-full flex-col p-4 transition group-hover:-translate-y-px group-hover:border-slate-300 group-hover:shadow-lift">
                    <div className="flex items-start gap-3">
                      <Monogram name={s.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 font-semibold text-slate-900">
                          <span className="truncate">{s.name}</span>
                          <ChevronRightIcon size={14} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-accent" />
                        </div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          {sParts.length} part{sParts.length === 1 ? "" : "s"} · {nFiles} file{nFiles === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                    {s.description && <div className="mt-3 line-clamp-2 text-sm text-slate-500">{s.description}</div>}
                    {sParts.length > 0 && (
                      <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                        {sParts.slice(0, 6).map((p) => (
                          <span key={p.id} className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200/70 ring-inset">
                            <span className={cx("h-1.5 w-1.5 rounded-full", statusDot(p.status))} />
                            {p.name}
                          </span>
                        ))}
                        {sParts.length > 6 && <span className="px-1 py-0.5 text-xs text-slate-400">+{sParts.length - 6}</span>}
                      </div>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={ComponentIcon} title="No subsystems yet">
            {canEdit ? "Use the + next to “Subsystems” in the sidebar to create subsystems like Airframe, Recovery or Avionics." : "An editor needs to create subsystems."}
          </EmptyState>
        )}
      </section>

      <FilePanel
        title="Project-level files"
        placement={{ project_id: project.id }}
        files={files.filter((f) => !f.subsystem_id && !f.part_id)}
        canEdit={canEdit}
      />
    </Page>
  );
}
