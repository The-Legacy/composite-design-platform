import { useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router";
import {
  useMyRole,
  useParts,
  useProject,
  useProjectRealtime,
  useSubsystems,
  useTableMutations,
} from "../data/queries";
import { Button, ErrorText, Field, Input, Modal, Select, Spinner, cx, slugify } from "../components/ui";
import TopBar from "../components/TopBar";
import type { Part, Subsystem } from "../lib/types";
import type { ProjectCtx } from "./projectContext";

const navCls = ({ isActive }: { isActive: boolean }) =>
  cx(
    "block truncate rounded-md px-2.5 py-1.5 text-sm",
    isActive ? "bg-accent-soft font-medium text-accent" : "text-slate-700 hover:bg-slate-100",
  );

export default function ProjectLayout() {
  const { projectId = "" } = useParams();
  useProjectRealtime(projectId);
  const project = useProject(projectId);
  const subsystems = useSubsystems(projectId);
  const parts = useParts(projectId);
  const role = useMyRole(projectId);
  const canEdit = role === "owner" || role === "editor";
  const [newPartFor, setNewPartFor] = useState<string | null | undefined>(undefined);
  const [addingSub, setAddingSub] = useState(false);

  if (project.isLoading) return <Spinner full />;
  if (project.error || !project.data)
    return (
      <div className="p-8">
        <ErrorText error={project.error ?? new Error("Project not found")} />
      </div>
    );

  const ctx: ProjectCtx = {
    project: project.data,
    role,
    canEdit,
    subsystems: subsystems.data ?? [],
    parts: parts.data ?? [],
    openNewPart: (sid) => setNewPartFor(sid ?? null),
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar>
        <span className="font-medium text-slate-800">{project.data.name}</span>
        {role && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{role}</span>}
      </TopBar>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
          <nav className="flex-1 space-y-0.5 overflow-auto p-3">
            <NavLink end to={`/p/${projectId}`} className={navCls}>
              Overview
            </NavLink>
            <NavLink to={`/p/${projectId}/globals`} className={navCls}>
              Project variables
            </NavLink>
            <NavLink to={`/p/${projectId}/settings`} className={navCls}>
              Team &amp; settings
            </NavLink>

            <div className="flex items-center justify-between px-2.5 pt-5 pb-1">
              <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Subsystems</span>
              {canEdit && (
                <button className="text-xs text-accent hover:underline" onClick={() => setAddingSub(true)}>
                  + Add
                </button>
              )}
            </div>
            {ctx.subsystems.map((s) => (
              <SubsystemNav key={s.id} s={s} parts={ctx.parts.filter((p) => p.subsystem_id === s.id)} projectId={projectId} />
            ))}
            {!ctx.subsystems.length && <div className="px-2.5 text-xs text-slate-400">No subsystems yet</div>}
          </nav>
          {canEdit && ctx.subsystems.length > 0 && (
            <div className="border-t border-slate-200 p-3">
              <Button size="sm" className="w-full" onClick={() => setNewPartFor(null)}>
                + New part
              </Button>
            </div>
          )}
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet context={ctx} />
        </main>
      </div>
      <NewSubsystemModal open={addingSub} onClose={() => setAddingSub(false)} projectId={projectId} count={ctx.subsystems.length} />
      <NewPartModal
        open={newPartFor !== undefined}
        onClose={() => setNewPartFor(undefined)}
        projectId={projectId}
        subsystems={ctx.subsystems}
        parts={ctx.parts}
        defaultSubsystem={newPartFor ?? ctx.subsystems[0]?.id}
      />
    </div>
  );
}

function SubsystemNav({ s, parts, projectId }: { s: Subsystem; parts: Part[]; projectId: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div className="flex items-center">
        <button className="w-5 text-xs text-slate-400" onClick={() => setOpen(!open)} aria-label="toggle">
          {open ? "▾" : "▸"}
        </button>
        <NavLink to={`/p/${projectId}/s/${s.id}`} className={(a) => cx(navCls(a), "flex-1 pl-1")}>
          {s.name}
        </NavLink>
      </div>
      {open && (
        <div className="ml-5 border-l border-slate-200 pl-1">
          {parts.map((p) => (
            <NavLink key={p.id} to={`/p/${projectId}/part/${p.id}`} className={(a) => cx(navCls(a), "py-1 text-[13px]")}>
              {p.name}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function NewSubsystemModal({ open, onClose, projectId, count }: { open: boolean; onClose: () => void; projectId: string; count: number }) {
  const { create } = useTableMutations<Subsystem>("subsystems", projectId);
  const [name, setName] = useState("");
  const navigate = useNavigate();
  return (
    <Modal open={open} onClose={onClose} title="New subsystem">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const s = await create.mutateAsync({ name: name.trim(), position: count });
          setName("");
          onClose();
          navigate(`/p/${projectId}/s/${s.id}`);
        }}
      >
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Airframe, Recovery, Propulsion" />
        </Field>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || create.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NewPartModal({
  open,
  onClose,
  projectId,
  subsystems,
  parts,
  defaultSubsystem,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  subsystems: Subsystem[];
  parts: Part[];
  defaultSubsystem?: string;
}) {
  const { create } = useTableMutations<Part>("parts", projectId);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [partNumber, setPartNumber] = useState("");
  const [subsystemId, setSubsystemId] = useState<string>("");
  const sid = subsystemId || defaultSubsystem || "";
  const effSlug = slugTouched ? slug : slugify(name);
  const slugTaken = parts.some((p) => p.slug === effSlug);
  const slugValid = /^[A-Za-z][A-Za-z0-9_]*$/.test(effSlug);

  const reset = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setPartNumber("");
    setSubsystemId("");
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New part"
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const p = await create.mutateAsync({ name: name.trim(), slug: effSlug, part_number: partNumber, subsystem_id: sid });
          reset();
          onClose();
          navigate(`/p/${projectId}/part/${p.id}`);
        }}
      >
        <Field label="Subsystem">
          <Select className="w-full" value={sid} onChange={(e) => setSubsystemId(e.target.value)}>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Part name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spar cap" />
        </Field>
        <Field
          label="Equation ID"
          hint={
            slugTaken ? (
              <span className="text-red-600">Another part already uses this ID</span>
            ) : (
              <>
                Other parts reference this part's variables as <code className="font-mono">{effSlug || "id"}.variable</code>
              </>
            )
          }
        >
          <Input
            className="font-mono"
            value={effSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
        <Field label="Part number (optional)">
          <Input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="e.g. AF-102" />
        </Field>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || !sid || slugTaken || !slugValid || create.isPending}>
            Create part
          </Button>
        </div>
      </form>
    </Modal>
  );
}
