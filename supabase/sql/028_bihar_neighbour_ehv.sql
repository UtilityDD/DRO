-- Bihar neighbour EHV stubs: Kishanganj (PG) + Purnea PG, and their links
-- into North Bengal. Sikkim (Rangpo / New Melli / Jorthang) deferred — no
-- clean OSM endpoint into our NB pins yet.
--
-- Yards (out of DRO; EHV stubs only):
--   S1  Kishanganj (PG) 400 kV   26.10703, 87.86863
--   S2  Purnea PG 400 kV         25.75263, 87.48285
--   S3  Purnea PG 220 kV         25.75241, 87.48046  (same campus as S2)
--
-- Circuits into North Bengal:
--   L1  Kishanganj (PG) – Dalkhola PG 220 kV     220 kV  OSM way 526897267
--   L2  Kishanganj (PG) – Siliguri 220 kV        220 kV  OSM way 116521266
--       (passes Islampur mid-span ~0.33 km)
--   L3  Purnea PG 220 kV – Dalkhola PG 220 kV    220 kV  OSM way 116521258
--   L4  Purnea PG 400 kV – Malda 400 kV          400 kV  OSM way 93160485
--   L5  Purnea PG 400 kV – Binaguri 400 kV       400 kV  OSM way 116521283
--       VERIFY: Binaguri pin sits next to NJP.
--
-- Safe to re-run. Run after 027_wb_neighbour_ehv.sql

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
      ('601c0dde-dd33-50eb-b73c-954e7caf62fd', 'Kishanganj (PG) 400 kV', '400', 26.10703, 87.86863, 'POWERGRID',
       'Bihar neighbour · OSM Kishanganj (PG). Out of DRO; EHV stub only.'),
      ('3ab0e503-8122-5164-9067-55de4f1cf645', 'Purnea PG 400 kV', '400', 25.75263, 87.48285, 'POWERGRID',
       'Bihar neighbour · OSM Purnea 400 kV. Out of DRO; EHV stub only.'),
      ('78fe846e-ec3b-5c2d-931f-25bdc47d15ca', 'Purnea PG 220 kV', '220', 25.75241, 87.48046, 'POWERGRID',
       'Bihar neighbour · OSM Purnea 220/132 kV, same campus as Purnea PG 400 kV (~0.2 km). Out of DRO; EHV stub only.')
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
      ('ea64a828-ff16-5c57-96d0-ca0a05f968bc',
       '601c0dde-dd33-50eb-b73c-954e7caf62fd',
       '2bda82f8-6732-4230-87c3-51c225eac93c',
       '220',
       'Kishanganj (PG) 400 kV – Dalkhola PG 220 kV (220 kV)',
       'Route from OpenStreetMap way 526897267, 220 kV 2-circuit, 28.3 km along corridor. Dalkhola PG end 0.18 km; Kishanganj (PG) end 2.09 km.'),
      ('1e9e27dd-617c-5f2d-a202-5e78e83019d3',
       '601c0dde-dd33-50eb-b73c-954e7caf62fd',
       '45c3e5f9-80fa-48c4-a297-ecc0a4d1589b',
       '220',
       'Kishanganj (PG) 400 kV – Siliguri 220 kV (220 kV)',
       'Route from OpenStreetMap way 116521266, 220 kV 2-circuit, 105.0 km along corridor. Siliguri end 0.12 km; Kishanganj (PG) end 2.09 km. Passes Islampur GSS mid-span ~0.33 km.'),
      ('f0ca2146-7028-554b-866b-676978f2a8df',
       '78fe846e-ec3b-5c2d-931f-25bdc47d15ca',
       '2bda82f8-6732-4230-87c3-51c225eac93c',
       '220',
       'Purnea PG 220 kV – Dalkhola PG 220 kV (220 kV)',
       'Route from OpenStreetMap way 116521258, 220 kV 2-circuit, 40.3 km along corridor. Both ends snapped within 0.2 km.'),
      ('b1ce7c95-fc44-5f65-96e0-1107f4e19049',
       '3ab0e503-8122-5164-9067-55de4f1cf645',
       '00178fae-fe9e-48d4-a3ec-41a6099c6d20',
       '400',
       'Purnea PG 400 kV – Malda 400 kV (400 kV)',
       'Route from OpenStreetMap way 93160485 (PGCIL), 400 kV 2-circuit, 160.2 km along corridor. Both ends snapped within 0.3 km. Same corridor that brushes Gazol mid-span.'),
      ('1d157d96-d0b8-5ead-99c4-49a945aa92ce',
       '3ab0e503-8122-5164-9067-55de4f1cf645',
       '72fa1709-2a1e-49c4-a44e-ec7d1acaa7ba',
       '400',
       'Purnea PG 400 kV – Binaguri 400 kV (400 kV)',
       'Route from OpenStreetMap way 116521283 (PGCIL), 400 kV 2-circuit, 173.4 km along corridor. Purnea end 0.21 km; Binaguri end 0.20 km. VERIFY: Binaguri pin sits next to NJP.')
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

  raise notice '028 Bihar neighbours: % SS added (% skipped), % lines added (% skipped), % missing',
    n_ss, n_ss_skip, n_line, n_line_skip, n_missing;
end $$;

notify pgrst, 'reload schema';
