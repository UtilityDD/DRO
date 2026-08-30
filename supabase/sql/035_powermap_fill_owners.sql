-- Fill / canonicalize owner on all live Power Map assets.
--
-- Rules (aligned with client normalizeOwner + OWNER_OPTIONS):
--   • 33 kV substations           → WBSEDCL (always)
--   • blank 132 / 220 kV          → WBSETCL
--   • blank 400 kV                → POWERGRID
--   • blank lines / tap laterals  → same by their voltage code
--   • known free-text variants    → canonical (PGCIL→POWERGRID, SETCL→WBSETCL, …)
--   • name hints when still blank → POWERGRID / NTPC / DVC / CESC
--
-- Does NOT overwrite a non-blank 132/220/400 owner that is already set
-- (except via the canonicalize pass for known aliases).
-- Safe to re-run.
-- Run after 034_raiganj_132_kush_gang.sql

-- ---------------------------------------------------------------------------
-- A) Canonicalize free-text variants on every live asset
-- ---------------------------------------------------------------------------
update powermap.assets
set
  owner = case
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ '(WBSEDCL|WBPDCL|^SEDCL|DISTRIBUTION)' then 'WBSEDCL'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ '(WBSETCL|^SETCL|TRANSMISSION)' then 'WBSETCL'
    -- NTPC before PGCIL so "NTPC / PGCIL" stays NTPC
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ 'NTPC' then 'NTPC'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ '(POWERGRID|PGCIL|^CTU)' then 'POWERGRID'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ '(^DVC|DAMODAR)' then 'DVC'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ 'CESC' then 'CESC'
    else trim(owner)
  end,
  updated_at = now()
where not coalesce(is_deleted, false)
  and nullif(trim(coalesce(owner, '')), '') is not null
  and owner is distinct from case
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ '(WBSEDCL|WBPDCL|^SEDCL|DISTRIBUTION)' then 'WBSEDCL'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ '(WBSETCL|^SETCL|TRANSMISSION)' then 'WBSETCL'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ 'NTPC' then 'NTPC'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ '(POWERGRID|PGCIL|^CTU)' then 'POWERGRID'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ '(^DVC|DAMODAR)' then 'DVC'
    when upper(regexp_replace(trim(owner), '[\s._-]+', '', 'g'))
      ~ 'CESC' then 'CESC'
    else trim(owner)
  end;

-- ---------------------------------------------------------------------------
-- B) Substations — 33 kV always WBSEDCL
-- ---------------------------------------------------------------------------
update powermap.assets a
set
  owner = 'WBSEDCL',
  updated_at = now()
from powermap.substations s
join powermap.voltage_levels v on v.id = s.voltage_level_id
where a.id = s.asset_id
  and a.asset_kind = 'substation'
  and not coalesce(a.is_deleted, false)
  and v.code = '33'
  and coalesce(a.owner, '') is distinct from 'WBSEDCL';

-- ---------------------------------------------------------------------------
-- C) Substations — blank 132 / 220 → WBSETCL (unless name says otherwise)
-- ---------------------------------------------------------------------------
update powermap.assets a
set
  owner = case
    when a.name ~* '(POWERGRID|PGCIL|\yPG\y|CTU)' then 'POWERGRID'
    when a.name ~* 'NTPC|STPP' then 'NTPC'
    when a.name ~* '\yDVC\y' then 'DVC'
    when a.name ~* 'CESC' then 'CESC'
    else 'WBSETCL'
  end,
  updated_at = now()
from powermap.substations s
join powermap.voltage_levels v on v.id = s.voltage_level_id
where a.id = s.asset_id
  and a.asset_kind = 'substation'
  and not coalesce(a.is_deleted, false)
  and v.code in ('132', '220')
  and nullif(trim(coalesce(a.owner, '')), '') is null;

-- ---------------------------------------------------------------------------
-- D) Substations — blank 400 → POWERGRID (unless name says NTPC / DVC / …)
-- ---------------------------------------------------------------------------
update powermap.assets a
set
  owner = case
    when a.name ~* 'NTPC|STPP' then 'NTPC'
    when a.name ~* '\yDVC\y' then 'DVC'
    when a.name ~* 'CESC' then 'CESC'
    when a.name ~* 'WBSETCL|SETCL' then 'WBSETCL'
    else 'POWERGRID'
  end,
  updated_at = now()
from powermap.substations s
join powermap.voltage_levels v on v.id = s.voltage_level_id
where a.id = s.asset_id
  and a.asset_kind = 'substation'
  and not coalesce(a.is_deleted, false)
  and v.code = '400'
  and nullif(trim(coalesce(a.owner, '')), '') is null;

-- ---------------------------------------------------------------------------
-- E) Lines — fill blank owner from line voltage
-- ---------------------------------------------------------------------------
update powermap.assets a
set
  owner = case v.code
    when '33' then 'WBSEDCL'
    when '132' then 'WBSETCL'
    when '220' then 'WBSETCL'
    when '400' then 'POWERGRID'
    else 'WBSETCL'
  end,
  updated_at = now()
from powermap.lines l
join powermap.voltage_levels v on v.id = l.voltage_level_id
where a.id = l.asset_id
  and a.asset_kind = 'line'
  and not coalesce(a.is_deleted, false)
  and nullif(trim(coalesce(a.owner, '')), '') is null;

-- ---------------------------------------------------------------------------
-- F) Tap laterals — fill blank owner from lateral voltage
-- ---------------------------------------------------------------------------
update powermap.assets a
set
  owner = case v.code
    when '33' then 'WBSEDCL'
    when '132' then 'WBSETCL'
    when '220' then 'WBSETCL'
    when '400' then 'POWERGRID'
    else 'WBSEDCL'
  end,
  updated_at = now()
from powermap.tap_laterals tl
join powermap.voltage_levels v on v.id = tl.voltage_level_id
where a.id = tl.asset_id
  and a.asset_kind = 'tap_lateral'
  and not coalesce(a.is_deleted, false)
  and nullif(trim(coalesce(a.owner, '')), '') is null;

-- ---------------------------------------------------------------------------
-- G) Any remaining blank substations (no voltage row) → WBSEDCL
-- ---------------------------------------------------------------------------
update powermap.assets
set
  owner = 'WBSEDCL',
  updated_at = now()
where not coalesce(is_deleted, false)
  and asset_kind = 'substation'
  and nullif(trim(coalesce(owner, '')), '') is null;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Check (run manually):
--
-- select v.code as kv, a.owner, count(*)
-- from powermap.assets a
-- join powermap.substations s on s.asset_id = a.id
-- join powermap.voltage_levels v on v.id = s.voltage_level_id
-- where not coalesce(a.is_deleted, false)
-- group by v.code, a.owner
-- order by v.code, count(*) desc;
--
-- select a.asset_kind, count(*) filter blank
-- from powermap.assets a
-- where not coalesce(a.is_deleted, false)
--   and a.asset_kind in ('substation', 'line', 'tap_lateral')
--   and nullif(trim(coalesce(a.owner, '')), '') is null
-- group by a.asset_kind;
-- ---------------------------------------------------------------------------
