-- Power Map network revision stamp (NSC/AT&C-style versioned dumps).
--
-- WHERE TO RUN: Power Map project SQL editor
--   account: utility.dipankar@gmail.com
--   ref:     unsmtschmcvftfqwabaq
-- NOT the DRO portal project (smartlinemanapp / pjnmnmmerksyhatnowps).
--
-- Clients fetch this tiny row first. Same version → reuse IndexedDB; no full
-- pm_v_* download. Writes bump revision when the trigger block is present.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- A) Stamp view (enough for cache reuse even without triggers)
-- ---------------------------------------------------------------------------
create table if not exists powermap.network_meta (
  id smallint primary key check (id = 1),
  revision bigint not null default 1,
  stamped_at timestamptz not null default now()
);

insert into powermap.network_meta (id, revision, stamped_at)
values (1, 1, now())
on conflict (id) do nothing;

create or replace function powermap.bump_network_revision()
returns void
language plpgsql
security definer
set search_path = powermap, public
as $$
begin
  insert into powermap.network_meta (id, revision, stamped_at)
  values (1, 1, now())
  on conflict (id) do update
    set revision = powermap.network_meta.revision + 1,
        stamped_at = now();
end;
$$;

create or replace function powermap.tg_bump_network_revision()
returns trigger
language plpgsql
security definer
set search_path = powermap, public
as $$
begin
  perform powermap.bump_network_revision();
  return null;
end;
$$;

-- Statement triggers (PG14+ "FUNCTION"; older Supabase also accepts PROCEDURE)
drop trigger if exists trg_assets_bump_revision on powermap.assets;
drop trigger if exists trg_substations_bump_revision on powermap.substations;
drop trigger if exists trg_lines_bump_revision on powermap.lines;
drop trigger if exists trg_transformers_bump_revision on powermap.transformers;
drop trigger if exists trg_tap_nodes_bump_revision on powermap.tap_nodes;
drop trigger if exists trg_tap_laterals_bump_revision on powermap.tap_laterals;

do $$
begin
  execute $t$
    create trigger trg_assets_bump_revision
      after insert or update or delete on powermap.assets
      for each statement execute procedure powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_substations_bump_revision
      after insert or update or delete on powermap.substations
      for each statement execute procedure powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_lines_bump_revision
      after insert or update or delete on powermap.lines
      for each statement execute procedure powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_transformers_bump_revision
      after insert or update or delete on powermap.transformers
      for each statement execute procedure powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_tap_nodes_bump_revision
      after insert or update or delete on powermap.tap_nodes
      for each statement execute procedure powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_tap_laterals_bump_revision
      after insert or update or delete on powermap.tap_laterals
      for each statement execute procedure powermap.tg_bump_network_revision()
  $t$;
exception when others then
  -- PG14+ prefers EXECUTE FUNCTION
  execute $t$
    create trigger trg_assets_bump_revision
      after insert or update or delete on powermap.assets
      for each statement execute function powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_substations_bump_revision
      after insert or update or delete on powermap.substations
      for each statement execute function powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_lines_bump_revision
      after insert or update or delete on powermap.lines
      for each statement execute function powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_transformers_bump_revision
      after insert or update or delete on powermap.transformers
      for each statement execute function powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_tap_nodes_bump_revision
      after insert or update or delete on powermap.tap_nodes
      for each statement execute function powermap.tg_bump_network_revision()
  $t$;
  execute $t$
    create trigger trg_tap_laterals_bump_revision
      after insert or update or delete on powermap.tap_laterals
      for each statement execute function powermap.tg_bump_network_revision()
  $t$;
end $$;

select powermap.bump_network_revision();

create or replace view public.pm_network_stamp
with (security_invoker = true)
as
select
  m.revision,
  m.stamped_at,
  (select count(*)::int
     from powermap.substations s
     join powermap.assets a on a.id = s.asset_id and not a.is_deleted) as ss_count,
  (select count(*)::int
     from powermap.lines l
     join powermap.assets a on a.id = l.asset_id and not a.is_deleted) as line_count,
  ('r:' || m.revision::text || '|ss:' ||
    (select count(*)::int
       from powermap.substations s
       join powermap.assets a on a.id = s.asset_id and not a.is_deleted)::text ||
    '|ln:' ||
    (select count(*)::int
       from powermap.lines l
       join powermap.assets a on a.id = l.asset_id and not a.is_deleted)::text
  ) as version
from powermap.network_meta m
where m.id = 1;

create or replace view powermap.v_network_stamp
with (security_invoker = true)
as
select * from public.pm_network_stamp;

grant select on powermap.network_meta to anon, authenticated, service_role;
grant select on public.pm_network_stamp to anon, authenticated, service_role;
grant select on powermap.v_network_stamp to anon, authenticated, service_role;
grant execute on function powermap.bump_network_revision() to anon, authenticated, service_role;

-- Read-only for browser keys. Bumps run inside security-definer triggers, not as anon UPDATEs.
alter table powermap.network_meta enable row level security;

drop policy if exists network_meta_select on powermap.network_meta;
create policy network_meta_select on powermap.network_meta
  for select to anon, authenticated
  using (true);

notify pgrst, 'reload schema';

-- Expect one row: revision, ss_count, line_count, version like r:2|ss:…|ln:…
select * from public.pm_network_stamp;
