-- Cross-border neighbour EHV stubs (Bhutan edge only this pass).
--
-- High-confidence OSM into North Bengal:
--   S1  Tala 400 kV     Bhutan   26.85640, 89.58944
--   S2  Chukha 220 kV   Bhutan   27.05254, 89.57531
--   L1  Tala – Binaguri 400 kV          400 kV  OSM way 166377796
--   L2  Chukha – Birpara 220 kV         220 kV  OSM way 166377809
--
-- Deferred (yards exist nearby, but no EHV corridor snaps to both a neighbour
-- endpoint and a North Bengal EHV pin in the current extract):
--   Bangladesh: Dinajpur, Panchagarh, Barapukuria, Thakurgaon, Saidpur, …
--   Nepal: Anarmani, Damak, Ilam/Godak
--
-- Safe to re-run. Run after 028_bihar_neighbour_ehv.sql

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
      ('862df753-0378-5f09-8123-b1efc2d9764c', 'Tala 400 kV', '400', 26.85640, 89.58944, 'DGPC / Bhutan',
       'Cross-border neighbour · OSM Tala (Bhutan). Out of DRO; EHV stub only.'),
      ('4689ae6b-2401-5f3a-89d8-5b36ce2191e0', 'Chukha 220 kV', '220', 27.05254, 89.57531, 'DGPC / Bhutan',
       'Cross-border neighbour · OSM Chukha (Bhutan). Out of DRO; EHV stub only.')
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
      ('1684bdf2-da66-5eac-ab01-9c79235cb311',
       '862df753-0378-5f09-8123-b1efc2d9764c',
       '72fa1709-2a1e-49c4-a44e-ec7d1acaa7ba',
       '400',
       'Tala 400 kV – Binaguri 400 kV (400 kV)',
       'Route from OpenStreetMap way 166377796 (PGCIL), 400 kV, 139.7 km along corridor. Tala end 0.05 km; Binaguri end 0.26 km. VERIFY: Binaguri pin sits next to NJP.'),
      ('d557578d-cd91-58aa-84ff-241b5addc115',
       '4689ae6b-2401-5f3a-89d8-5b36ce2191e0',
       '4ce00de0-c671-47c8-8626-f914bf6feaaa',
       '220',
       'Chukha 220 kV – Birpara 220 kV (220 kV)',
       'Route from OpenStreetMap way 166377809, 220 kV, 68.8 km along corridor. Both ends snapped within 0.2 km.')
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

  raise notice '029 cross-border: % SS added (% skipped), % lines added (% skipped), % missing',
    n_ss, n_ss_skip, n_line, n_line_skip, n_missing;
end $$;

notify pgrst, 'reload schema';
