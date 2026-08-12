-- Expand AT&C snapshots for Format-IA / Format-IB monthly workbooks.
-- Safe to re-run. Upsert key becomes (period_label, source_format, office_code).

alter table if exists atc_snapshots add column if not exists period_sort text;
alter table if exists atc_snapshots add column if not exists target_fy text;
alter table if exists atc_snapshots add column if not exists source_format text default 'IA';
alter table if exists atc_snapshots add column if not exists basis_label text;
alter table if exists atc_snapshots add column if not exists division_code text;
alter table if exists atc_snapshots add column if not exists division_name text;
alter table if exists atc_snapshots add column if not exists region_code text default '341';
alter table if exists atc_snapshots add column if not exists ccc_code text;
alter table if exists atc_snapshots add column if not exists target_atc numeric;
alter table if exists atc_snapshots add column if not exists target_dist numeric;
alter table if exists atc_snapshots add column if not exists atc_mar numeric;
alter table if exists atc_snapshots add column if not exists dist_mar numeric;
alter table if exists atc_snapshots add column if not exists atc_yoy numeric;
alter table if exists atc_snapshots add column if not exists dist_yoy numeric;
alter table if exists atc_snapshots add column if not exists input_mu numeric;
alter table if exists atc_snapshots add column if not exists demand_mu numeric;
alter table if exists atc_snapshots add column if not exists collection_mu numeric;
alter table if exists atc_snapshots add column if not exists coll_eff_mar numeric;
alter table if exists atc_snapshots add column if not exists coll_eff_yoy numeric;
alter table if exists atc_snapshots add column if not exists updated_at timestamptz default now();
alter table if exists atc_snapshots add column if not exists point_source text;

update atc_snapshots set source_format = coalesce(nullif(source_format, ''), 'IA') where source_format is null or source_format = '';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'atc_snapshots_period_label_office_code_key'
  ) then
    alter table atc_snapshots drop constraint atc_snapshots_period_label_office_code_key;
  end if;
exception when undefined_table then
  null;
end $$;

create unique index if not exists uq_atc_period_format_office
  on atc_snapshots (period_label, source_format, office_code);

create index if not exists idx_atc_period on atc_snapshots (period_label);
create index if not exists idx_atc_format on atc_snapshots (source_format);
create index if not exists idx_atc_office_type on atc_snapshots (office_type);

notify pgrst, 'reload schema';
