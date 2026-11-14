import { useNavigate, useParams, Link } from "react-router";
import { useFiles, useTableMutations } from "../data/queries";
import { deleteFiles } from "../lib/api";
import { PART_STATUSES, type Part } from "../lib/types";
import { Button, Select } from "../components/ui";
import FilePanel from "../components/FilePanel";
import EquationSheet from "../components/EquationSheet";
import InlineEdit from "../components/InlineEdit";
import { useProjectCtx } from "./projectContext";

export default function PartPage() {
  const { partId = "" } = useParams();
  const { project, subsystems, parts, canEdit } = useProjectCtx();
  const files = useFiles(project.id).data ?? [];
  const { update, remove } = useTableMutations<Part>("parts", project.id);
  const navigate = useNavigate();
  const part = parts.find((p) => p.id === partId);
  if (!part) return <div className="p-6 text-slate-500">Part not found.</div>;
  const subsystem = subsystems.find((s) => s.id === part.subsystem_id);
  const partFiles = files.filter((f) => f.part_id === part.id);
  const save = (patch: Partial<Part>) => update.mutate({ id: part.id, ...patch });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-400">
            <Link to={`/p/${project.id}/s/${part.subsystem_id}`} className="hover:text-accent">
              {subsystem?.name}
            </Link>{" "}
            / part
          </div>
          <InlineEdit value={part.name} disabled={!canEdit} onSave={(name) => name.trim() && save({ name })} className="text-2xl font-semibold" />
          <InlineEdit
            value={part.description}
            disabled={!canEdit}
            multiline
            placeholder="Add a description (material, layup, function)…"
            onSave={(description) => save({ description })}
            className="mt-1 text-slate-600"
          />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <label className="text-xs text-slate-500">
            Part number
            <InlineEdit value={part.part_number} disabled={!canEdit} placeholder="—" onSave={(part_number) => save({ part_number })} className="font-mono text-sm text-slate-800" />
          </label>
          <label className="text-xs text-slate-500">
            Equation ID
            <div className="font-mono text-sm text-slate-800" title="Rename by recreating — formulas in other parts reference this">
              {part.slug}
            </div>
          </label>
          <label className="text-xs text-slate-500">
            Status
            <Select value={part.status} disabled={!canEdit} onChange={(e) => save({ status: e.target.value })} className="mt-0.5 block w-full py-1">
              {PART_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-slate-500">
            Subsystem
            <Select value={part.subsystem_id} disabled={!canEdit} onChange={(e) => save({ subsystem_id: e.target.value })} className="mt-0.5 block w-full py-1">
              {subsystems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>

      <EquationSheet projectId={project.id} partId={part.id} canEdit={canEdit} />

      <FilePanel title="Drawings, models & files" placement={{ project_id: project.id, part_id: part.id }} files={partFiles} canEdit={canEdit} />

      {canEdit && (
        <div className="flex justify-end">
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (!confirm(`Delete part “${part.name}” with its ${partFiles.length} files and all its variables? Formulas in other parts that use ${part.slug}.* will show errors.`)) return;
              await deleteFiles(partFiles.map((f) => f.id));
              await remove.mutateAsync(part.id);
              navigate(`/p/${project.id}/s/${part.subsystem_id}`);
            }}
          >
            Delete part
          </Button>
        </div>
      )}
    </div>
  );
}
