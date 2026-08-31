-- North Bengal EHV: Cooch Behar / Alipurduar / Kamakhyaguri yards + 132/220 links.
--
-- These districts are in the map frame (isMaldaAndNorthDistrict) but had no
-- in-district WBSETCL EHV pins — only POWERGRID Alipurduar stubs from 027.
--
-- Yards (centroids approximate — VERIFY on Google satellite before ops use):
--   Cooch Behar 132 kV     Khagrabari area          26.34580, 89.44850
--   Alipurduar 220 kV      WBSETCL, Birpara More    26.49150, 89.52700
--                          (distinct from Alipurduar PG 400/220 at ~89.46)
--   Kamakhyaguri 132 kV    Kamakhyaguri town        26.47620, 89.73340
--
-- Circuits:
--   Falakata 220     – Cooch Behar 132   (132)
--   Alipurduar 220   – Birpara 220       (220)
--   Alipurduar 220   – Kamakhyaguri 132  (132)
--   Alipurduar 220   – Cooch Behar 132   (132)
--
-- Safe to re-run. Run after 036_nb_ehv_orphan_connect.sql.
-- WHERE: Power Map project (unsmtschmcvftfqwabaq).

do $$
declare
  r record;
  a_id uuid;
  v_id uuid;
  from_id uuid;
  to_id uuid;
  vid uuid;
  n_ss int := 0;
  n_ss_skip int := 0;
  n_line int := 0;
  n_line_skip int := 0;
  n_miss int := 0;
  from_key text;
  to_key text;
begin
  -- -------------------------------------------------------------------------
  -- Substations
  -- -------------------------------------------------------------------------
  for r in
    select * from (values
      ('b2d1f201-0370-5b02-9c22-222222222001', 'Cooch Behar 132 kV',  '132', 26.34580, 89.44850, 'WBSETCL',
       'North Bengal EHV fill · Khagrabari / Cooch Behar 132 kV (WBSETCL). Approx centroid — VERIFY on satellite before ops use.'),
      ('b2d1f201-0370-5b02-9c22-222222222002', 'Alipurduar 220 kV',   '220', 26.49150, 89.52700, 'WBSETCL',
       'North Bengal EHV fill · WBSETCL Alipurduar 220/132/66/33 kV at Birpara More (AO campus). Distinct from Alipurduar PG. Approx centroid — VERIFY on satellite.'),
      ('b2d1f201-0370-5b02-9c22-222222222003', 'Kamakhyaguri 132 kV', '132', 26.47620, 89.73340, 'WBSETCL',
       'North Bengal EHV fill · Kamakhyaguri 132/33/11 kV under Alipurduar AO. Approx town centroid — VERIFY switchyard on satellite.')
    ) as t(id, nm, kv, lat, lng, owner, note)
  loop
    select id into v_id from powermap.voltage_levels where code = r.kv;
    if v_id is null then
      raise notice 'missing voltage % for %', r.kv, r.nm;
      n_miss := n_miss + 1;
      continue;
    end if;

    if exists (
      select 1 from powermap.assets
       where id = r.id::uuid and not is_deleted
    ) or exists (
      select 1 from powermap.assets
       where asset_kind = 'substation' and not is_deleted
         and regexp_replace(lower(name), '[^a-z0-9]+', '', 'g')
           = regexp_replace(lower(r.nm), '[^a-z0-9]+', '', 'g')
    ) then
      n_ss_skip := n_ss_skip + 1;
      continue;
    end if;

    insert into powermap.assets (id, asset_kind, name, status, remarks, owner, is_deleted)
    values (r.id::uuid, 'substation', r.nm, 'existing', r.note, r.owner, false);

    insert into powermap.substations (asset_id, voltage_level_id, lat, lng)
    values (r.id::uuid, v_id, r.lat, r.lng);

    n_ss := n_ss + 1;
    raise notice 'added SS %', r.nm;
  end loop;

  -- -------------------------------------------------------------------------
  -- Interconnects (name-resolved ends)
  -- -------------------------------------------------------------------------
  for r in
    select * from (values
      ('b2d1f201-0370-5b02-9c22-222222222101',
       'Falakata', '220', 'Cooch Behar 132', '132', '132',
       'Falakata 220 kV – Cooch Behar 132 kV (132 kV)',
       'North Bengal EHV fill · Cooch Behar feed from Falakata. Straight yard-to-yard. VERIFY: route, circuit count.'),
      ('b2d1f201-0370-5b02-9c22-222222222102',
       'Alipurduar 220', '220', 'Birpara', '220', '220',
       'Alipurduar 220 kV – Birpara 220 kV (220 kV)',
       'North Bengal EHV fill · WBSETCL Alipurduar ↔ Birpara. Prefer WBSETCL Alipurduar 220 over PG when both exist. VERIFY: distinct from Alipurduar PG – Birpara (027).'),
      ('b2d1f201-0370-5b02-9c22-222222222103',
       'Alipurduar 220', '220', 'Kamakhyaguri', '132', '132',
       'Alipurduar 220 kV – Kamakhyaguri 132 kV (132 kV)',
       'North Bengal EHV fill · Alipurduar AO radial to Kamakhyaguri. Straight yard-to-yard. VERIFY: route, circuit count.'),
      ('b2d1f201-0370-5b02-9c22-222222222104',
       'Alipurduar 220', '220', 'Cooch Behar 132', '132', '132',
       'Alipurduar 220 kV – Cooch Behar 132 kV (132 kV)',
       'North Bengal EHV fill · eastern Dooars / Cooch Behar tie. Straight yard-to-yard. VERIFY: whether this is existing or planning.')
    ) as t(id, from_needle, from_kv, to_needle, to_kv, line_kv, nm, note)
  loop
    from_key := regexp_replace(lower(r.from_needle), '[^a-z0-9]+', '', 'g');
    to_key   := regexp_replace(lower(r.to_needle),   '[^a-z0-9]+', '', 'g');

    -- Prefer exact-ish WBSETCL Alipurduar 220 over "Alipurduar PG 220".
    select a.id into from_id
      from powermap.assets a
      join powermap.substations s on s.asset_id = a.id
      join powermap.voltage_levels v on v.id = s.voltage_level_id
     where a.asset_kind = 'substation'
       and not coalesce(a.is_deleted, false)
       and regexp_replace(lower(a.name), '[^a-z0-9]+', '', 'g') like '%' || from_key || '%'
       and (r.from_kv is null or v.code = r.from_kv)
     order by
       case when a.name ilike '%PG%' or a.name ilike '%POWERGRID%' or a.name ilike '%PGCIL%' then 1 else 0 end,
       case when r.from_kv is not null and v.code = r.from_kv then 0 else 1 end,
       case when a.name ilike '%GSS%' then 0 else 1 end,
       length(a.name),
       a.name
     limit 1;

    select a.id into to_id
      from powermap.assets a
      join powermap.substations s on s.asset_id = a.id
      join powermap.voltage_levels v on v.id = s.voltage_level_id
     where a.asset_kind = 'substation'
       and not coalesce(a.is_deleted, false)
       and regexp_replace(lower(a.name), '[^a-z0-9]+', '', 'g') like '%' || to_key || '%'
       and (r.to_kv is null or v.code = r.to_kv)
     order by
       case when a.name ilike '%PG%' or a.name ilike '%POWERGRID%' or a.name ilike '%PGCIL%' then 1 else 0 end,
       case when r.to_kv is not null and v.code = r.to_kv then 0 else 1 end,
       case when a.name ilike '%GSS%' then 0 else 1 end,
       length(a.name),
       a.name
     limit 1;

    if from_id is null or to_id is null then
      raise notice 'skip % — missing endpoint (from=% to=%)', r.nm, from_id, to_id;
      n_miss := n_miss + 1;
      continue;
    end if;

    if from_id = to_id then
      raise notice 'skip % — same asset %', r.nm, from_id;
      n_miss := n_miss + 1;
      continue;
    end if;

    select id into vid from powermap.voltage_levels where code = r.line_kv;
    if vid is null then
      n_miss := n_miss + 1;
      continue;
    end if;

    if exists (
      select 1 from powermap.lines l
       join powermap.assets a on a.id = l.asset_id and not a.is_deleted
       where l.voltage_level_id = vid
         and ((l.from_asset_id = from_id and l.to_asset_id = to_id)
           or (l.from_asset_id = to_id   and l.to_asset_id = from_id))
    ) then
      n_line_skip := n_line_skip + 1;
      continue;
    end if;

    insert into powermap.assets (id, asset_kind, name, status, remarks, is_deleted)
    values (r.id::uuid, 'line', r.nm, 'existing', r.note, false)
    on conflict (id) do nothing;

    insert into powermap.lines
      (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
    values (r.id::uuid, vid, from_id, to_id, 1, 'single')
    on conflict (asset_id) do nothing;

    perform powermap.rebuild_line_geom(r.id::uuid);
    n_line := n_line + 1;
    raise notice 'added %', r.nm;
  end loop;

  raise notice 'NB EHV east: % SS added (% skipped), % lines added (% skipped), % missed',
    n_ss, n_ss_skip, n_line, n_line_skip, n_miss;
end $$;

notify pgrst, 'reload schema';
