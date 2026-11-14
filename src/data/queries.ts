import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "../lib/supabase";
import type { FileRow, Invite, LayupPly, Material, Member, Part, Project, Role, Subsystem, Variable, VariableChange } from "../lib/types";
import { useAuth } from "../auth/AuthProvider";

export const qk = {
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  members: (id: string) => ["members", id] as const,
  invites: (id: string) => ["invites", id] as const,
  subsystems: (id: string) => ["subsystems", id] as const,
  parts: (id: string) => ["parts", id] as const,
  files: (id: string) => ["files", id] as const,
  variables: (id: string) => ["variables", id] as const,
  materials: (id: string) => ["materials", id] as const,
  layup_plies: (id: string) => ["layup_plies", id] as const,
  history: (id: string) => ["history", id] as const,
};

// ── Projects ───────────────────────────────────────────────────
export function useProjects() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: async () => unwrap(await supabase.from("projects").select("*").order("created_at")) as Project[],
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: qk.project(projectId),
    queryFn: async () => unwrap(await supabase.from("projects").select("*").eq("id", projectId).single()) as Project,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (p: { name: string; description: string }) =>
      unwrap(await supabase.from("projects").insert({ ...p, created_by: user!.id }).select().single()) as Project,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

export function useUpdateProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Project, "name" | "description">>) =>
      unwrap(await supabase.from("projects").update(patch).eq("id", projectId).select().single()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.project(projectId) });
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

// ── Members ────────────────────────────────────────────────────
export function useMembers(projectId: string) {
  return useQuery({
    queryKey: qk.members(projectId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from("project_members")
          .select("project_id, user_id, role, profiles(id, email, full_name, avatar_url)")
          .eq("project_id", projectId),
      ) as unknown as Member[],
  });
}

export function useMyRole(projectId: string): Role | null {
  const { user } = useAuth();
  const { data } = useMembers(projectId);
  return data?.find((m) => m.user_id === user?.id)?.role ?? null;
}

export function useInvites(projectId: string) {
  return useQuery({
    queryKey: qk.invites(projectId),
    queryFn: async () => unwrap(await supabase.from("project_invites").select("*").eq("project_id", projectId)) as Invite[],
  });
}

export function useMemberMutations(projectId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.members(projectId) });
    qc.invalidateQueries({ queryKey: qk.invites(projectId) });
  };
  return {
    add: useMutation({
      mutationFn: async ({ email, role }: { email: string; role: Role }) =>
        unwrap(await supabase.rpc("add_project_member", { p_project: projectId, p_email: email, p_role: role })) as string,
      onSuccess: refresh,
    }),
    setRole: useMutation({
      mutationFn: async ({ userId, role }: { userId: string; role: Role }) =>
        unwrap(await supabase.from("project_members").update({ role }).eq("project_id", projectId).eq("user_id", userId)),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (userId: string) =>
        unwrap(await supabase.from("project_members").delete().eq("project_id", projectId).eq("user_id", userId)),
      onSuccess: refresh,
    }),
    cancelInvite: useMutation({
      mutationFn: async (email: string) =>
        unwrap(await supabase.from("project_invites").delete().eq("project_id", projectId).eq("email", email)),
      onSuccess: refresh,
    }),
  };
}

// ── Project content (loaded once per project, kept fresh by realtime) ──
export function useSubsystems(projectId: string) {
  return useQuery({
    queryKey: qk.subsystems(projectId),
    queryFn: async () =>
      unwrap(await supabase.from("subsystems").select("*").eq("project_id", projectId).order("position").order("name")) as Subsystem[],
  });
}

export function useParts(projectId: string) {
  return useQuery({
    queryKey: qk.parts(projectId),
    queryFn: async () => unwrap(await supabase.from("parts").select("*").eq("project_id", projectId).order("name")) as Part[],
  });
}

export function useFiles(projectId: string) {
  return useQuery({
    queryKey: qk.files(projectId),
    queryFn: async () =>
      unwrap(await supabase.from("files").select("*").eq("project_id", projectId).order("created_at", { ascending: false })) as FileRow[],
  });
}

export function useVariables(projectId: string) {
  return useQuery({
    queryKey: qk.variables(projectId),
    queryFn: async () =>
      unwrap(await supabase.from("variables").select("*").eq("project_id", projectId).order("position").order("created_at")) as Variable[],
  });
}

export function useMaterials(projectId: string) {
  return useQuery({
    queryKey: qk.materials(projectId),
    queryFn: async () => unwrap(await supabase.from("materials").select("*").eq("project_id", projectId).order("name")) as Material[],
  });
}

export function useLayupPlies(projectId: string) {
  return useQuery({
    queryKey: qk.layup_plies(projectId),
    queryFn: async () =>
      unwrap(await supabase.from("layup_plies").select("*").eq("project_id", projectId).order("position").order("created_at")) as LayupPly[],
  });
}

/** Recent variable changes in the project, newest first (optionally for one variable). */
export function useVariableHistory(projectId: string, opts: { variableId?: string; limit?: number; enabled?: boolean } = {}) {
  const { variableId, limit = 100, enabled = true } = opts;
  return useQuery({
    queryKey: [...qk.history(projectId), variableId ?? "all", limit],
    enabled,
    queryFn: async () => {
      let q = supabase
        .from("variable_history")
        .select("*, profiles(full_name, email)")
        .eq("project_id", projectId)
        .order("changed_at", { ascending: false })
        .limit(limit);
      if (variableId) q = q.eq("variable_id", variableId);
      return unwrap(await q) as unknown as VariableChange[];
    },
  });
}

/** Live updates: when a teammate changes anything in this project, refetch it. */
export function useProjectRealtime(projectId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const tables: [string, readonly unknown[]][] = [
      ["subsystems", qk.subsystems(projectId)],
      ["parts", qk.parts(projectId)],
      ["files", qk.files(projectId)],
      ["variables", qk.variables(projectId)],
      ["materials", qk.materials(projectId)],
      ["layup_plies", qk.layup_plies(projectId)],
      ["variable_history", qk.history(projectId)],
    ];
    let channel = supabase.channel(`project:${projectId}`);
    for (const [table, key] of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: key }),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, qc]);
}

// ── Generic CRUD helpers for content tables ────────────────────
type Table = "subsystems" | "parts" | "variables" | "files" | "materials" | "layup_plies";

export function useTableMutations<T extends { id: string }>(table: Table, projectId: string) {
  const qc = useQueryClient();
  const key = qk[table](projectId);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return {
    create: useMutation({
      mutationFn: async (row: Partial<T>) =>
        unwrap(await supabase.from(table).insert({ ...row, project_id: projectId }).select().single()) as T,
      onSuccess: () => {
        refresh();
        if (table === "variables") qc.invalidateQueries({ queryKey: qk.history(projectId) });
      },
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: Partial<T> & { id: string }) =>
        unwrap(await supabase.from(table).update(patch as Record<string, unknown>).eq("id", id).select().single()) as T,
      // optimistic update so typing in the equation sheet feels instant
      onMutate: async ({ id, ...patch }) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<T[]>(key);
        qc.setQueryData<T[]>(key, (rows) => rows?.map((r) => (r.id === id ? { ...r, ...patch } : r)));
        return { prev };
      },
      onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
      onSettled: () => {
        refresh();
        if (table === "variables") qc.invalidateQueries({ queryKey: qk.history(projectId) });
      },
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await supabase.from(table).delete().eq("id", id)),
      onSuccess: refresh,
    }),
  };
}
