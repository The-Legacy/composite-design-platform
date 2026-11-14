import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { useFiles, useInvites, useMemberMutations, useMembers, useUpdateProject } from "../data/queries";
import { deleteFiles } from "../lib/api";
import { supabase, unwrap } from "../lib/supabase";
import type { Role } from "../lib/types";
import { Avatar, Badge, Button, Card, CardHeader, ErrorText, Input, Page, PageHeader, Select } from "../components/ui";
import { AlertIcon, FolderIcon, UsersIcon } from "../components/icons";
import InlineEdit from "../components/InlineEdit";
import { useProjectCtx } from "./projectContext";
import { useQueryClient } from "@tanstack/react-query";

const ROLES: { value: Role; label: string }[] = [
  { value: "owner", label: "Owner — manage team" },
  { value: "editor", label: "Editor — upload & edit" },
  { value: "viewer", label: "Viewer — read only" },
];

export default function SettingsPage() {
  const { project, role } = useProjectCtx();
  const isOwner = role === "owner";
  const { user } = useAuth();
  const members = useMembers(project.id);
  const invites = useInvites(project.id);
  const files = useFiles(project.id).data ?? [];
  const m = useMemberMutations(project.id);
  const updateProject = useUpdateProject(project.id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("editor");
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Page width="narrow">
      <PageHeader title="Team & settings" description="Manage who can see and edit this project." />

      <Card className="overflow-hidden">
        <CardHeader icon={FolderIcon} title="Project" />
        <div className="space-y-4 p-5">
          <div>
            <div className="mb-1 text-[13px] font-medium text-slate-700">Name</div>
            <InlineEdit value={project.name} disabled={!isOwner} onSave={(name) => name.trim() && updateProject.mutate({ name })} />
          </div>
          <div>
            <div className="mb-1 text-[13px] font-medium text-slate-700">Description</div>
            <InlineEdit value={project.description} disabled={!isOwner} multiline placeholder="Add a description…" onSave={(description) => updateProject.mutate({ description })} />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader icon={UsersIcon} title="Members" description={`${members.data?.length ?? 0} members${invites.data?.length ? ` · ${invites.data.length} pending` : ""}`} />
        <ul className="divide-y divide-slate-100">
          {members.data?.map((mem) => (
            <li key={mem.user_id} className="flex items-center gap-3 px-5 py-3">
              <Avatar src={mem.profiles?.avatar_url} name={mem.profiles?.full_name ?? mem.profiles?.email} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate text-sm font-medium text-slate-900">
                  {mem.profiles?.full_name ?? mem.profiles?.email}
                  {mem.user_id === user?.id && <Badge>You</Badge>}
                </div>
                <div className="truncate text-xs text-slate-500">{mem.profiles?.email}</div>
              </div>
              {isOwner ? (
                <>
                  <Select compact value={mem.role} onChange={(e) => m.setRole.mutate({ userId: mem.user_id, role: e.target.value as Role })} className="capitalize">
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.value}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => confirm("Remove this member?") && m.remove.mutate(mem.user_id)}>
                    Remove
                  </Button>
                </>
              ) : (
                <Badge tone={mem.role === "owner" ? "accent" : "neutral"} className="capitalize">
                  {mem.role}
                </Badge>
              )}
            </li>
          ))}
          {invites.data?.map((inv) => (
            <li key={inv.email} className="flex items-center gap-3 px-5 py-3 text-sm">
              <div className="h-[34px] w-[34px] shrink-0 rounded-full border border-dashed border-slate-300 bg-slate-50" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate font-medium text-slate-800">
                  {inv.email} <Badge tone="amber">Pending</Badge>
                </div>
                <div className="text-xs text-slate-500">Invited as {inv.role} — joins automatically on first sign-in</div>
              </div>
              {isOwner && (
                <Button size="sm" variant="ghost" onClick={() => m.cancelInvite.mutate(inv.email)}>
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <form
            className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setMsg(null);
              const r = await m.add.mutateAsync({ email, role: newRole });
              setMsg(r === "added" ? `Added ${email}` : `Invited ${email} — they'll get access when they first sign in with Google`);
              setEmail("");
            }}
          >
            <Input type="email" required placeholder="teammate@umich.edu" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-[200px] flex-1" />
            <Select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Button variant="primary" disabled={m.add.isPending}>
              Add member
            </Button>
          </form>
        )}
        {(msg || m.add.error || m.setRole.error || m.remove.error) && (
          <div className="space-y-2 px-5 pb-4">
            {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
            <ErrorText error={m.add.error ?? m.setRole.error ?? m.remove.error} />
          </div>
        )}
      </Card>

      {isOwner && (
        <Card className="overflow-hidden border-red-200">
          <div className="flex flex-wrap items-center gap-4 p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <AlertIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-red-700">Delete this project</h2>
            <p className="mt-0.5 text-sm text-slate-600">Removes all subsystems, parts, variables and {files.length} files permanently.</p>
          </div>
          <Button
            variant="danger"
            onClick={async () => {
              if (prompt(`Type the project name (${project.name}) to delete it:`) !== project.name) return;
              await deleteFiles(files.map((f) => f.id));
              unwrap(await supabase.from("projects").delete().eq("id", project.id));
              await qc.invalidateQueries({ queryKey: ["projects"] });
              navigate("/");
            }}
          >
            Delete project
          </Button>
          </div>
        </Card>
      )}
    </Page>
  );
}
