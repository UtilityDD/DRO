-- Sikkim neighbour EHV stubs and their links into the Siliguri / NJP side.
--
-- Yards:
--   S1  Rangpo 400 kV              27.19957, 88.48273
--   S2  Teesta Low Dam-III 220 kV  27.00237, 88.44260
--   S3  Teesta Low Dam-IV 220 kV   26.92687, 88.45937
--   S4  Jorthang 220 kV            27.10631, 88.33488
--   S5  New Melli 220 kV           27.18337, 88.32101
--
-- Circuits into North Bengal (or within Sikkim edge):
--   L1  Rangpo – Binaguri 400 kV                 400 kV  OSM way 116541280
--       VERIFY: Rangpo end snaps ~3.2 km (corridor tip near yard).
--   L2  Teesta LD-III – NJP 220 kV               220 kV  OSM way 322751257
--   L3  Teesta LD-IV – NJP 220 kV                220 kV  OSM way 322751256
--   L4  Jorthang – New Melli 220 kV              220 kV  OSM way 1026855642
--       (Sikkim-side only; no clean OSM end into Darjeeling 132 yet)
--
-- Safe to re-run. Run after 029_crossborder_neighbour_ehv.sql

do $$
declare
  r record;
  v_id uuid;
  n_ss int := 0;
  n_ss_skip int := 0;
  n_line int := 0;
  n_line_skip int := 0;
  n_missing int := 0;
begin
  for r in
    select * from (values
      ('00c7a970-2eec-5a72-9a59-4fabd6b644f9', 'Rangpo 400 kV', '400', 27.19957, 88.48273, 'POWERGRID',
       'Sikkim neighbour · OSM Rangpo. Out of DRO; EHV stub only.'),
      ('047f400a-eebf-55dc-8d30-b35446e00c6e', 'Teesta LD-III 220 kV', '220', 27.00237, 88.44260, 'NHPC',
       'Sikkim / Darjeeling fringe · OSM Teesta Low Dam - III Hydropower Plant. Out of DRO; EHV stub only.'),
      ('503d53b1-3e76-599d-b1ef-b11262b2f4b5', 'Teesta LD-IV 220 kV', '220', 26.92687, 88.45937, 'NHPC',
       'Sikkim / Darjeeling fringe · OSM Teesta Low Dam - IV Hydropower Plant. Out of DRO; EHV stub only.'),
      ('b6beb2c5-32e4-568f-9a44-206e23c08770', 'Jorthang 220 kV', '220', 27.10631, 88.33488, 'Sikkim Power',
       'Sikkim neighbour · OSM Jorthang. Out of DRO; EHV stub only.'),
      ('d60f2f10-00fa-50d2-b6f5-db3d771694ba', 'New Melli 220 kV', '220', 27.18337, 88.32101, 'POWERGRID',
       'Sikkim neighbour · OSM New Melli. Out of DRO; EHV stub only.')
    ) as t(id, nm, kv, lat, lng, owner, note)
  loop
    select id into v_id from powermap.voltage_levels where code = r.kv;
    if v_id is null then
      n_missing := n_missing + 1;
      continue;
    end if;

    if exists (
      select 1 from powermap.assets where id = r.id::uuid and not is_deleted
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

  for r in
    select * from (values
      ('bd042ba7-7b5b-513c-a848-86bb9fde8e98',
       '00c7a970-2eec-5a72-9a59-4fabd6b644f9',
       '72fa1709-2a1e-49c4-a44e-ec7d1acaa7ba',
       '400',
       'Rangpo 400 kV – Binaguri 400 kV (400 kV)',
       'Route from OpenStreetMap way 116541280, 400 kV, 104.5 km along corridor. Binaguri end 0.18 km; Rangpo end ~3.2 km (VERIFY loose tip).'),
      ('5f5e350c-bfd1-5d48-8c61-e1414d8193ee',
       '047f400a-eebf-55dc-8d30-b35446e00c6e',
       '19cf031f-acfb-4d9c-92e9-614fcd789108',
       '220',
       'Teesta LD-III 220 kV – NJP 220 kV (220 kV)',
       'Route from OpenStreetMap way 322751257, 220 kV, 79.1 km along corridor. Both ends snapped within 0.4 km.'),
      ('efe57b40-dbf2-5ed2-8cda-a9240e429283',
       '503d53b1-3e76-599d-b1ef-b11262b2f4b5',
       '19cf031f-acfb-4d9c-92e9-614fcd789108',
       '220',
       'Teesta LD-IV 220 kV – NJP 220 kV (220 kV)',
       'Route from OpenStreetMap way 322751256, 220 kV 2-circuit, 71.8 km along corridor. Both ends snapped within 0.2 km.'),
      ('0005d469-54cd-5e40-b7f1-3f8bf30b83d3',
       'b6beb2c5-32e4-568f-9a44-206e23c08770',
       'd60f2f10-00fa-50d2-b6f5-db3d771694ba',
       '220',
       'Jorthang 220 kV – New Melli 220 kV (220 kV)',
       'Route from OpenStreetMap way 1026855642, 220 kV, 9.6 km. Sikkim-side only; no clean OSM spur into Darjeeling 132 kV yet.')
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

  raise notice '030 Sikkim neighbours: % SS added (% skipped), % lines added (% skipped), % missing',
    n_ss, n_ss_skip, n_line, n_line_skip, n_missing;
end $$;

notify pgrst, 'reload schema';
