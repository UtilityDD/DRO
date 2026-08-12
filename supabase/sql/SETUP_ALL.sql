-- DRO Ops — run this ONCE in Supabase SQL Editor (your project)
-- Then: Project Settings → API → Exposed schemas → add "dro" → Save

create schema if not exists dro;

grant usage on schema dro to postgres, anon, authenticated, service_role;
grant all on all tables in schema dro to postgres, service_role;
grant select on all tables in schema dro to anon, authenticated;
grant all on all sequences in schema dro to postgres, service_role;
alter default privileges in schema dro grant all on tables to service_role;
alter default privileges in schema dro grant select on tables to anon, authenticated;

create table if not exists dro.offices (
  id bigserial primary key,
  office_type text not null check (office_type in ('zone','region','division','ccc','ss')),
  code text not null unique,
  name text not null,
  parent_code text,
  region_code text,
  division_code text,
  consumer_count integer default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists dro.portal_users (
  id bigserial primary key,
  username text not null unique,
  pin text not null,
  name text not null,
  role text not null default 'viewer'
    check (role in ('admin','region','division','ccc','viewer')),
  zone_code text default '34',
  region_code text default '341',
  division_code text default '',
  ccc_code text default '',
  permissions jsonb default '{}'::jsonb,
  last_login timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists dro.upload_batches (
  id bigserial primary key,
  module text not null,
  filename text,
  uploaded_by text,
  row_count integer default 0,
  error_count integer default 0,
  period_label text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists dro.consumer_master (
  id bigserial primary key,
  consumer_id text not null unique,
  name text,
  ccc_code text not null,
  division_code text,
  region_code text default '341',
  consumer_class text,
  status text default 'active',
  meter_no text,
  address text,
  updated_at timestamptz default now()
);

create table if not exists dro.bulk_consumers (
  id bigserial primary key,
  consumer_id text not null unique,
  name text not null,
  division_code text,
  ccc_code text,
  contract_demand numeric,
  voltage_level text,
  category text,
  status text default 'active',
  notes text,
  updated_at timestamptz default now()
);

create table if not exists dro.nsc_cases (
  id bigserial primary key,
  application_no text not null unique,
  consumer_name text,
  ccc_code text not null,
  division_code text,
  region_code text default '341',
  applied_on date,
  status text default 'pending',
  stage text,
  delay_days integer default 0,
  load_kw numeric,
  category text,
  remarks text,
  batch_id bigint,
  updated_at timestamptz default now()
);

create table if not exists dro.disconnections (
  id bigserial primary key,
  consumer_id text not null,
  consumer_name text,
  ccc_code text not null,
  division_code text,
  region_code text default '341',
  disco_date date,
  amount_due numeric,
  status text default 'pending',
  reconnect_date date,
  remarks text,
  batch_id bigint,
  updated_at timestamptz default now()
);

create table if not exists dro.grievances (
  id bigserial primary key,
  docket_no text not null unique,
  consumer_id text,
  consumer_name text,
  ccc_code text not null,
  division_code text,
  region_code text default '341',
  category text,
  lodged_on date,
  status text default 'open',
  aging_days integer default 0,
  priority text default 'normal',
  remarks text,
  batch_id bigint,
  updated_at timestamptz default now()
);

create table if not exists dro.tech_works (
  id bigserial primary key,
  work_id text not null unique,
  title text not null,
  ccc_code text,
  division_code text,
  region_code text default '341',
  priority text default 'medium',
  status text default 'open',
  vendor_name text,
  billing_status text default 'pending',
  target_date date,
  completed_on date,
  remarks text,
  batch_id bigint,
  updated_at timestamptz default now()
);

create table if not exists dro.spot_billing (
  id bigserial primary key,
  period_label text not null,
  ccc_code text not null,
  division_code text,
  region_code text default '341',
  consumer_class text,
  target_count integer default 0,
  billed_count integer default 0,
  unbilled_count integer default 0,
  batch_id bigint,
  updated_at timestamptz default now(),
  unique (period_label, ccc_code, consumer_class)
);

create table if not exists dro.atc_snapshots (
  id bigserial primary key,
  period_label text not null,
  office_type text not null,
  office_code text not null,
  office_name text,
  consumer_count integer,
  atc_loss numeric,
  dist_loss numeric,
  coll_eff numeric,
  batch_id bigint,
  created_at timestamptz default now(),
  unique (period_label, office_code)
);

create table if not exists dro.activity_logs (
  id bigserial primary key,
  username text,
  action text,
  detail text,
  created_at timestamptz default now()
);

create index if not exists idx_offices_type on dro.offices(office_type);
create index if not exists idx_consumer_ccc on dro.consumer_master(ccc_code);
create index if not exists idx_nsc_ccc on dro.nsc_cases(ccc_code);
create index if not exists idx_disco_ccc on dro.disconnections(ccc_code);

grant all on all tables in schema dro to service_role;
grant all on all sequences in schema dro to service_role;
grant select on all tables in schema dro to anon, authenticated;

notify pgrst, 'reload schema';
