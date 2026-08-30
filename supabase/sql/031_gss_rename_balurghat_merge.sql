-- Rename "… GSS" substations to "… {voltage} kV", and merge Balurghat.
--
-- Balurghat: keep operational yard 891512b8… (feeders + MVA), drop OSM pin
-- 9a22a8c6… (0 feeders), rename survivor to "Balurghat 132 kV". Same pattern
-- as Malda 132 / Ghorapir in 026.
--
-- Then every remaining asset whose name ends with GSS is renamed to include
-- its voltage_levels.code. Line asset names that still say GSS are rewritten
-- to match.
--
-- Safe-ish to re-run: already-renamed rows are skipped; missing loser is skipped.
-- Run after 030_sikkim_neighbour_ehv.sql

do $$
declare
  winner uuid := '891512b8-a1bf-47b4-a7e7-e2d98786fa75';
  loser  uuid := '9a22a8c6-7918-4d93-b5e8-da0f27f6f0e6';
  r record;
  l record;
  old_name text;
  new_name text;
  c int;
begin
  -- ---------------------------------------------------------------------------
  -- Balurghat merge
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

    update powermap.lines set from_asset_id = winner where from_asset_id = loser;
    update powermap.lines set to_asset_id = winner where to_asset_id = loser;
    update powermap.transformers set substation_asset_id = winner
     where substation_asset_id = loser;
    update powermap.tap_laterals set to_asset_id = winner
     where to_asset_id = loser and to_kind = 'substation';

    for l in
      select asset_id from powermap.lines
       where from_asset_id = winner or to_asset_id = winner
    loop
      perform powermap.rebuild_line_geom(l.asset_id);
    end loop;

    delete from powermap.assets where id = loser;
    raise notice 'merged OSM Balurghat 132 into Balurghat GSS place';
  end if;

  -- ---------------------------------------------------------------------------
  -- Rename every live substation whose name still contains GSS
  -- ---------------------------------------------------------------------------
  for r in
    select a.id, a.name, v.code as kv
      from powermap.assets a
      join powermap.substations s on s.asset_id = a.id
      join powermap.voltage_levels v on v.id = s.voltage_level_id
     where a.asset_kind = 'substation'
       and not a.is_deleted
       and a.name ~* '\mGSS\M'
  loop
    old_name := r.name;
    new_name := trim(both from regexp_replace(r.name, '\s*GSS\s*$', '', 'i'))
                || ' ' || r.kv || ' kV';

    if exists (
      select 1 from powermap.assets
       where id <> r.id and not is_deleted
         and regexp_replace(lower(name), '[^a-z0-9]+', '', 'g')
           = regexp_replace(lower(new_name), '[^a-z0-9]+', '', 'g')
    ) then
      raise notice 'skip rename % -> % (name taken)', old_name, new_name;
      continue;
    end if;

    update powermap.assets
       set name = new_name,
           remarks = coalesce(remarks, '')
             || case when coalesce(remarks, '') = '' then '' else E'\n' end
             || 'Renamed from ' || old_name || ' (voltage class in name).',
           updated_at = now()
     where id = r.id;

    -- Rewrite line labels that still mention the old yard name
    update powermap.assets
       set name = replace(name, old_name, new_name),
           updated_at = now()
     where asset_kind = 'line'
       and not is_deleted
       and name like '%' || old_name || '%';

    raise notice 'renamed % -> %', old_name, new_name;
  end loop;

  get diagnostics c = row_count;
end $$;

notify pgrst, 'reload schema';
