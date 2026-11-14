-- Composite Design Platform — initial schema
-- Projects -> Subsystems -> Parts, with files (stored in R2) and parametric variables.
-- All access is enforced with Row Level Security based on project membership.

create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'editor', 'viewer');
create type public.file_kind as enum ('model_3d', 'drawing', 'image', 'document', 'other');

-- ─────────────────────────────────────────────────────────────
-- Profiles (mirrors auth.users)
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Optional sign-up allowlist. If this table is EMPTY anyone with a Google account can sign in
-- (they still see nothing until added to a project). Add rows like '@umich.edu' or 'someone@gmail.com'
-- to restrict sign-ups.
create table public.signup_allowlist (
  pattern text primary key check (pattern like '@%' or pattern like '%@%')
);

-- Pending invites for people who have not signed in yet.
create table public.project_invites (
  project_id uuid not null,
  email text not null,
  role public.member_role not null default 'editor',
  invited_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (project_id, email)
);

-- ─────────────────────────────────────────────────────────────
-- Projects & membership
-- ─────────────────────────────────────────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_invites
  add constraint project_invites_project_fk foreign key (project_id) references public.projects (id) on delete cascade;

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on public.project_members (user_id);

-- ─────────────────────────────────────────────────────────────
-- Subsystems & parts
-- ─────────────────────────────────────────────────────────────
create table public.subsystems (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);
create index on public.subsystems (project_id);

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  subsystem_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  -- identifier used in equations, e.g. spar_cap.t_ply
  slug text not null check (slug ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  part_number text not null default '',
  description text not null default '',
  status text not null default 'concept',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, slug),
  foreign key (subsystem_id, project_id) references public.subsystems (id, project_id) on delete cascade
);
create index on public.parts (subsystem_id);

-- ─────────────────────────────────────────────────────────────
-- Files (bytes live in Cloudflare R2; this is the metadata)
-- ─────────────────────────────────────────────────────────────
create table public.files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  subsystem_id uuid,
  part_id uuid,
  name text not null,
  kind public.file_kind not null default 'other',
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  r2_key text not null unique,
  source text not null default 'upload' check (source in ('upload', 'drive')),
  drive_file_id text,
  drive_url text,
  revision text not null default '',
  notes text not null default '',
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (subsystem_id, project_id) references public.subsystems (id, project_id) on delete cascade,
  foreign key (part_id, project_id) references public.parts (id, project_id) on delete cascade
);
create index on public.files (project_id);
create index on public.files (part_id);
create index on public.files (subsystem_id);

-- ─────────────────────────────────────────────────────────────
-- Variables / equations
--   part_id null  => project-wide (global) variable, referenced by bare name
--   part_id set   => part variable, referenced by bare name inside the part,
--                    or as <part_slug>.<name> from anywhere
--   expression    => either a value ("135 GPa") or a formula ("E1 * t_ply / 2")
-- ─────────────────────────────────────────────────────────────
create table public.variables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  part_id uuid,
  name text not null check (name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  expression text not null default '0',
  display_unit text not null default '',
  description text not null default '',
  position int not null default 0,
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (project_id, part_id, name),
  foreign key (part_id, project_id) references public.parts (id, project_id) on delete cascade
);
create index on public.variables (project_id);

-- ─────────────────────────────────────────────────────────────
-- Helper functions (security definer so they can read membership under RLS)
-- ─────────────────────────────────────────────────────────────
create or replace function public.project_role(p_project uuid)
returns public.member_role
language sql stable security definer set search_path = '' as $$
  select role from public.project_members
  where project_id = p_project and user_id = auth.uid()
$$;

create or replace function public.is_member(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.project_role(p_project) is not null
$$;

create or replace function public.can_edit(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.project_role(p_project) in ('owner', 'editor'), false)
$$;

create or replace function public.is_owner(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.project_role(p_project) = 'owner', false)
$$;

-- ─────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger subsystems_updated_at before update on public.subsystems
  for each row execute function public.set_updated_at();
create trigger parts_updated_at before update on public.parts
  for each row execute function public.set_updated_at();
create trigger variables_updated_at before update on public.variables
  for each row execute function public.set_updated_at();

-- Track who last edited a variable
create or replace function public.set_updated_by()
returns trigger language plpgsql as $$
begin
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger variables_updated_by before update on public.variables
  for each row execute function public.set_updated_by();

-- New auth user -> allowlist check, profile row, accept pending invites
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(new.email);
begin
  if exists (select 1 from public.signup_allowlist)
     and not exists (
       select 1 from public.signup_allowlist a
       where (a.pattern like '@%' and v_email like '%' || lower(a.pattern))
          or lower(a.pattern) = v_email
     ) then
    raise exception 'Email % is not allowed to sign up for this workspace', v_email;
  end if;

  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    v_email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  insert into public.project_members (project_id, user_id, role)
  select project_id, new.id, role from public.project_invites where lower(email) = v_email
  on conflict do nothing;
  delete from public.project_invites where lower(email) = v_email;

  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Project creator becomes owner
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, auth.uid(), 'owner')
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger on_project_created after insert on public.projects
  for each row execute function public.handle_new_project();

-- Owners add members by email: existing users are added directly, others get an invite.
create or replace function public.add_project_member(p_project uuid, p_email text, p_role public.member_role)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if not public.is_owner(p_project) then
    raise exception 'Only project owners can add members';
  end if;
  select id into v_user from public.profiles where email = lower(trim(p_email));
  if v_user is not null then
    insert into public.project_members (project_id, user_id, role)
    values (p_project, v_user, p_role)
    on conflict (project_id, user_id) do update set role = excluded.role;
    return 'added';
  end if;
  insert into public.project_invites (project_id, email, role)
  values (p_project, lower(trim(p_email)), p_role)
  on conflict (project_id, email) do update set role = excluded.role;
  return 'invited';
end $$;

-- Don't allow removing/demoting the last owner
create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.projects where id = old.project_id)
     and (select count(*) from public.project_members
          where project_id = old.project_id and role = 'owner') <= 1 then
    raise exception 'A project must keep at least one owner';
  end if;
  return coalesce(new, old);
end $$;

create trigger project_members_last_owner before update or delete on public.project_members
  for each row execute function public.protect_last_owner();

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.signup_allowlist enable row level security;
alter table public.project_invites enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.subsystems enable row level security;
alter table public.parts enable row level security;
alter table public.files enable row level security;
alter table public.variables enable row level security;

-- profiles: any signed-in user can see profiles (needed to show teammates / add by email)
create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- signup_allowlist: managed from the Supabase dashboard only (no policies => no API access)

-- projects
create policy "members read projects" on public.projects
  for select to authenticated using (public.is_member(id) or created_by = auth.uid());
create policy "signed-in users create projects" on public.projects
  for insert to authenticated with check (created_by = auth.uid());
create policy "owners update projects" on public.projects
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
create policy "owners delete projects" on public.projects
  for delete to authenticated using (public.is_owner(id));

-- project_members
create policy "members read membership" on public.project_members
  for select to authenticated using (public.is_member(project_id));
create policy "owners manage membership" on public.project_members
  for all to authenticated using (public.is_owner(project_id)) with check (public.is_owner(project_id));
create policy "members can leave" on public.project_members
  for delete to authenticated using (user_id = auth.uid());

-- project_invites
create policy "members read invites" on public.project_invites
  for select to authenticated using (public.is_member(project_id));
create policy "owners manage invites" on public.project_invites
  for all to authenticated using (public.is_owner(project_id)) with check (public.is_owner(project_id));

-- content tables: members read, owners/editors write
do $$
declare t text;
begin
  foreach t in array array['subsystems', 'parts', 'files', 'variables'] loop
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_member(project_id))', t);
    execute format('create policy "editors insert %1$s" on public.%1$I for insert to authenticated with check (public.can_edit(project_id))', t);
    execute format('create policy "editors update %1$s" on public.%1$I for update to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id))', t);
    execute format('create policy "editors delete %1$s" on public.%1$I for delete to authenticated using (public.can_edit(project_id))', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Realtime: teammates see edits (esp. variable changes) live
-- ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.subsystems, public.parts, public.files, public.variables;
