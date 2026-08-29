-- Import the North Bengal EHV interconnection from OpenStreetMap / OpenInfraMap.
--
-- The network held 154 lines, every one of them 33 kV, so the 132/220/400 kV
-- interconnection between grid substations was entirely missing. These 13
-- circuits are the ones OSM describes end to end AND whose endpoints both land on
-- a substation already in our table.
--
-- Method: contiguous power=line ways were welded into chains, clipped to the
-- North Bengal districts, then each chain end was snapped to the nearest
-- substation of a compatible voltage within 2.5 km. Only chains of 1 km or more
-- were considered. Circuits that OSM does not cover, or that end at a yard we
-- do not hold, are deliberately absent — connect those by hand.
--
-- length_km is left to powermap.rebuild_line_geom, which measures the straight
-- line between the two yards, exactly as every other line in this schema does.
-- The true routed length is preserved in remarks instead.
--
-- circuit_count is 1 for all of them: OSM tags the corridor, not the number of
-- circuits on the towers, so double circuits must be set by hand afterwards.
--
-- Safe to re-run: ids are derived from the endpoint pair, and any pair already
-- joined at the same voltage is skipped.
-- Run after 023_powermap_merge_duplicate_ss.sql

do $$
declare
  r record;
  vid uuid;
  n_added int := 0;
  n_skipped int := 0;
  n_missing int := 0;
begin
  for r in
    select * from (values
      ('e4aba111-0247-52b0-9155-600c0b4633bd', '45c3e5f9-80fa-48c4-a297-ecc0a4d1589b', '2bda82f8-6732-4230-87c3-51c225eac93c', '220', 'Siliguri 220 kV – Dalkhola PG 220 kV (220 kV)', 'Route from OpenStreetMap (OpenInfraMap), 133.3 km along the corridor; OSM yards "Siliguri" – "Dalkola (PGCL)". Endpoints snapped within 0.2 km.'),
      ('28bc3e86-5c8f-5fd9-8d13-00a0caa9f9cb', '2bda82f8-6732-4230-87c3-51c225eac93c', '00178fae-fe9e-48d4-a3ec-41a6099c6d20', '220', 'Dalkhola PG 220 kV – Malda 400 kV (220 kV)', 'Route from OpenStreetMap (OpenInfraMap), 116.3 km along the corridor; OSM yards "Dalkola (PGCL)" – "Malda (PGCL)". Endpoints snapped within 0.2 km.'),
      ('c38323be-6297-58dc-812e-c6869c1e4fdd', '72fa1709-2a1e-49c4-a44e-ec7d1acaa7ba', '4ce00de0-c671-47c8-8626-f914bf6feaaa', '220', 'Binaguri 400 kV – Birpara 220 kV (220 kV)', 'Route from OpenStreetMap (OpenInfraMap), 80.9 km along the corridor; OSM yards "Binaguri" – "Birpara". Endpoints snapped within 0.2 km.'),
      ('7fd43fc0-b46f-5c4f-a581-0db444434896', '72fa1709-2a1e-49c4-a44e-ec7d1acaa7ba', '45c3e5f9-80fa-48c4-a297-ecc0a4d1589b', '220', 'Binaguri 400 kV – Siliguri 220 kV (220 kV)', 'Route from OpenStreetMap (OpenInfraMap), 5.6 km along the corridor; OSM yards "Binaguri" – "Siliguri". Endpoints snapped within 0.2 km.'),
      ('33d5f659-9658-563b-b21f-c86a177cc1cc', 'df68c6e6-32a3-4905-9768-4a82054fd555', '57dd41c1-f51f-49d3-8716-d36f99bdeb48', '132', 'Dalkhola 220 kV – Raiganj GSS (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 47.4 km along the corridor; OSM yards "Dalkola" – "Raiganj". Endpoints snapped within 0.1 km.'),
      ('2c62d816-b574-5845-b164-b7e5dfda18fe', '3893cae5-884e-4a6b-b463-2a44077328e0', 'f4ec5cda-7f82-4565-8d70-274f1bcb3b83', '132', 'Khejuria GSS – Malda 132 kV (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 36.4 km along the corridor; OSM yards an untagged yard – "Malda". Endpoints snapped within 0.1 km.'),
      ('12c3a434-247e-5d49-973e-73562cc05617', '0000a478-6f18-48fa-8436-914edeb586b6', '891512b8-a1bf-47b4-a7e7-e2d98786fa75', '132', 'Gangarampur GSS – Balurghat GSS (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 32.6 km along the corridor; OSM yards an untagged yard – an untagged yard. Endpoints snapped within 1.6 km. VERIFY: loose endpoint match.'),
      ('5a56c32b-637f-528c-b393-c796056a21d1', 'd8f750b4-491e-47a2-bce9-9fb93237448d', '4ce00de0-c671-47c8-8626-f914bf6feaaa', '132', 'Falakata 220 kV – Birpara 220 kV (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 18.6 km along the corridor; OSM yards an untagged yard – "Birpara". Endpoints snapped within 1.3 km. VERIFY: loose endpoint match.'),
      ('7c1df435-d6e7-571c-b411-7b5ca9e4253c', '922a5e6b-7606-4926-bc85-2a8c6cf1168c', '19cf031f-acfb-4d9c-92e9-614fcd789108', '132', 'Siliguri 132 kV – NJP 220 kV (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 14.6 km along the corridor; OSM yards "Siliguri" – an untagged yard. Endpoints snapped within 0.1 km.'),
      ('21d07acb-ce5a-57de-998c-ea7d345110d5', '19cf031f-acfb-4d9c-92e9-614fcd789108', '45c3e5f9-80fa-48c4-a297-ecc0a4d1589b', '132', 'NJP 220 kV – Siliguri 220 kV (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 7.6 km along the corridor; OSM yards an untagged yard – an untagged yard. Endpoints snapped within 2.2 km. VERIFY: loose endpoint match.'),
      ('5b5d2f35-da46-5822-98f6-c192472f4388', '45c3e5f9-80fa-48c4-a297-ecc0a4d1589b', '01cb6a66-484a-4d96-9438-93081cd49de7', '132', 'Siliguri 220 kV – NBU 132 kV (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 6.5 km along the corridor; OSM yards an untagged yard – an untagged yard. Endpoints snapped within 2.2 km. VERIFY: loose endpoint match.'),
      ('a9adffb0-4a48-55e1-bf19-260983d1930b', '00178fae-fe9e-48d4-a3ec-41a6099c6d20', 'f4ec5cda-7f82-4565-8d70-274f1bcb3b83', '132', 'Malda 400 kV – Malda 132 kV (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 5.9 km along the corridor; OSM yards "Malda (PGCL)" – "Malda". Endpoints snapped within 0.1 km.'),
      ('24fbf1b6-6a77-547e-a4ac-41edcf952fc2', '01cb6a66-484a-4d96-9438-93081cd49de7', 'aebe756d-8757-4a71-b647-9d21c15898a2', '132', 'NBU 132 kV – Ujanu 132 kV (132 kV)', 'Route from OpenStreetMap (OpenInfraMap), 4.8 km along the corridor; OSM yards an untagged yard – an untagged yard. Endpoints snapped within 0.1 km.') 
    ) as t(id, from_id, to_id, kv, nm, note)
  loop
    -- Endpoint must still be a live substation.
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

    select id into vid from powermap.voltage_levels where code = r.kv;
    if vid is null then
      n_missing := n_missing + 1;
      continue;
    end if;

    -- Already joined at this voltage, by this import or by hand.
    if exists (
      select 1 from powermap.lines l
       join powermap.assets a on a.id = l.asset_id and not a.is_deleted
       where l.voltage_level_id = vid
         and ((l.from_asset_id = r.from_id::uuid and l.to_asset_id = r.to_id::uuid)
           or (l.from_asset_id = r.to_id::uuid   and l.to_asset_id = r.from_id::uuid))
    ) then
      n_skipped := n_skipped + 1;
      continue;
    end if;

    insert into powermap.assets (id, asset_kind, name, status, remarks, is_deleted)
    values (r.id::uuid, 'line', r.nm, 'existing', r.note, false)
    on conflict (id) do nothing;

    insert into powermap.lines
      (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
    values (r.id::uuid, vid, r.from_id::uuid, r.to_id::uuid, 1, 'single')
    on conflict (asset_id) do nothing;

    -- Sets geom and length_km from the two yard positions.
    perform powermap.rebuild_line_geom(r.id::uuid);
    n_added := n_added + 1;
  end loop;

  raise notice 'EHV import: % added, % already present, % skipped for a missing endpoint',
    n_added, n_skipped, n_missing;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Check on the map, then correct by hand:
--
-- Endpoints matched loosely (the OSM chain ended this far from our yard):
--   1.6 km  Gangarampur GSS – Balurghat GSS (132 kV)
--   1.3 km  Falakata 220 kV – Birpara 220 kV (132 kV)
--   2.2 km  NJP 220 kV – Siliguri 220 kV (132 kV)
--   2.2 km  Siliguri 220 kV – NBU 132 kV (132 kV)
--
-- Naming inherited from OSM that looks wrong: our "Binaguri 400 kV" pin sits
-- 407 m from our "NJP 220 kV" pin, and OSM places that yard near Siliguri
-- rather than at Binaguri in Dhupguri, ~50 km east. Two of the circuits below
-- therefore carry the name "Binaguri" while almost certainly belonging to the
-- 400 kV station near Siliguri. The geometry follows our own pins and is
-- self-consistent; it is the label that needs settling.
--
-- Double circuits: all rows land as circuit_count = 1. Where a corridor really
-- carries two circuits, set circuit_count = 2 and circuit_config = 'double'.
-- ---------------------------------------------------------------------------
