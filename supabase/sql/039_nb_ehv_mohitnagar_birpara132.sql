-- North Bengal EHT fill from WBSETCL directory + Google Maps listings.
--
-- Missing vs our seed (Alipurduar / Jalpaiguri / Siliguri / Malda / Raiganj AOs):
--   Mohitnagar 132 kV GIS  — Jalpaiguri AO; Google Maps plus code GPV4+2FQ
--   Birpara 132 kV         — Jalpaiguri AO WBSETCL yard (distinct from Birpara 220 PG)
--
-- Still NOT EHT (≥132) in directory / maps (skip here — see 040 for 66 kV):
--   Hamiltonganj, Hasimara, Banarhat, Nagrakata, Odlabari, Kalimpong → 66 kV
--   Kalimpong Colegaon scheme (WBERC 2025) is 66/33/11, not 132
--   Tufanganj → WBSEDCL 33 kV
--
-- Pins:
--   Mohitnagar 132 kV GIS  26.54259, 88.70623   (GPV4+2FQ / Google Maps)
--   Birpara 132 kV         26.70239, 89.15101   (Mappls 132 kV Street, Birpara TG)
--
-- Circuits (VERIFY route):
--   Mohitnagar 132 – NJP 220      (132)
--   Mohitnagar 132 – Maynaguri 132 (132)
--   Birpara 132    – Birpara 220   (132)  same campus / short bus
--   Birpara 132    – Falakata 220  (132)
--
-- Safe to re-run. Run after 038_dinhata_mathabhanga_132.sql.
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
      ('d4f3b401-0390-5d04-9e44-444444444001', 'Mohitnagar 132 kV', '132', 26.54259, 88.70623, 'WBSETCL',
       'North Bengal EHT fill · Mohitnagar 132/33 kV GIS (WBSETCL, Jalpaiguri AO). Google Maps plus code GPV4+2FQ. VERIFY switchyard on satellite.'),
      ('d4f3b401-0390-5d04-9e44-444444444002', 'Birpara 132 kV',    '132', 26.70239, 89.15101, 'WBSETCL',
       'North Bengal EHT fill · Birpara 132 kV (WBSETCL, Jalpaiguri AO). Mappls “132 KV Street”, Birpara Tea Garden — distinct from POWERGRID Birpara 220. VERIFY on satellite.')
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
      ('d4f3b401-0390-5d04-9e44-444444444101',
       'Mohitnagar 132', '132', 'NJP', '220', '132',
       'Mohitnagar 132 kV – NJP 220 kV (132 kV)',
       'North Bengal EHT fill · Jalpaiguri town GIS into NJP. Straight yard-to-yard. VERIFY: route, circuit count.'),
      ('d4f3b401-0390-5d04-9e44-444444444102',
       'Mohitnagar 132', '132', 'Maynaguri', '132', '132',
       'Mohitnagar 132 kV – Maynaguri 132 kV (132 kV)',
       'North Bengal EHT fill · Jalpaiguri AO east radial. Straight yard-to-yard. VERIFY: whether this corridor exists.'),
      ('d4f3b401-0390-5d04-9e44-444444444103',
       'Birpara 132', '132', 'Birpara 220', '220', '132',
       'Birpara 132 kV – Birpara 220 kV (132 kV)',
       'North Bengal EHT fill · WBSETCL Birpara 132 ↔ POWERGRID Birpara 220 (same locality). Straight yard-to-yard. VERIFY.'),
      ('d4f3b401-0390-5d04-9e44-444444444104',
       'Birpara 132', '132', 'Falakata', '220', '132',
       'Birpara 132 kV – Falakata 220 kV (132 kV)',
       'North Bengal EHT fill · complements existing Falakata–Birpara 220/132 links. Straight yard-to-yard. VERIFY.')
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
     order by length(a.name), a.name
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
       case
         when to_key like '%birpara220%' and a.name ilike '%POWERGRID%' then 0
         when to_key like '%birpara220%' and a.name ilike '%PG%' then 0
         else 1
       end,
       length(a.name),
       a.name
     limit 1;

    if from_id is null or to_id is null or from_id = to_id then
      raise notice 'skip % — from=% to=%', r.nm, from_id, to_id;
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

  raise notice 'NB EHT Google fill: % SS (% skipped), % lines (% skipped), % missed',
    n_ss, n_ss_skip, n_line, n_line_skip, n_miss;
end $$;

notify pgrst, 'reload schema';
