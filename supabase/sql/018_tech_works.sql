-- Tech Works follow-up desk: categories + TAA / PO / progress fields.
-- Run in SQL Editor (public or dro). Safe to re-run.

do $$
declare
  sch text;
begin
  foreach sch in array array['public', 'dro'] loop
    if to_regclass(sch || '.tech_works') is null and to_regclass(sch || '.offices') is null then
      continue;
    end if;

    execute format($t$
      create table if not exists %I.tech_work_settings (
        id bigint primary key,
        author_users jsonb not null default '[]'::jsonb,
        updated_at timestamptz default now()
      )
    $t$, sch);

    execute format($t$
      create table if not exists %I.tech_work_categories (
        id bigserial primary key,
        name text not null,
        parameter_unit text not null default '',
        sort_order integer not null default 0,
        active boolean not null default true,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      )
    $t$, sch);

    if to_regclass(sch || '.tech_works') is null then
      continue;
    end if;

    execute format('alter table %I.tech_works add column if not exists category_id bigint', sch);
    execute format('alter table %I.tech_works add column if not exists category_name text', sch);
    execute format('alter table %I.tech_works add column if not exists description text', sch);
    execute format('alter table %I.tech_works add column if not exists related_ss_name text', sch);
    execute format('alter table %I.tech_works add column if not exists related_ss_id text', sch);
    execute format('alter table %I.tech_works add column if not exists existing_parameter numeric', sch);
    execute format('alter table %I.tech_works add column if not exists proposed_parameter numeric', sch);
    execute format('alter table %I.tech_works add column if not exists parameter_unit text', sch);
    execute format('alter table %I.tech_works add column if not exists proposal_enote_no text', sch);
    execute format('alter table %I.tech_works add column if not exists proposal_enote_date date', sch);
    execute format('alter table %I.tech_works add column if not exists taa_no text', sch);
    execute format('alter table %I.tech_works add column if not exists taa_date date', sch);
    execute format('alter table %I.tech_works add column if not exists scheme_value numeric', sch);
    execute format('alter table %I.tech_works add column if not exists billing_progress numeric', sch);
    execute format('alter table %I.tech_works add column if not exists major_material text', sch);
    execute format('alter table %I.tech_works add column if not exists pos jsonb default ''[]''::jsonb', sch);
    execute format('alter table %I.tech_works add column if not exists work_start_date date', sch);
    execute format('alter table %I.tech_works add column if not exists material_issue_status text default ''not_issued''', sch);
    execute format('alter table %I.tech_works add column if not exists work_progress integer default 0', sch);
    execute format('alter table %I.tech_works add column if not exists followups jsonb default ''[]''::jsonb', sch);
    execute format('alter table %I.tech_works add column if not exists followup_users jsonb default ''[]''::jsonb', sch);
    execute format('alter table %I.tech_works add column if not exists created_by text', sch);
    execute format('alter table %I.tech_works add column if not exists created_at timestamptz default now()', sch);
    execute format('alter table %I.tech_works add column if not exists last_followup_on timestamptz', sch);
    execute format('alter table %I.tech_works add column if not exists last_followup_by text', sch);

    execute format('create index if not exists idx_tech_works_div on %I.tech_works (division_code)', sch);
    execute format('create index if not exists idx_tech_works_status on %I.tech_works (status)', sch);
    execute format('create index if not exists idx_tech_works_cat on %I.tech_works (category_id)', sch);
  end loop;
end $$;

notify pgrst, 'reload schema';
