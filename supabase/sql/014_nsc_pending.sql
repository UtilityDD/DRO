-- Pending NSC essential columns (run in SQL Editor on the exposed schema).
-- Safe to re-run.

do $$
begin
  if to_regclass('public.nsc_cases') is not null then
    alter table public.nsc_cases add column if not exists consumer_id text;
    alter table public.nsc_cases add column if not exists phone text;
    alter table public.nsc_cases add column if not exists consumer_class text;
    alter table public.nsc_cases add column if not exists class_code text;
    alter table public.nsc_cases add column if not exists sap_status text;
    alter table public.nsc_cases add column if not exists created_on date;
    alter table public.nsc_cases add column if not exists quotation_issue_on date;
    alter table public.nsc_cases add column if not exists collected_on date;
    alter table public.nsc_cases add column if not exists wo_no text;
    alter table public.nsc_cases add column if not exists wo_issued text;
    alter table public.nsc_cases add column if not exists agency_name text;
    alter table public.nsc_cases add column if not exists withheld_on date;
    alter table public.nsc_cases add column if not exists withheld_reason text;
    alter table public.nsc_cases add column if not exists report_date date;
    alter table public.nsc_cases add column if not exists quotation_age_days integer;
    alter table public.nsc_cases add column if not exists processing_days integer;
    alter table public.nsc_cases add column if not exists quotation_age_slab text;
    alter table public.nsc_cases add column if not exists processing_slab text;
  end if;
end $$;

create index if not exists idx_nsc_status on nsc_cases(status);
create index if not exists idx_nsc_ccc on nsc_cases(ccc_code);
create index if not exists idx_nsc_div on nsc_cases(division_code);
create index if not exists idx_nsc_class on nsc_cases(consumer_class);
create index if not exists idx_nsc_qslab on nsc_cases(quotation_age_slab);
