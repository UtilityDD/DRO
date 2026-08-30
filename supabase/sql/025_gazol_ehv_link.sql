-- Give Gazol GSS its missing EHV supply.
--
-- Gazol GSS is a 220 kV yard, yet all 8 lines recorded against it were 33 kV
-- outgoing feeders, leaving it with no source. 024 could not help: it only
-- accepted a corridor when BOTH of its ends snapped to a yard we hold, and the
-- corridor that feeds Gazol fails that test twice over.
--
-- What OSM actually shows around Gazol (way ids from the Overpass extract):
--   way1434384452  substation, 220 kV, "Gazole"  — 40 m from our pin, same yard
--   way148389809   line, 220 kV, 2 circuits, 82.1 km — starts 40 m from
--                  Malda 400 kV, runs north, and passes 0.89 km from Gazol at
--                  the 18.0 km mark before ending at 25.6854, 88.0440
--   way93160485    line, 400 kV (PGCIL), passes 0.76 km away — the Malda 400 kV
--                  feed, not Gazol's
--   way148389811 / way369687226   lines, 132 kV, pass 0.19 / 1.17 km away
--
-- Every one of those lines passes Gazol mid-span; not one terminates there. OSM
-- has simply never drawn the short spur into the yard, so no amount of endpoint
-- snapping would find it. The 220 kV corridor out of Malda 400 kV brushing the
-- fence at 0.89 km is the supply, and its far end sits at a yard we do not hold
-- (nothing of ours within 9.3 km of it), which is the second reason 024 skipped
-- the whole corridor.
--
-- So the southern half is recorded here as Malda 400 kV – Gazol GSS at 220 kV.
-- Straight-line 16.4 km against 18.0 km along the route, which is the usual
-- ratio for these corridors.
--
-- circuit_count is 1, matching every row 024 inserted. The corridor is tagged
-- circuits=2 in OSM; whether both circuits are looped into Gazol or it is fed by
-- a single-circuit spur is not something OSM settles, so it stays at 1 until
-- someone confirms it.
--
-- Safe to re-run: the id is deterministic and the pair is skipped if already
-- joined at 220 kV.
-- Run after 024_insert_ehv_lines.sql

do $$
declare
  line_id  uuid := '932977c5-a0f1-57c8-aac9-33c2bc154539';
  malda_id uuid := '00178fae-fe9e-48d4-a3ec-41a6099c6d20';  -- Malda 400 kV
  gazol_id uuid := 'a31be609-baa5-4dd4-8018-25fc296a13d9';  -- Gazol GSS
  vid uuid;
begin
  if not exists (
    select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
     where s.asset_id = malda_id and not a.is_deleted
  ) then
    raise notice 'Malda 400 kV not found, nothing done'; return;
  end if;
  if not exists (
    select 1 from powermap.substations s join powermap.assets a on a.id = s.asset_id
     where s.asset_id = gazol_id and not a.is_deleted
  ) then
    raise notice 'Gazol GSS not found, nothing done'; return;
  end if;

  select id into vid from powermap.voltage_levels where code = '220';
  if vid is null then
    raise notice 'no 220 kV voltage level, nothing done'; return;
  end if;

  if exists (
    select 1 from powermap.lines l
     join powermap.assets a on a.id = l.asset_id and not a.is_deleted
     where l.voltage_level_id = vid
       and ((l.from_asset_id = malda_id and l.to_asset_id = gazol_id)
         or (l.from_asset_id = gazol_id and l.to_asset_id = malda_id))
  ) then
    raise notice 'Malda 400 kV – Gazol GSS already joined at 220 kV, nothing done'; return;
  end if;

  insert into powermap.assets (id, asset_kind, name, status, remarks, is_deleted)
  values (
    line_id, 'line', 'Malda 400 kV – Gazol GSS (220 kV)', 'existing',
    'Route from OpenStreetMap (OpenInfraMap) way 148389809, a 220 kV 2-circuit '
    || 'corridor leaving Malda 400 kV and passing 0.89 km from Gazol GSS at the '
    || '18.0 km mark. OSM draws no spur into the yard, so this records the '
    || 'southern half of that corridor. The corridor continues north to a yard '
    || 'we do not hold (25.6854, 88.0440). VERIFY: circuit count, and whether '
    || 'Gazol is looped in or fed by a spur.',
    false
  )
  on conflict (id) do nothing;

  insert into powermap.lines
    (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
  values (line_id, vid, malda_id, gazol_id, 1, 'single')
  on conflict (asset_id) do nothing;

  perform powermap.rebuild_line_geom(line_id);
  raise notice 'added Malda 400 kV – Gazol GSS (220 kV)';
end $$;

notify pgrst, 'reload schema';
