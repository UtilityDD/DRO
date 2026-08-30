-- Malda 132 kV = Ghorapir GSS (same yard), and Gazol ↔ Gangarampur EHV.
--
-- 1) Rename. The operational yard with feeders is "Ghorapir GSS"
--    (6dac09ed-…). OSM also left a pin "Malda 132 kV" (f4ec5cda-…) 1.85 km
--    west, holding the only EHV ends (Malda 400 kV and Khejuria). They are one
--    station. Keep Ghorapir's place and feeders; rename it to "Malda 132 kV".
--
-- 2) Merge. Repoint every line / transformer / tap from the OSM pin onto the
--    renamed yard, rebuild geoms, then drop the OSM pin. That resets the EHV
--    connectivity onto the real place.
--
-- 3) Gazol GSS ↔ Gangarampur GSS at 132 kV. OSM way 369687226 is a 132 kV
--    2-circuit corridor that terminates at Gangarampur (1.58 km) and passes
--    1.17 km from Gazol mid-span at the 9.7 km mark — same pattern as the
--    Malda 400 → Gazol 220 spur in 025. No OSM corridor reaches Balurghat from
--    Gazol; Balurghat is already linked to Gangarampur at 132 kV (024).
--
-- Safe to re-run.
-- Run after 025_gazol_ehv_link.sql

do $$
declare
  winner uuid := '6dac09ed-bf9c-4324-9996-481b8a25d685';  -- Ghorapir → Malda 132 kV
  loser  uuid := 'f4ec5cda-7f82-4565-8d70-274f1bcb3b83';  -- OSM Malda 132 pin
  gazol  uuid := 'a31be609-baa5-4dd4-8018-25fc296a13d9';
  gang   uuid := '0000a478-6f18-48fa-8436-914edeb586b6';
  line_id uuid := '0b2ed57b-ddc3-53fe-88f2-431518220f0c';
  vid uuid;
  l record;
  c int;
  n_lines int := 0;
  n_tx int := 0;
  n_taps int := 0;
  n_dropped int := 0;
begin
  -- ---------------------------------------------------------------------------
  -- Rename Ghorapir GSS → Malda 132 kV (place unchanged)
  -- ---------------------------------------------------------------------------
  if exists (select 1 from powermap.assets where id = winner and not is_deleted) then
    update powermap.assets
       set name = 'Malda 132 kV',
           remarks = coalesce(remarks, '')
             || case when coalesce(remarks, '') = '' then '' else E'\n' end
             || 'Renamed from Ghorapir GSS (same yard as OSM Malda 132). Place kept.',
           updated_at = now()
     where id = winner
       and name is distinct from 'Malda 132 kV';

    -- Feeder labels that still say Ghorapir
    update powermap.assets
       set name = replace(name, 'Ghorapir GSS', 'Malda 132 kV'),
           updated_at = now()
     where asset_kind = 'line'
       and not is_deleted
       and name like '%Ghorapir GSS%';
  end if;

  -- ---------------------------------------------------------------------------
  -- Merge OSM Malda 132 pin into the renamed yard; reset EHV ends
  -- ---------------------------------------------------------------------------
  if exists (select 1 from powermap.assets where id = loser and not is_deleted)
     and exists (select 1 from powermap.assets where id = winner and not is_deleted)
  then
    delete from powermap.assets
     where asset_kind = 'line'
       and id in (
         select asset_id from powermap.lines
          where (from_asset_id = loser and to_asset_id = winner)
             or (from_asset_id = winner and to_asset_id = loser)
       );
    get diagnostics n_dropped = row_count;

    update powermap.lines set from_asset_id = winner where from_asset_id = loser;
    get diagnostics c = row_count; n_lines := n_lines + c;
    update powermap.lines set to_asset_id = winner where to_asset_id = loser;
    get diagnostics c = row_count; n_lines := n_lines + c;

    update powermap.transformers set substation_asset_id = winner
     where substation_asset_id = loser;
    get diagnostics n_tx = row_count;

    update powermap.tap_laterals set to_asset_id = winner
     where to_asset_id = loser and to_kind = 'substation';
    get diagnostics n_taps = row_count;

    -- EHV line titles that named the OSM pin stay correct after rename;
    -- rebuild geom/length onto the surviving place.
    for l in
      select asset_id from powermap.lines
       where from_asset_id = winner or to_asset_id = winner
    loop
      perform powermap.rebuild_line_geom(l.asset_id);
    end loop;

    delete from powermap.assets where id = loser;
    raise notice 'merged OSM Malda 132 into Malda 132 kV: % ends, % tx, % taps, % artefact lines',
      n_lines, n_tx, n_taps, n_dropped;
  else
    raise notice 'Malda 132 merge skipped (already done or endpoint missing)';
  end if;

  -- ---------------------------------------------------------------------------
  -- Gazol GSS – Gangarampur GSS (132 kV)
  -- ---------------------------------------------------------------------------
  select id into vid from powermap.voltage_levels where code = '132';
  if vid is null then
    raise notice 'no 132 kV voltage level'; return;
  end if;

  if not exists (
    select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
     where s.asset_id = gazol and not a.is_deleted
  ) or not exists (
    select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
     where s.asset_id = gang and not a.is_deleted
  ) then
    raise notice 'Gazol or Gangarampur missing, skip 132 link';
    return;
  end if;

  if exists (
    select 1 from powermap.lines l
     join powermap.assets a on a.id = l.asset_id and not a.is_deleted
     where l.voltage_level_id = vid
       and ((l.from_asset_id = gazol and l.to_asset_id = gang)
         or (l.from_asset_id = gang and l.to_asset_id = gazol))
  ) then
    raise notice 'Gazol – Gangarampur already joined at 132 kV';
    return;
  end if;

  insert into powermap.assets (id, asset_kind, name, status, remarks, is_deleted)
  values (
    line_id, 'line', 'Gazol GSS – Gangarampur GSS (132 kV)', 'existing',
    'Route from OpenStreetMap (OpenInfraMap) way 369687226, a 132 kV 2-circuit '
    || 'corridor terminating near Gangarampur GSS (1.58 km) and passing 1.17 km '
    || 'from Gazol GSS mid-span at the 9.7 km mark. OSM draws no spur into Gazol. '
    || 'No direct OSM corridor Gazol–Balurghat; Balurghat stays via Gangarampur. '
    || 'VERIFY: circuit count.',
    false
  )
  on conflict (id) do nothing;

  insert into powermap.lines
    (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
  values (line_id, vid, gazol, gang, 1, 'single')
  on conflict (asset_id) do nothing;

  perform powermap.rebuild_line_geom(line_id);
  raise notice 'added Gazol GSS – Gangarampur GSS (132 kV)';
end $$;

notify pgrst, 'reload schema';
