-- Dinhata 132 kV GIS (+ Mathabhanga 132 kV) and Cooch Behar–area ties.
--
-- Evidence:
--   • WBSETCL telephone directory lists Dinhata 132 kV GIS and Mathabhanga 132 kV GIS
--     under Alipurduar Area Office.
--   • Civil tenders (2025–26) at “Dinhata 132 kV Sub-Station” (WBSETCL).
--   • IRCON: 132 kV, 7.5 km Dinhata Grid – Falimari TSS energised 19 Mar 2025.
--   • Mathabhanga–Dinhata 132 kV circuit charged 30 Sep 2019 (press / project notes).
--
-- Centroids are approximate (no OSM yard yet) — VERIFY on Google satellite:
--   Dinhata 132 kV GIS      26.12500, 89.45800   (south of Dinhata toward Falimari)
--   Mathabhanga 132 kV GIS  26.34190, 89.21530   (Mathabhanga town area)
--
-- Circuits:
--   Mathabhanga 132 – Dinhata 132     (132)  existing corridor
--   Cooch Behar 132 – Dinhata 132     (132)  regional tie (VERIFY)
--
-- Safe to re-run. Run after 037_nb_ehv_east_districts.sql.
-- WHERE: Power Map project (unsmtschmcvftfqwabaq).

do $$
declare
  r record;
  v_id uuid;
  from_id uuid;
  to_id uuid;
  vid uuid;
  n_ss int := 0;
  n_ss_skip int := 0;
  n_line int := 0;
  n_line_skip int := 0;
  n_miss int := 0;
  from_key text;
  to_key text;
begin
  for r in
    select * from (values
      ('c3e2a301-0380-5c03-9d33-333333333001', 'Dinhata 132 kV',     '132', 26.12500, 89.45800, 'WBSETCL',
       'North Bengal EHV fill · Dinhata 132/33 kV GIS (WBSETCL, Alipurduar AO). Approx centroid south of Dinhata toward Falimari (IRCON 7.5 km 132 kV to Falimari TSS, energised Mar 2025). VERIFY switchyard on satellite.'),
      ('c3e2a301-0380-5c03-9d33-333333333002', 'Mathabhanga 132 kV', '132', 26.34190, 89.21530, 'WBSETCL',
       'North Bengal EHV fill · Mathabhanga 132 kV GIS (WBSETCL, Alipurduar AO). Approx town centroid — VERIFY switchyard on satellite. Documented 132 kV link to Dinhata (charged 2019).')
    ) as t(id, nm, kv, lat, lng, owner, note)
  loop
    select id into v_id from powermap.voltage_levels where code = r.kv;
    if v_id is null then
      n_miss := n_miss + 1;
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
    raise notice 'added SS %', r.nm;
  end loop;

  for r in
    select * from (values
      ('c3e2a301-0380-5c03-9d33-333333333101',
       'Mathabhanga 132', '132', 'Dinhata 132', '132', '132',
       'Mathabhanga 132 kV – Dinhata 132 kV (132 kV)',
       'North Bengal EHV fill · Mathabhanga–Dinhata 132 kV corridor (charged ~Sep 2019). Straight yard-to-yard. VERIFY: route, circuit count.'),
      ('c3e2a301-0380-5c03-9d33-333333333102',
       'Cooch Behar 132', '132', 'Dinhata 132', '132', '132',
       'Cooch Behar 132 kV – Dinhata 132 kV (132 kV)',
       'North Bengal EHV fill · Cooch Behar – Dinhata regional 132 kV tie. Straight yard-to-yard. VERIFY: whether this corridor exists or Dinhata is only fed via Mathabhanga.')
    ) as t(id, from_needle, from_kv, to_needle, to_kv, line_kv, nm, note)
  loop
    from_key := regexp_replace(lower(r.from_needle), '[^a-z0-9]+', '', 'g');
    to_key   := regexp_replace(lower(r.to_needle),   '[^a-z0-9]+', '', 'g');

    select a.id into from_id
      from powermap.assets a
      join powermap.substations s on s.asset_id = a.id
      join powermap.voltage_levels v on v.id = s.voltage_level_id
     where a.asset_kind = 'substation'
       and not coalesce(a.is_deleted, false)
       and regexp_replace(lower(a.name), '[^a-z0-9]+', '', 'g') like '%' || from_key || '%'
       and (r.from_kv is null or v.code = r.from_kv)
     order by
       case when a.name ilike '%PG%' then 1 else 0 end,
       length(a.name),
       a.name
     limit 1;

    select a.id into to_id
      from powermap.assets a
      join powermap.substations s on s.asset_id = a.id
      join powermap.voltage_levels v on v.id = s.voltage_level_id
     where a.asset_kind = 'substation'
       and not coalesce(a.is_deleted, false)
       and regexp_replace(lower(a.name), '[^a-z0-9]+', '', 'g') like '%' || to_key || '%'
       and (r.to_kv is null or v.code = r.to_kv)
     order by
       case when a.name ilike '%PG%' then 1 else 0 end,
       length(a.name),
       a.name
     limit 1;

    if from_id is null or to_id is null or from_id = to_id then
      raise notice 'skip % — endpoints from=% to=%', r.nm, from_id, to_id;
      n_miss := n_miss + 1;
      continue;
    end if;

    select id into vid from powermap.voltage_levels where code = r.line_kv;
    if vid is null then
      n_miss := n_miss + 1;
      continue;
    end if;

    if exists (
      select 1 from powermap.lines l
       join powermap.assets a on a.id = l.asset_id and not a.is_deleted
       where l.voltage_level_id = vid
         and ((l.from_asset_id = from_id and l.to_asset_id = to_id)
           or (l.from_asset_id = to_id   and l.to_asset_id = from_id))
    ) then
      n_line_skip := n_line_skip + 1;
      continue;
    end if;

    insert into powermap.assets (id, asset_kind, name, status, remarks, is_deleted)
    values (r.id::uuid, 'line', r.nm, 'existing', r.note, false)
    on conflict (id) do nothing;

    insert into powermap.lines
      (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
    values (r.id::uuid, vid, from_id, to_id, 1, 'single')
    on conflict (asset_id) do nothing;

    perform powermap.rebuild_line_geom(r.id::uuid);
    n_line := n_line + 1;
    raise notice 'added %', r.nm;
  end loop;

  raise notice 'Dinhata/Mathabhanga: % SS added (% skipped), % lines (% skipped), % missed',
    n_ss, n_ss_skip, n_line, n_line_skip, n_miss;
end $$;

notify pgrst, 'reload schema';
