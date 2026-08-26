-- NSC exchange: SQL is the snapshot. Run in SQL Editor (public or dro).
-- Safe to re-run.

do $$
declare
  sch text;
begin
  foreach sch in array array['public', 'dro'] loop
    if to_regclass(sch || '.nsc_cases') is null then
      continue;
    end if;

    execute format('alter table %I.nsc_cases add column if not exists pole_count integer', sch);
    execute format('alter table %I.nsc_cases add column if not exists applicant_type text', sch);
    execute format('alter table %I.nsc_cases add column if not exists procedure text', sch);
    execute format('alter table %I.nsc_cases add column if not exists report_date date', sch);
    execute format('alter table %I.nsc_cases add column if not exists quotation_age_slab text', sch);
    execute format('alter table %I.nsc_cases add column if not exists processing_slab text', sch);
    execute format('alter table %I.nsc_cases add column if not exists quotation_age_days integer', sch);
    execute format('alter table %I.nsc_cases add column if not exists processing_days integer', sch);
    execute format('alter table %I.nsc_cases add column if not exists consumer_class text', sch);
    execute format('alter table %I.nsc_cases add column if not exists sap_status text', sch);
    execute format('alter table %I.nsc_cases add column if not exists withheld_on date', sch);
    execute format('alter table %I.nsc_cases add column if not exists withheld_reason text', sch);
    execute format('alter table %I.nsc_cases add column if not exists collected_on date', sch);
    execute format('alter table %I.nsc_cases add column if not exists quotation_issue_on date', sch);
    execute format('alter table %I.nsc_cases add column if not exists created_on date', sch);
    execute format('alter table %I.nsc_cases add column if not exists class_code text', sch);
    execute format('alter table %I.nsc_cases add column if not exists wo_issued text', sch);
    execute format('alter table %I.nsc_cases add column if not exists wo_no text', sch);
    execute format('alter table %I.nsc_cases add column if not exists agency_name text', sch);
    execute format('alter table %I.nsc_cases add column if not exists phone text', sch);
    execute format('alter table %I.nsc_cases add column if not exists consumer_id text', sch);

    execute format('create unique index if not exists nsc_cases_application_no_uidx on %I.nsc_cases (application_no)', sch);
    execute format('create index if not exists idx_nsc_status on %I.nsc_cases (status)', sch);
    execute format('create index if not exists idx_nsc_ccc on %I.nsc_cases (ccc_code)', sch);
    execute format('create index if not exists idx_nsc_div on %I.nsc_cases (division_code)', sch);
    execute format('create index if not exists idx_nsc_class on %I.nsc_cases (consumer_class)', sch);
    execute format('create index if not exists idx_nsc_qslab on %I.nsc_cases (quotation_age_slab)', sch);
    execute format('create index if not exists idx_nsc_pslab on %I.nsc_cases (processing_slab)', sch);
    execute format('create index if not exists idx_nsc_pole on %I.nsc_cases (pole_count)', sch);
    execute format('create index if not exists idx_nsc_proc on %I.nsc_cases (procedure)', sch);
    execute format('create index if not exists idx_nsc_report on %I.nsc_cases (report_date)', sch);

    execute format($t$
      create table if not exists %I.nsc_import_jobs (
        id uuid primary key,
        filename text,
        report_date date,
        status text not null default 'uploading',
        storage_path text,
        part_count integer default 0,
        part_index integer default 0,
        total integer default 0,
        upserted integer default 0,
        preview jsonb,
        error text,
        created_by text,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      )
    $t$, sch);
  end loop;
end $$;

notify pgrst, 'reload schema';

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('nsc', 'nsc', false, 62914560)
  on conflict (id) do update set file_size_limit = excluded.file_size_limit;
exception
  when undefined_table then
    raise notice 'storage.buckets not available — create bucket nsc in the dashboard';
  when others then
    raise notice 'storage bucket skipped: %', sqlerrm;
end $$;
