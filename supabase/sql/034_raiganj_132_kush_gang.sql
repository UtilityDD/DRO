-- Raiganj 132 kV → Kushmandi 132 kV and Gangarampur 132 kV.
--
-- Adds two radial 132 kV circuits from Raiganj GSS:
--   • Raiganj GSS – Kushmandi GSS (132 kV)  — proposed (Kushmandi GSS is proposed)
--   • Raiganj GSS – Gangarampur GSS (132 kV) — proposed (new planning link)
--
-- Also corrects Kushmandi GSS voltage class to 132 kV. The yard was seeded as
-- 33 kV beside the separate "Kushmandi" 33 kV SS; SS review and remarks treat
-- Kushmandi GSS as the 132 kV station (two voltage yards, same site).
--
-- length_km comes from powermap.rebuild_line_geom (straight yard-to-yard).
-- Safe to re-run: deterministic ids; existing pair at 132 kV is skipped.
-- Run after 033_powermap_ehv_owner_wbsetcl.sql

do $$
declare
  raiganj uuid := '57dd41c1-f51f-49d3-8716-d36f99bdeb48';   -- Raiganj GSS
  kush    uuid := '3ea52e2c-8c5d-4056-bac7-abca446c33c1';   -- Kushmandi GSS
  gang    uuid := '0000a478-6f18-48fa-8436-914edeb586b6';   -- Gangarampur GSS
  line_kush uuid := 'f9e3bdf6-3910-5202-a88b-f384f98d1401';
  line_gang uuid := '20bcfab3-2cea-5099-9024-6ecd2ecdcada';
  vid132 uuid;
  n_added int := 0;
begin
  select id into vid132 from powermap.voltage_levels where code = '132';
  if vid132 is null then
    raise notice 'no 132 kV voltage level — nothing done';
    return;
  end if;

  -- ---------------------------------------------------------------------------
  -- Kushmandi GSS is the 132 kV yard (keep sibling "Kushmandi" at 33 kV)
  -- ---------------------------------------------------------------------------
  if exists (
    select 1 from powermap.assets where id = kush and not is_deleted
  ) then
    update powermap.substations
       set voltage_level_id = vid132
     where asset_id = kush
       and voltage_level_id is distinct from vid132;

    update powermap.assets
       set owner = coalesce(nullif(trim(owner), ''), 'WBSETCL'),
           updated_at = now()
     where id = kush
       and (owner is null or trim(owner) = '');
  end if;

  -- ---------------------------------------------------------------------------
  -- Helper: insert one 132 kV radial if both ends exist and pair is free
  -- ---------------------------------------------------------------------------
  if not exists (
    select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
     where s.asset_id = raiganj and not a.is_deleted
  ) then
    raise notice 'Raiganj GSS missing — nothing done';
    return;
  end if;

  -- Raiganj – Kushmandi
  if not exists (
    select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
     where s.asset_id = kush and not a.is_deleted
  ) then
    raise notice 'Kushmandi GSS missing — skip Raiganj–Kushmandi';
  elsif exists (
    select 1 from powermap.lines l
     join powermap.assets a on a.id = l.asset_id and not a.is_deleted
     where l.voltage_level_id = vid132
       and ((l.from_asset_id = raiganj and l.to_asset_id = kush)
         or (l.from_asset_id = kush and l.to_asset_id = raiganj))
  ) then
    raise notice 'Raiganj – Kushmandi already joined at 132 kV';
  else
    insert into powermap.assets (id, asset_kind, name, status, remarks, is_deleted)
    values (
      line_kush, 'line', 'Raiganj GSS – Kushmandi GSS (132 kV)', 'proposed',
      'New 132 kV radial from Raiganj GSS to proposed Kushmandi GSS. '
      || 'Straight-line ~26 km (yard-to-yard). VERIFY: circuit count, route.',
      false
    )
    on conflict (id) do nothing;

    insert into powermap.lines
      (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
    values (line_kush, vid132, raiganj, kush, 1, 'single')
    on conflict (asset_id) do nothing;

    perform powermap.rebuild_line_geom(line_kush);
    n_added := n_added + 1;
    raise notice 'added Raiganj GSS – Kushmandi GSS (132 kV)';
  end if;

  -- Raiganj – Gangarampur
  if not exists (
    select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
     where s.asset_id = gang and not a.is_deleted
  ) then
    raise notice 'Gangarampur GSS missing — skip Raiganj–Gangarampur';
  elsif exists (
    select 1 from powermap.lines l
     join powermap.assets a on a.id = l.asset_id and not a.is_deleted
     where l.voltage_level_id = vid132
       and ((l.from_asset_id = raiganj and l.to_asset_id = gang)
         or (l.from_asset_id = gang and l.to_asset_id = raiganj))
  ) then
    raise notice 'Raiganj – Gangarampur already joined at 132 kV';
  else
    insert into powermap.assets (id, asset_kind, name, status, remarks, is_deleted)
    values (
      line_gang, 'line', 'Raiganj GSS – Gangarampur GSS (132 kV)', 'proposed',
      'New 132 kV radial from Raiganj GSS to Gangarampur GSS. '
      || 'Straight-line ~51 km (yard-to-yard). Gangarampur already has 132 kV '
      || 'via Balurghat and Gazol. VERIFY: circuit count, route, whether this '
      || 'is a planning link or an existing corridor not yet in OSM.',
      false
    )
    on conflict (id) do nothing;

    insert into powermap.lines
      (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
    values (line_gang, vid132, raiganj, gang, 1, 'single')
    on conflict (asset_id) do nothing;

    perform powermap.rebuild_line_geom(line_gang);
    n_added := n_added + 1;
    raise notice 'added Raiganj GSS – Gangarampur GSS (132 kV)';
  end if;

  raise notice 'Raiganj 132 radials: % added', n_added;
end $$;

notify pgrst, 'reload schema';
