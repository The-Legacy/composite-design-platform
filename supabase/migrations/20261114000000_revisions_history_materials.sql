-- File revisions, variable change history, materials library and ply layups.
-- Run after 20261113000000_init.sql.

-- ─────────────────────────────────────────────────────────────
-- File revisions
--   Every upload of "the same document" shares a lineage_id. rev_number counts up,
--   and the highest rev_number in a lineage is the current revision.
--   `revision` stays as a free-text label (e.g. "B", "PDR") shown next to the number.
-- ─────────────────────────────────────────────────────────────
alter table public.files
  add column lineage_id uuid not null default gen_random_uuid(),
  add column rev_number int not null default 1 check (rev_number >= 1);

alter table public.files add constraint files_lineage_rev_unique unique (lineage_id, rev_number);
create index on public.files (lineage_id);

-- ─────────────────────────────────────────────────────────────
-- Variable change history (written only by trigger; read by project members)
-- ─────────────────────────────────────────────────────────────
create table public.variable_history (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- no FK: history outlives the variable so deletions stay visible
  variable_id uuid not null,
  part_id uuid,
  name text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  old_name text,
  old_expression text,
  new_expression text,
  old_unit text,
  new_unit text,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index on public.variable_history (project_id, changed_at desc);
create index on public.variable_history (variable_id, changed_at desc);

create or replace function public.log_variable_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.variable_history (project_id, variable_id, part_id, name, op, new_expression, new_unit, changed_by)
    values (new.project_id, new.id, new.part_id, new.name, 'insert', new.expression, new.display_unit, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    if new.expression is distinct from old.expression
       or new.display_unit is distinct from old.display_unit
       or new.name is distinct from old.name then
      insert into public.variable_history
        (project_id, variable_id, part_id, name, op, old_name, old_expression, new_expression, old_unit, new_unit, changed_by)
      values
        (new.project_id, new.id, new.part_id, new.name, 'update',
         nullif(old.name, new.name), old.expression, new.expression, old.display_unit, new.display_unit, auth.uid());
    end if;
    return new;
  else
    -- Skip when the whole project is being deleted (the cascade would violate the FK).
    if exists (select 1 from public.projects where id = old.project_id) then
      insert into public.variable_history (project_id, variable_id, part_id, name, op, old_expression, old_unit, changed_by)
      values (old.project_id, old.id, old.part_id, old.name, 'delete', old.expression, old.display_unit, auth.uid());
    end if;
    return old;
  end if;
end $$;

create trigger variables_history after insert or update or delete on public.variables
  for each row execute function public.log_variable_change();

alter table public.variable_history enable row level security;
create policy "members read variable history" on public.variable_history
  for select to authenticated using (public.is_member(project_id));
-- no insert/update/delete policies: only the trigger writes, and nobody can rewrite history

-- ─────────────────────────────────────────────────────────────
-- Materials library (project-level)
--   Values are stored in fixed units (noted in the column names). Equations reference
--   them as <slug>.E1, <slug>.t_ply, ... with units attached.
-- ─────────────────────────────────────────────────────────────
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  slug text not null check (slug ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  form text not null default 'ud' check (form in ('ud', 'fabric', 'core', 'isotropic')),
  e1_gpa numeric,
  e2_gpa numeric,
  g12_gpa numeric,
  nu12 numeric,
  density_g_cc numeric,
  t_ply_mm numeric,
  xt_mpa numeric,
  xc_mpa numeric,
  yt_mpa numeric,
  yc_mpa numeric,
  s12_mpa numeric,
  cost_per_kg numeric,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, slug)
);
create index on public.materials (project_id);
create trigger materials_updated_at before update on public.materials
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Ply layups (per part, listed from the tool side / bottom up)
-- ─────────────────────────────────────────────────────────────
alter table public.parts add column layup_symmetric boolean not null default false;

create table public.layup_plies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  part_id uuid not null,
  material_id uuid not null,
  position int not null default 0,
  angle_deg numeric not null default 0 check (angle_deg between -90 and 90),
  count int not null default 1 check (count between 1 and 200),
  label text not null default '',
  created_at timestamptz not null default now(),
  foreign key (part_id, project_id) references public.parts (id, project_id) on delete cascade,
  -- CASCADE only so deleting a whole project works; protect_used_material() below stops
  -- anyone deleting a material that a layup still uses.
  foreign key (material_id, project_id) references public.materials (id, project_id) on delete cascade
);
create index on public.layup_plies (part_id);
create index on public.layup_plies (project_id);
create index on public.layup_plies (material_id);

create or replace function public.protect_used_material()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.projects where id = old.project_id)
     and exists (select 1 from public.layup_plies where material_id = old.id) then
    raise exception 'This material is used in a part layup; remove those plies first'
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end $$;

create trigger materials_protect_used before delete on public.materials
  for each row execute function public.protect_used_material();

alter table public.materials enable row level security;
alter table public.layup_plies enable row level security;

do $$
declare t text;
begin
  foreach t in array array['materials', 'layup_plies'] loop
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_member(project_id))', t);
    execute format('create policy "editors insert %1$s" on public.%1$I for insert to authenticated with check (public.can_edit(project_id))', t);
    execute format('create policy "editors update %1$s" on public.%1$I for update to authenticated using (public.can_edit(project_id)) with check (public.can_edit(project_id))', t);
    execute format('create policy "editors delete %1$s" on public.%1$I for delete to authenticated using (public.can_edit(project_id))', t);
  end loop;
end $$;

alter publication supabase_realtime add table public.materials, public.layup_plies, public.variable_history;
