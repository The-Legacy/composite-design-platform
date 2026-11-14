import { useState, type ComponentType, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router";
import {
  useMaterials,
  useMyRole,
  useParts,
  useProject,
  useProjectRealtime,
  useSubsystems,
  useTableMutations,
} from "../data/queries";
import { Badge, Button, ErrorText, Field, IconButton, Input, Kbd, Modal, Select, Spinner, cx, slugify, statusDot } from "../components/ui";
import { ChevronRightIcon, DashboardIcon, LayersIcon, PlusIcon, ScaleIcon, SearchIcon, SigmaIcon, UsersIcon } from "../components/icons";
import TopBar from "../components/TopBar";
import SearchPalette from "../components/SearchPalette";
import type { Part, Subsystem } from "../lib/types";
import type { ProjectCtx } from "./projectContext";

const navCls = ({ isActive }: { isActive: boolean }) =>
  cx(
    "group flex items-center gap-2.5 truncate rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
    isActive ? "bg-white font-medium text-slate-900 shadow-card ring-1 ring-slate-200/80" : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900",
  );

function NavItem({ to, end, icon: Icon, children }: { to: string; end?: boolean; icon: ComponentType<{ size?: number; className?: string }>; children: ReactNode }) {
  return (
    <NavLink end={end} to={to} className={navCls}>
      {({ isActive }) => (
        <>
          <Icon size={16} className={isActive ? "text-accent" : "text-slate-400 group-hover:text-slate-600"} />
          <span className="truncate">{children}</span>
        </>
      )}
    </NavLink>
  );
}

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
  const base = `/p/${projectId}`;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        actions={
          <button
            onClick={() => window.dispatchEvent(new Event("open-search"))}
            className="hidden h-8 w-64 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 text-[13px] text-slate-400 transition hover:border-slate-300 hover:bg-white hover:text-slate-600 md:flex"
          >
            <SearchIcon size={14} />
            <span className="flex-1 text-left">Search project…</span>
            <Kbd>Ctrl K</Kbd>
          </button>
        }
      >
        <Link to="/" className="hidden text-slate-500 hover:text-slate-800 sm:inline">
          Projects
        </Link>
        <ChevronRightIcon size={14} className="hidden text-slate-300 sm:block" />
        <Link to={base} className="truncate font-medium text-slate-900">
          {project.data.name}
        </Link>
        {role && (
          <Badge tone={role === "owner" ? "accent" : "neutral"} className="capitalize">
            {role}
          </Badge>
        )}
      </TopBar>
      <SearchPalette projectId={projectId} parts={ctx.parts} subsystems={ctx.subsystems} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200/80 bg-slate-50">
          <nav className="flex-1 space-y-0.5 overflow-auto px-3 py-4">
            <NavItem end to={base} icon={DashboardIcon}>
              Overview
            </NavItem>
            <NavItem to={`${base}/globals`} icon={SigmaIcon}>
              Project variables
            </NavItem>
            <NavItem to={`${base}/materials`} icon={LayersIcon}>
              Materials
            </NavItem>
            <NavItem to={`${base}/rollup`} icon={ScaleIcon}>
              Mass &amp; BOM
            </NavItem>
            <NavItem to={`${base}/settings`} icon={UsersIcon}>
              Team &amp; settings
            </NavItem>

            <div className="flex items-center justify-between px-2.5 pt-6 pb-1.5">
              <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Subsystems</span>
              {canEdit && (
                <IconButton size="sm" title="Add subsystem" onClick={() => setAddingSub(true)}>
                  <PlusIcon size={14} />
                </IconButton>
              )}
            </div>
            {ctx.subsystems.map((s) => (
              <SubsystemNav key={s.id} s={s} parts={ctx.parts.filter((p) => p.subsystem_id === s.id)} projectId={projectId} />
            ))}
            {!ctx.subsystems.length && (
              <div className="mx-1 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                No subsystems yet
                {canEdit && (
                  <button className="mt-1 block w-full font-medium text-accent hover:underline" onClick={() => setAddingSub(true)}>
                    Add the first one
                  </button>
                )}
              </div>
            )}
          </nav>
          {canEdit && ctx.subsystems.length > 0 && (
            <div className="border-t border-slate-200/80 p-3">
              <Button variant="primary" size="sm" className="h-8 w-full" onClick={() => setNewPartFor(null)}>
                <PlusIcon size={14} /> New part
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
      <div className="flex items-center gap-0.5">
        <button
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-700"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
        >
          <ChevronRightIcon size={13} className={cx("transition-transform", open && "rotate-90")} />
        </button>
        <NavLink to={`/p/${projectId}/s/${s.id}`} className={(a) => cx(navCls(a), "min-w-0 flex-1 pl-1.5")}>
          <span className="truncate">{s.name}</span>
          {parts.length > 0 && <span className="ml-auto text-[11px] font-normal text-slate-400 tabular-nums">{parts.length}</span>}
        </NavLink>
      </div>
      {open && parts.length > 0 && (
        <div className="relative mt-0.5 mb-1 ml-[18px] space-y-px border-l border-slate-200 pl-2">
          {parts.map((p) => (
            <NavLink key={p.id} to={`/p/${projectId}/part/${p.id}`} className={(a) => cx(navCls(a), "py-1")} title={`${p.name} · ${p.status}`}>
              <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", statusDot(p.status))} />
              <span className="truncate">{p.name}</span>
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
        <div className="flex justify-end gap-2 pt-2">
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
  const materials = useMaterials(projectId).data ?? [];
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [partNumber, setPartNumber] = useState("");
  const [subsystemId, setSubsystemId] = useState<string>("");
  const sid = subsystemId || defaultSubsystem || "";
  const effSlug = slugTouched ? slug : slugify(name);
  const slugTaken = parts.some((p) => p.slug === effSlug) || materials.some((m) => m.slug === effSlug);
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
              <span className="text-red-600">Another part or material already uses this ID</span>
            ) : (
              <>
                Other parts reference this part's variables as <code className="code-chip">{effSlug || "id"}.variable</code>
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
        <div className="flex justify-end gap-2 pt-2">
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
