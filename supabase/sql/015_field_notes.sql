-- Field Desk: site notes, assignments, follow-ups.
-- Run in SQL Editor on the exposed schema. Safe to re-run.

create table if not exists dro.field_notes (
  id bigserial primary key,
  site_type text not null check (site_type in ('office', 'ss', 'custom')),
  site_code text not null,
  site_name text not null default '',
  office_code text default '',
  office_type text default '',
  office_name text default '',
  division_code text default '',
  ccc_code text default '',
  region_code text default '341',
  kind text not null default 'note' check (kind in ('work', 'assignment', 'note')),
  title text not null default '',
  body text not null default '',
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  status text not null default 'open' check (status in ('open', 'waiting', 'done')),
  assigned_to jsonb not null default '[]'::jsonb,
  accompanied jsonb not null default '[]'::jsonb,
  followup_at timestamptz,
  last_visited_at timestamptz,
  updates jsonb not null default '[]'::jsonb,
  created_by text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_field_notes_followup on dro.field_notes(followup_at);
create index if not exists idx_field_notes_status on dro.field_notes(status);
create index if not exists idx_field_notes_site on dro.field_notes(site_type, site_code);
create index if not exists idx_field_notes_div on dro.field_notes(division_code);

do $$
begin
  if to_regclass('public.offices') is not null and to_regclass('public.field_notes') is null then
    create table if not exists public.field_notes (
      id bigserial primary key,
      site_type text not null check (site_type in ('office', 'ss', 'custom')),
      site_code text not null,
      site_name text not null default '',
      office_code text default '',
      office_type text default '',
      office_name text default '',
      division_code text default '',
      ccc_code text default '',
      region_code text default '341',
      kind text not null default 'note' check (kind in ('work', 'assignment', 'note')),
      title text not null default '',
      body text not null default '',
      priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
      status text not null default 'open' check (status in ('open', 'waiting', 'done')),
      assigned_to jsonb not null default '[]'::jsonb,
      accompanied jsonb not null default '[]'::jsonb,
      followup_at timestamptz,
      last_visited_at timestamptz,
      updates jsonb not null default '[]'::jsonb,
      created_by text default '',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create index if not exists idx_field_notes_followup on public.field_notes(followup_at);
    create index if not exists idx_field_notes_status on public.field_notes(status);
    create index if not exists idx_field_notes_site on public.field_notes(site_type, site_code);
    create index if not exists idx_field_notes_div on public.field_notes(division_code);
  end if;
end $$;

grant all on all tables in schema dro to service_role;
grant all on all sequences in schema dro to service_role;

notify pgrst, 'reload schema';
