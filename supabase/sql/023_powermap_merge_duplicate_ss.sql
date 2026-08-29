-- Merge duplicate Power Map substations.
--
-- Migration 021 de-duplicated by exact name, so its HV rows landed beside
-- pre-existing records under a different naming convention ("Raiganj 132 kV"
-- vs "Raiganj GSS"). Each pair below shares a voltage class and sits within
-- 500 m under the same name, so they are one physical yard entered twice.
-- A spelling variant counts as the same name only within 100 m.
--
-- Every row this deletes came from that import and carries no feeders and no
-- transformers, so nothing is lost. Every row it keeps is the pre-existing
-- record, with its feeders and MVA intact. Transformers and tap laterals are
-- still repointed first, in case any turn up later.
--
-- Deliberately NOT included:
--   * pairs differing in voltage class — a 33 kV GSS standing inside or beside
--     an EHV yard is a real, separate asset, so all 14 such pairs are spared
--     (Dalkhola GSS is 31 m from Dalkhola 220 kV, Kushmandi 65 m, Ujanu 94 m);
--   * central-sector vs state yards at the same place (Dalkhola / Dalkhola PG);
--   * pairs where both rows carry feeders — see the opt-in block at the bottom.
--
-- Safe to re-run: ids that no longer exist are skipped.
-- Run after 022_powermap_portal_editors.sql

do $$
declare
  r record;
  l record;
  c int;
  n_lines int := 0;
  n_tx int := 0;
  n_taps int := 0;
  n_dropped int := 0;
  n_merged int := 0;
begin
  for r in
    select * from (values
      ('f92c253e-5795-4c59-a35d-49161cc1b4a3', '0000a478-6f18-48fa-8436-914edeb586b6'), -- Gangarampur 132 kV -> Gangarampur GSS
      ('23008a49-0a36-4744-aa0a-bcf1ab0a077d', 'a31be609-baa5-4dd4-8018-25fc296a13d9'), -- Gazole 220 kV -> Gazol GSS
      ('a547cb12-ceb3-4531-b690-9965ad0995a1', 'cca0e263-6f52-47ec-b986-1dd6fa41c1a8'), -- Samsi 132 kV -> Samsi GSS
      ('31b0da24-5e51-485c-96c3-4d5a9075e4c9', '3893cae5-884e-4a6b-b463-2a44077328e0'), -- Khejuria 132 kV -> Khejuria GSS
      ('186e68b3-e1b4-4146-8187-6dc22bec0db4', '57dd41c1-f51f-49d3-8716-d36f99bdeb48'), -- Raiganj 132 kV -> Raiganj GSS
      ('f8ded2f1-d5cb-4f9e-ac02-b0ac67741d06', '4dec27f2-c264-4727-b945-cb353a5370aa')  -- Islampur 132 kV -> Islampur GSS
    ) as t(loser, winner)
  loop
    -- Skip pairs already merged by an earlier run.
    if not exists (select 1 from powermap.assets where id = r.loser::uuid and not is_deleted) then
      continue;
    end if;
    if not exists (select 1 from powermap.assets where id = r.winner::uuid and not is_deleted) then
      continue;
    end if;

    -- A feeder between the two duplicates is an artefact of the split, and
    -- would violate the from <> to check once repointed. Drop the asset so the
    -- line row and any taps on it cascade away.
    delete from powermap.assets
     where asset_kind = 'line'
       and id in (
         select asset_id from powermap.lines
          where (from_asset_id = r.loser::uuid and to_asset_id = r.winner::uuid)
             or (from_asset_id = r.winner::uuid and to_asset_id = r.loser::uuid)
       );
    get diagnostics c = row_count;
    n_dropped := n_dropped + c;

    update powermap.lines set from_asset_id = r.winner::uuid
     where from_asset_id = r.loser::uuid;
    get diagnostics c = row_count;
    n_lines := n_lines + c;

    update powermap.lines set to_asset_id = r.winner::uuid
     where to_asset_id = r.loser::uuid;
    get diagnostics c = row_count;
    n_lines := n_lines + c;

    update powermap.transformers set substation_asset_id = r.winner::uuid
     where substation_asset_id = r.loser::uuid;
    get diagnostics c = row_count;
    n_tx := n_tx + c;

    update powermap.tap_laterals set to_asset_id = r.winner::uuid
     where to_asset_id = r.loser::uuid and to_kind = 'substation';
    get diagnostics c = row_count;
    n_taps := n_taps + c;

    -- The substation_moved trigger only fires when lat/lng change, so moving a
    -- feeder to a different yard leaves geom and length_km stale.
    for l in
      select asset_id from powermap.lines
       where from_asset_id = r.winner::uuid or to_asset_id = r.winner::uuid
    loop
      perform powermap.rebuild_line_geom(l.asset_id);
    end loop;

    -- Cascades to powermap.substations and its transformers. Fails loudly if a
    -- feeder was missed above, since lines.from_asset_id has no cascade.
    delete from powermap.assets where id = r.loser::uuid;
    n_merged := n_merged + 1;
  end loop;

  raise notice 'merged % substations: % feeder ends repointed, % transformers, % taps, % artefact lines dropped',
    n_merged, n_lines, n_tx, n_taps, n_dropped;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Opt-in: same name, same voltage, metres apart, but feeders were entered
-- against BOTH rows. Almost certainly one yard recorded twice, yet combining
-- them merges two feeder sets, so check the feeder lists on the map first and
-- then paste these into the values list above.
--       ('948a6227-87c0-4614-a2e6-7fdd22ec5af5', 'a4b53286-57ad-4f78-9238-d59113438f71'),  -- Manikchak GSS (3 feeders) -> Manikchak (4 feeders)
--       ('88328428-1b14-482b-9737-e3289d6b40c4', 'cf3e9806-73a1-4d71-b877-b470c648c9f6'),  -- Harishchandrapur GSS (3 feeders) -> Harishchandrapur (4 feeders)
--
-- If you do enable them, two feeders may end up describing the same span. Review
-- before deleting anything — a genuine double circuit belongs in one row with
-- circuit_count = 2, but someone may have entered it as two rows, and this query
-- cannot tell the difference:
--
--   select least(from_asset_id::text, to_asset_id::text) as a,
--          greatest(from_asset_id::text, to_asset_id::text) as b,
--          voltage_level_id, count(*), array_agg(asset_id)
--     from powermap.lines
--    group by 1, 2, 3
--   having count(*) > 1;
-- ---------------------------------------------------------------------------
