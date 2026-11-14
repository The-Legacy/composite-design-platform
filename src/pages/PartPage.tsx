import type { ReactNode } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { useFiles, useTableMutations } from "../data/queries";
import { deleteFiles } from "../lib/api";
import { PART_STATUSES, type Part } from "../lib/types";
import { Card, DangerRow, Page, PageHeader, Select, StatusBadge } from "../components/ui";
import { ChevronRightIcon } from "../components/icons";
import FilePanel from "../components/FilePanel";
import EquationSheet from "../components/EquationSheet";
import LayupPanel from "../components/LayupPanel";
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
    <Page>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Link to={`/p/${project.id}/s/${part.subsystem_id}`} className="hover:text-accent">
              {subsystem?.name}
            </Link>
            <ChevronRightIcon size={12} className="text-slate-300" />
            <span>Part</span>
          </span>
        }
        title={<InlineEdit value={part.name} disabled={!canEdit} onSave={(name) => name.trim() && save({ name })} className="font-semibold tracking-tight" />}
        description={
          <InlineEdit
            value={part.description}
            disabled={!canEdit}
            multiline
            placeholder="Add a description (material, layup, function)…"
            onSave={(description) => save({ description })}
          />
        }
        actions={<StatusBadge status={part.status} />}
      />

      <Card className="grid grid-cols-2 divide-slate-100 sm:grid-cols-4 sm:divide-x">
        <Meta label="Part number">
          <InlineEdit value={part.part_number} disabled={!canEdit} placeholder="—" onSave={(part_number) => save({ part_number })} className="font-mono text-sm text-slate-800" />
        </Meta>
        <Meta label="Equation ID">
          <div className="py-0.5 font-mono text-sm text-slate-800" title="Rename by recreating — formulas in other parts reference this">
            {part.slug}
          </div>
        </Meta>
        <Meta label="Status">
          <Select compact value={part.status} disabled={!canEdit} onChange={(e) => save({ status: e.target.value })} className="w-full capitalize">
            {PART_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Meta>
        <Meta label="Subsystem">
          <Select compact value={part.subsystem_id} disabled={!canEdit} onChange={(e) => save({ subsystem_id: e.target.value })} className="w-full">
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Meta>
      </Card>

      <LayupPanel part={part} canEdit={canEdit} />

      <EquationSheet projectId={project.id} partId={part.id} canEdit={canEdit} />

      <FilePanel title="Drawings, models & files" placement={{ project_id: project.id, part_id: part.id }} files={partFiles} canEdit={canEdit} />

      {canEdit && (
        <DangerRow
          label="Delete part"
          text={`Removes ${part.name}, its ${partFiles.length} files (all revisions), layup and variables.`}
          onClick={async () => {
            if (!confirm(`Delete part “${part.name}” with its ${partFiles.length} files (all revisions), layup and variables? Formulas in other parts that use ${part.slug}.* will show errors.`)) return;
            await deleteFiles(partFiles.map((f) => f.id));
            await remove.mutateAsync(part.id);
            navigate(`/p/${project.id}/s/${part.subsystem_id}`);
          }}
        />
      )}
    </Page>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="mb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</div>
      {children}
    </div>
  );
}
