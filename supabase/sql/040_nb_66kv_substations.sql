-- Add 66 kV voltage class + North Bengal 66 kV substations (WBSETCL).
--
-- Colour (matches Power Map VOLTAGE_CATALOG): #7c3aed violet · pentagon symbol.
--
-- Yards from WBSETCL telephone directory (Alipurduar / Jalpaiguri / Siliguri AOs):
--   Hamiltonganj 66 · Hasimara 66 · Banarhat 66 · Nagrakata 66 · Odlabari 66 · Kalimpong 66
--
-- Centroids ≈ town centres (Photon) — VERIFY switchyard on satellite.
--
-- Safe to re-run. Run after 039 (or later).
-- WHERE: Power Map project (unsmtschmcvftfqwabaq).

do $$
declare
  r record;
  a_id uuid;
  v_id uuid;
  n_ss int := 0;
  n_ss_skip int := 0;
  n_miss int := 0;
begin
  -- -------------------------------------------------------------------------
  -- Voltage level
  -- -------------------------------------------------------------------------
  insert into powermap.voltage_levels (code, label, kv_primary, kv_secondary, color, sort_order)
  values ('66', '66 kV', 66, 33, '#7c3aed', 4)
  on conflict (code) do update
    set label = excluded.label,
        kv_primary = excluded.kv_primary,
        kv_secondary = excluded.kv_secondary,
        color = excluded.color,
        sort_order = excluded.sort_order;

  -- Keep 33 after 66 in sort order
  update powermap.voltage_levels set sort_order = 5 where code = '33' and sort_order is distinct from 5;

  select id into v_id from powermap.voltage_levels where code = '66';
  if v_id is null then
    raise notice '66 kV voltage level missing — abort';
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- Substations
  -- -------------------------------------------------------------------------
  for r in
    select * from (values
      ('e5a4c501-0400-5e05-9f55-555555555001', 'Hamiltonganj 66 kV', 26.68707, 89.42202,
       'North Bengal 66 kV · Hamiltonganj (WBSETCL, Alipurduar AO). Town centroid — VERIFY yard.'),
      ('e5a4c501-0400-5e05-9f55-555555555002', 'Hasimara 66 kV',     26.73042, 89.34984,
       'North Bengal 66 kV · Hasimara (WBSETCL, Alipurduar AO). Town centroid — VERIFY yard.'),
      ('e5a4c501-0400-5e05-9f55-555555555003', 'Banarhat 66 kV',     26.79898, 89.02576,
       'North Bengal 66 kV · Banarhat (WBSETCL, Jalpaiguri AO). Town centroid — VERIFY yard.'),
      ('e5a4c501-0400-5e05-9f55-555555555004', 'Nagrakata 66 kV',    26.84651, 88.91488,
       'North Bengal 66 kV · Nagrakata (WBSETCL, Jalpaiguri AO). Town centroid — VERIFY yard.'),
      ('e5a4c501-0400-5e05-9f55-555555555005', 'Odlabari 66 kV',     26.86469, 88.62365,
       'North Bengal 66 kV · Odlabari (WBSETCL, Jalpaiguri AO). Town centroid — VERIFY yard.'),
      ('e5a4c501-0400-5e05-9f55-555555555006', 'Kalimpong 66 kV',    27.07029, 88.47237,
       'North Bengal 66 kV · Kalimpong (WBSETCL, Siliguri AO). Town centroid — VERIFY yard. Colegaon 66/33/11 scheme is separate / planned.')
    ) as t(id, nm, lat, lng, note)
  loop
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
    values (r.id::uuid, 'substation', r.nm, 'existing', r.note, 'WBSETCL', false);

    insert into powermap.substations (asset_id, voltage_level_id, lat, lng)
    values (r.id::uuid, v_id, r.lat, r.lng);

    n_ss := n_ss + 1;
    raise notice 'added SS %', r.nm;
  end loop;

  raise notice '66 kV seed: % SS added, % skipped, % missed', n_ss, n_ss_skip, n_miss;
end $$;

notify pgrst, 'reload schema';
