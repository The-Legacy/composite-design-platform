import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { useFiles, useInvites, useMemberMutations, useMembers, useUpdateProject } from "../data/queries";
import { deleteFiles } from "../lib/api";
import { supabase, unwrap } from "../lib/supabase";
import type { Role } from "../lib/types";
import { Button, Card, ErrorText, Input, Select } from "../components/ui";
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
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Team &amp; settings</h1>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Project</h2>
        <div>
          <div className="text-xs text-slate-500">Name</div>
          <InlineEdit value={project.name} disabled={!isOwner} onSave={(name) => name.trim() && updateProject.mutate({ name })} />
        </div>
        <div>
          <div className="text-xs text-slate-500">Description</div>
          <InlineEdit value={project.description} disabled={!isOwner} multiline onSave={(description) => updateProject.mutate({ description })} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3 font-semibold">Members</div>
        <ul className="divide-y divide-slate-100">
          {members.data?.map((mem) => (
            <li key={mem.user_id} className="flex items-center gap-3 px-5 py-2.5">
              {mem.profiles?.avatar_url ? (
                <img src={mem.profiles.avatar_url} className="h-8 w-8 rounded-full" alt="" referrerPolicy="no-referrer" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-slate-200" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {mem.profiles?.full_name ?? mem.profiles?.email}
                  {mem.user_id === user?.id && <span className="ml-1 text-slate-400">(you)</span>}
                </div>
                <div className="truncate text-xs text-slate-500">{mem.profiles?.email}</div>
              </div>
              {isOwner ? (
                <>
                  <Select value={mem.role} onChange={(e) => m.setRole.mutate({ userId: mem.user_id, role: e.target.value as Role })} className="py-1 text-xs">
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
                <span className="text-xs text-slate-500">{mem.role}</span>
              )}
            </li>
          ))}
          {invites.data?.map((inv) => (
            <li key={inv.email} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <div className="h-8 w-8 rounded-full border border-dashed border-slate-300" />
              <div className="flex-1">
                <div>{inv.email}</div>
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
            className="flex flex-wrap gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3"
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
        <div className="space-y-2 px-5 pb-3">
          {msg && <div className="text-sm text-emerald-700">{msg}</div>}
          <ErrorText error={m.add.error ?? m.setRole.error ?? m.remove.error} />
        </div>
      </Card>

      {isOwner && (
        <Card className="border-red-200 p-5">
          <h2 className="font-semibold text-red-700">Danger zone</h2>
          <p className="mt-1 mb-3 text-sm text-slate-600">Deleting the project removes all subsystems, parts, variables and {files.length} files permanently.</p>
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
        </Card>
      )}
    </div>
  );
}
