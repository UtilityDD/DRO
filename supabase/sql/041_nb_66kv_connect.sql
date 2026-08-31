-- North Bengal 66 kV connectivity.
--
-- Documented / tender-backed:
--   Alipurduar – Hamiltonganj – Hasimara   66 kV corridor (reconductoring tenders)
--   Chalsa 132  – Kalimpong 66             66 kV feed (regional notes)
--
-- Geographic Dooars tea-belt radials from Chalsa 132 (VERIFY on satellite):
--   Chalsa – Odlabari 66
--   Chalsa – Nagrakata 66
--   Chalsa – Banarhat 66
--   Banarhat 66 – Birpara 132   (east tie into Birpara WBSETCL)
--
-- Line voltage = 66 for all rows (spur / corridor at 66 kV into the EHV yard).
-- Endpoints resolved by name. Requires 040 (66 kV SS) + Chalsa / Alipurduar / Birpara.
--
-- Safe to re-run. Run after 040_nb_66kv_substations.sql.
-- WHERE: Power Map project (unsmtschmcvftfqwabaq).

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
  select id into vid from powermap.voltage_levels where code = '66';
  if vid is null then
    raise notice 'no 66 kV voltage level — run 040 first';
    return;
  end if;

  for r in
    select * from (values
      -- Alipurduar – Hamiltonganj – Hasimara corridor
      ('f6b5d601-0410-5f06-a066-666666666001',
       'Alipurduar 220', '220', 'Hamiltonganj 66', '66',
       'Alipurduar 220 kV – Hamiltonganj 66 kV (66 kV)',
       'North Bengal 66 kV · Alipurduar–Hamiltonganj–Hasimara corridor (WBSETCL reconductoring tenders). Prefer WBSETCL Alipurduar over PG. VERIFY: route, circuit count.'),
      ('f6b5d601-0410-5f06-a066-666666666002',
       'Hamiltonganj 66', '66', 'Hasimara 66', '66',
       'Hamiltonganj 66 kV – Hasimara 66 kV (66 kV)',
       'North Bengal 66 kV · mid-span of Alipurduar–Hamiltonganj–Hasimara corridor. VERIFY: route, circuit count.'),
      -- Kalimpong from Chalsa
      ('f6b5d601-0410-5f06-a066-666666666003',
       'Chalsa', '132', 'Kalimpong 66', '66',
       'Chalsa 132 kV – Kalimpong 66 kV (66 kV)',
       'North Bengal 66 kV · Kalimpong feed from Chalsa. Straight yard-to-yard. VERIFY: route, circuit count.'),
      -- Dooars tea belt from Chalsa
      ('f6b5d601-0410-5f06-a066-666666666004',
       'Chalsa', '132', 'Odlabari 66', '66',
       'Chalsa 132 kV – Odlabari 66 kV (66 kV)',
       'North Bengal 66 kV · Dooars tea-belt radial west of Chalsa. Straight yard-to-yard. VERIFY.'),
      ('f6b5d601-0410-5f06-a066-666666666005',
       'Chalsa', '132', 'Nagrakata 66', '66',
       'Chalsa 132 kV – Nagrakata 66 kV (66 kV)',
       'North Bengal 66 kV · Dooars tea-belt radial. Straight yard-to-yard. VERIFY.'),
      ('f6b5d601-0410-5f06-a066-666666666006',
       'Chalsa', '132', 'Banarhat 66', '66',
       'Chalsa 132 kV – Banarhat 66 kV (66 kV)',
       'North Bengal 66 kV · Dooars tea-belt radial east of Chalsa. Straight yard-to-yard. VERIFY.'),
      ('f6b5d601-0410-5f06-a066-666666666007',
       'Banarhat 66', '66', 'Birpara 132', '132',
       'Banarhat 66 kV – Birpara 132 kV (66 kV)',
       'North Bengal 66 kV · Banarhat into Birpara WBSETCL 132. Prefer Birpara 132 over Birpara 220 PG. VERIFY.')
    ) as t(id, from_needle, from_kv, to_needle, to_kv, nm, note)
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
       case when a.name ilike '%PG%' or a.name ilike '%POWERGRID%' or a.name ilike '%PGCIL%' then 1 else 0 end,
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
       case when a.name ilike '%PG%' or a.name ilike '%POWERGRID%' or a.name ilike '%PGCIL%' then 1 else 0 end,
       length(a.name),
       a.name
     limit 1;

    if from_id is null or to_id is null or from_id = to_id then
      raise notice 'skip % — from=% to=%', r.nm, from_id, to_id;
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

    insert into powermap.assets (id, asset_kind, name, status, remarks, owner, is_deleted)
    values (r.id::uuid, 'line', r.nm, 'existing', r.note, 'WBSETCL', false)
    on conflict (id) do nothing;

    insert into powermap.lines
      (asset_id, voltage_level_id, from_asset_id, to_asset_id, circuit_count, circuit_config)
    values (r.id::uuid, vid, from_id, to_id, 1, 'single')
    on conflict (asset_id) do nothing;

    perform powermap.rebuild_line_geom(r.id::uuid);
    n_added := n_added + 1;
    raise notice 'added %', r.nm;
  end loop;

  raise notice 'NB 66 kV connect: % added, % already present, % missing endpoints',
    n_added, n_skip, n_miss;
end $$;

notify pgrst, 'reload schema';
