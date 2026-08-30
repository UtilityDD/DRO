-- WB neighbour EHV stubs: Farakka STPP + Alipurduar PG, and their links into
-- North Bengal. Approved candidate set S1–S3 + L1–L3.
--
-- Yards (out of DRO; EHV stubs only — no 33 kV feeders):
--   S1  Farakka STPP              400 kV  24.76962, 87.89615
--   S2  Alipurduar PG 400 kV      400 kV  26.49030, 89.45986
--   S3  Alipurduar PG 220 kV      220 kV  26.49230, 89.45702  (same campus as S2)
--
-- Circuits into North Bengal:
--   L1  Farakka STPP – Malda 400 kV              400 kV  OSM way 148389796
--   L2  Alipurduar PG 220 kV – Birpara 220 kV    220 kV  OSM way 473374900
--   L3  Alipurduar PG 400 kV – Binaguri 400 kV   400 kV  OSM way 765719666
--       VERIFY: Binaguri pin sits next to NJP; geometry follows our pins.
--
-- Safe to re-run: deterministic ids; existing name / pair skipped.
-- Run after 026_malda132_merge_gazol_gang.sql

do $$
declare
  r record;
  a_id uuid;
  v_id uuid;
  n_ss int := 0;
  n_ss_skip int := 0;
  n_line int := 0;
  n_line_skip int := 0;
  n_missing int := 0;
begin
  -- -------------------------------------------------------------------------
  -- Substations
  -- -------------------------------------------------------------------------
  for r in
    select * from (values
      ('6d97c62c-4293-5107-8947-a554ef5d3276', 'Farakka STPP',         '400', 24.76962, 87.89615, 'NTPC / PGCIL',
       'WB neighbour · OSM way 324064297 · Farakka STPP switchyard. Out of DRO; EHV stub only.'),
      ('3da8f2e4-e590-57fd-9dbe-a48bbef734e2', 'Alipurduar PG 400 kV', '400', 26.49030, 89.45986, 'POWERGRID',
       'WB neighbour · OSM Alipurduar subtation (400 kV), PGCIL campus. Converter 800 kV sits ~0.4 km on same site. Out of DRO; EHV stub only.'),
      ('cfc9d6d9-fd48-54d7-9f8c-7c971c817dbf', 'Alipurduar PG 220 kV', '220', 26.49230, 89.45702, 'POWERGRID',
       'WB neighbour · OSM Alipurduar subtation (220 kV), same PGCIL campus as Alipurduar PG 400 kV (~0.3 km). Out of DRO; EHV stub only.')
    ) as t(id, nm, kv, lat, lng, owner, note)
  loop
    select id into v_id from powermap.voltage_levels where code = r.kv;
    if v_id is null then
      raise notice 'missing voltage % for %', r.kv, r.nm;
      n_missing := n_missing + 1;
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
  end loop;

  -- -------------------------------------------------------------------------
  -- Interconnects
  -- -------------------------------------------------------------------------
  for r in
    select * from (values
      -- L1 Farakka – Malda 400
      ('012c5139-b070-5230-bf7a-21acf3aef40d',
       '6d97c62c-4293-5107-8947-a554ef5d3276',
       '00178fae-fe9e-48d4-a3ec-41a6099c6d20',
       '400',
       'Farakka STPP – Malda 400 kV (400 kV)',
       'Route from OpenStreetMap way 148389796, 400 kV 2-circuit, 42.2 km along corridor. Endpoints snapped within 0.4 km. circuit_count left at 1.'),
      -- L2 Alipurduar 220 – Birpara
      ('b0801654-31dd-55a8-af10-50472a1ba717',
       'cfc9d6d9-fd48-54d7-9f8c-7c971c817dbf',
       '4ce00de0-c671-47c8-8626-f914bf6feaaa',
       '220',
       'Alipurduar PG 220 kV – Birpara 220 kV (220 kV)',
       'Route from OpenStreetMap way 473374900, 220 kV, 57.4 km along corridor. Birpara end 0.19 km, Alipurduar end ≤0.3 km.'),
      -- L3 Alipurduar 400 – Binaguri
      ('436e6748-f964-5bf1-8907-4f7bf1a89b81',
       '3da8f2e4-e590-57fd-9dbe-a48bbef734e2',
       '72fa1709-2a1e-49c4-a44e-ec7d1acaa7ba',
       '400',
       'Alipurduar PG 400 kV – Binaguri 400 kV (400 kV)',
       'Route from OpenStreetMap way 765719666 (PGCIL), 400 kV, 114.2 km along corridor. Alipurduar end ~2.0 km, Binaguri end 0.54 km. VERIFY: Binaguri pin sits next to NJP; geometry follows our pins.')
    ) as t(id, from_id, to_id, kv, nm, note)
  loop
    if not exists (
      select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
       where s.asset_id = r.from_id::uuid and not a.is_deleted
    ) or not exists (
      select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
       where s.asset_id = r.to_id::uuid and not a.is_deleted
    ) then
      n_missing := n_missing + 1;
      continue;
    end if;

    select id into v_id from powermap.voltage_levels where code = r.kv;
    if v_id is null then
      n_missing := n_missing + 1;
      continue;
    end if;

    if exists (
      select 1 from powermap.lines l
       join powermap.assets a on a.id = l.asset_id and not a.is_deleted
       where l.voltage_level_id = v_id
         and ((l.from_asset_id = r.from_id::uuid and l.to_asset_id = r.to_id::uuid)
           or (l.from_asset_id = r.to_id::uuid and l.to_asset_id = r.from_id::uuid))
    ) then
      n_line_skip := n_line_skip + 1;
      continue;
    end if;

    insert into powermap.assets (id, asset_kind, name, status, remarks, is_deleted)
    values (r.id::uuid, 'line', r.nm, 'existing', r.note, false)
    on conflict (id) do nothing;

    insert into powermap.lines
      (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
    values (r.id::uuid, v_id, r.from_id::uuid, r.to_id::uuid, 1, 'single')
    on conflict (asset_id) do nothing;

    perform powermap.rebuild_line_geom(r.id::uuid);
    n_line := n_line + 1;
  end loop;

  raise notice '027 WB neighbours: % SS added (% skipped), % lines added (% skipped), % missing',
    n_ss, n_ss_skip, n_line, n_line_skip, n_missing;
end $$;

notify pgrst, 'reload schema';
