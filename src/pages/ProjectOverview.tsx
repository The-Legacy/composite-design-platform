import { Link } from "react-router";
import { useFiles, useVariables } from "../data/queries";
import { Card, EmptyState } from "../components/ui";
import FilePanel, { groupRevisions } from "../components/FilePanel";
import { useProjectCtx } from "./projectContext";

export default function ProjectOverview() {
  const { project, subsystems, parts, canEdit } = useProjectCtx();
  const files = useFiles(project.id).data ?? [];
  const vars = useVariables(project.id).data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        {project.description && <p className="mt-1 text-slate-600">{project.description}</p>}
        <div className="mt-3 flex gap-6 text-sm text-slate-500">
          <span>
            <b className="text-slate-800">{subsystems.length}</b> subsystems
          </span>
          <span>
            <b className="text-slate-800">{parts.length}</b> parts
          </span>
          <span>
            <b className="text-slate-800">{groupRevisions(files).length}</b> files
          </span>
          <span>
            <b className="text-slate-800">{vars.length}</b> variables
          </span>
        </div>
      </div>

      {subsystems.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subsystems.map((s) => {
            const sParts = parts.filter((p) => p.subsystem_id === s.id);
            const sPartIds = new Set(sParts.map((p) => p.id));
            const nFiles = files.filter((f) => f.subsystem_id === s.id || (f.part_id && sPartIds.has(f.part_id))).length;
            return (
              <Link key={s.id} to={`s/${s.id}`}>
                <Card className="h-full p-4 transition hover:border-accent hover:shadow-md">
                  <div className="font-semibold">{s.name}</div>
                  {s.description && <div className="mt-0.5 line-clamp-2 text-sm text-slate-500">{s.description}</div>}
                  <div className="mt-3 text-xs text-slate-500">
                    {sParts.length} parts · {nFiles} files
                  </div>
                  {sParts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {sParts.slice(0, 6).map((p) => (
                        <span key={p.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No subsystems yet">
          {canEdit ? "Use “+ Add” in the sidebar to create subsystems like Airframe, Recovery or Avionics." : "An editor needs to create subsystems."}
        </EmptyState>
      )}

      <FilePanel
        title="Project-level files"
        placement={{ project_id: project.id }}
        files={files.filter((f) => !f.subsystem_id && !f.part_id)}
        canEdit={canEdit}
      />
    </div>
  );
}
