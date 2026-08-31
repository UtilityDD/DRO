-- North Bengal EHV: connect orphan 132 kV yards that already sit in the table
-- but have no EHV feeder (024 only kept corridors that OSM snapped at both ends).
--
-- Districts covered by these radials:
--   Darjeeling / Kalimpong hills · Jalpaiguri Dooars · Malda · Uttar Dinajpur
--
-- Links (status existing; VERIFY route / circuit count on satellite):
--   Siliguri 132  – Kurseong 132
--   Kurseong 132  – Darjeeling 132
--   NJP 220       – Maynaguri 132
--   Maynaguri 132 – Chalsa 132
--   Malda 132     – Samsi (GSS / 132)
--   Samsi         – Harishchandrapur
--   Dalkhola 220  – Islampur (GSS / 132)   mid-span spur pattern (see 025 / 028)
--
-- Endpoints are resolved by name (not hard-coded ids) so merge scripts 023/026/031
-- do not break the import. length_km from powermap.rebuild_line_geom.
--
-- Eastern districts (Cooch Behar / Alipurduar WBSETCL / Kamakhyaguri) → 037.
--
-- Safe to re-run. Run after 034_raiganj_132_kush_gang.sql (or later).
-- WHERE: Power Map project (unsmtschmcvftfqwabaq), not the DRO portal DB.

do $$
declare
  r record;
  from_id uuid;
  to_id uuid;
  vid uuid;
  n_added int := 0;
  n_skip int := 0;
  n_miss int := 0;
  from_key text;
  to_key text;
begin
  for r in
    select * from (values
      -- hills
      ('a1c0e101-0360-5a01-9b11-111111111001', 'Siliguri',      '132', 'Kurseong',          '132', '132',
       'Siliguri 132 kV – Kurseong 132 kV (132 kV)',
       'North Bengal EHV fill · hills radial into Kurseong. Straight yard-to-yard; OSM corridor incomplete in 024. VERIFY: route, circuit count.'),
      ('a1c0e101-0360-5a01-9b11-111111111002', 'Kurseong',      '132', 'Darjeeling',        '132', '132',
       'Kurseong 132 kV – Darjeeling 132 kV (132 kV)',
       'North Bengal EHV fill · Lebong / Darjeeling radial via Kurseong. Straight yard-to-yard. VERIFY: route, circuit count.'),
      -- Jalpaiguri / Dooars
      ('a1c0e101-0360-5a01-9b11-111111111003', 'NJP',           '220', 'Maynaguri',         '132', '132',
       'NJP 220 kV – Maynaguri 132 kV (132 kV)',
       'North Bengal EHV fill · Jalpaiguri AO. NJP 132 bus → Maynaguri. Straight yard-to-yard. VERIFY: route, circuit count.'),
      ('a1c0e101-0360-5a01-9b11-111111111004', 'Maynaguri',     '132', 'Chalsa',            '132', '132',
       'Maynaguri 132 kV – Chalsa 132 kV (132 kV)',
       'North Bengal EHV fill · Dooars radial north of Maynaguri. Straight yard-to-yard. VERIFY: whether Chalsa is looped from Birpara instead.'),
      -- Malda
      ('a1c0e101-0360-5a01-9b11-111111111005', 'Malda 132',     '132', 'Samsi',             '132', '132',
       'Malda 132 kV – Samsi (132 kV)',
       'North Bengal EHV fill · Malda AO radial to Samsi. Straight yard-to-yard. VERIFY: route, circuit count.'),
      ('a1c0e101-0360-5a01-9b11-111111111006', 'Samsi',         '132', 'Harishchandrapur',  '132', '132',
       'Samsi – Harishchandrapur (132 kV)',
       'North Bengal EHV fill · Malda north radial. Straight yard-to-yard. VERIFY: ends on the 132 yard (not the 33 kV sister).'),
      -- Uttar Dinajpur
      ('a1c0e101-0360-5a01-9b11-111111111007', 'Dalkhola 220',  '220', 'Islampur',          '132', '132',
       'Dalkhola 220 kV – Islampur (132 kV)',
       'North Bengal EHV fill · spur into Islampur. Kishanganj–Siliguri 220 corridor passes Islampur mid-span (~0.33 km) per 028; OSM draws no yard spur. VERIFY: 132 bus feed vs 220 tap.')
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
       case when r.from_kv is not null and v.code = r.from_kv then 0 else 1 end,
       case when a.name ilike '%GSS%' then 0 else 1 end,
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
       case when r.to_kv is not null and v.code = r.to_kv then 0 else 1 end,
       case when a.name ilike '%GSS%' then 0 else 1 end,
       length(a.name),
       a.name
     limit 1;

    if from_id is null or to_id is null then
      raise notice 'skip % — missing endpoint (from=% to=%)', r.nm, from_id, to_id;
      n_miss := n_miss + 1;
      continue;
    end if;

    if from_id = to_id then
      raise notice 'skip % — both needles resolved to the same asset %', r.nm, from_id;
      n_miss := n_miss + 1;
      continue;
    end if;

    select id into vid from powermap.voltage_levels where code = r.line_kv;
    if vid is null then
      raise notice 'skip % — no voltage %', r.nm, r.line_kv;
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
      n_skip := n_skip + 1;
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
    n_added := n_added + 1;
    raise notice 'added %', r.nm;
  end loop;

  raise notice 'NB EHV orphan connect: % added, % already present, % missing endpoints',
    n_added, n_skip, n_miss;
end $$;

notify pgrst, 'reload schema';
