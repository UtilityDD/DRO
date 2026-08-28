-- INSERT-only: 132 / 220 / 400 kV substations for DRO + Malda / Uttar Dinajpur / Dakshin Dinajpur.
-- Does not change schema, RLS, or org_units.
-- Safe to re-run: existing names are skipped; missing rows are inserted.
--
-- Coordinates are OpenStreetMap yard centroids (not Google Maps scrape).
-- Verify each pin on Google satellite before using operationally.
-- Names include voltage so they do not collide with DRO 33/11 kV stations
-- (Siliguri, Ujanu, etc.).
--
-- After this: reload Power Map. Filter 400 / 220 / 132 in the legend.

do $$
declare
  r record;
  a_id uuid;
  v_id uuid;
  n_ins int := 0;
  n_ss int := 0;
  n_skip int := 0;
begin
  for r in
    select * from (values
      -- DRO / Siliguri Area Office + POWERGRID that feed DRO
      ('Binaguri 400 kV',  '400', 26.6502881, 88.4661238, 'POWERGRID', 'OSM centroid · Binaguri / Balaram, Jalpaiguri'),
      ('NJP 220 kV',       '220', 26.6537815, 88.4673508, 'WBSETCL',   'OSM centroid · Balaram, Jalpaiguri 735135 (yard next to Binaguri)'),
      ('Siliguri 220 kV',  '220', 26.6763164, 88.4196828, 'POWERGRID', 'OSM centroid · POWERGRID Siliguri / New Siliguri'),
      ('Siliguri 132 kV',  '132', 26.7386951, 88.4404003, 'WBSETCL',   'OSM centroid · Siliguri Town'),
      ('Ujanu 132 kV',     '132', 26.7333179, 88.4034623, 'WBSETCL',   'OSM centroid · Champasari / Pradhan Nagar'),
      ('NBU 132 kV',       '132', 26.7130701, 88.3641353, 'WBSETCL',   'OSM centroid · New Rangia / NBU (unnamed OSM yard; confirm on satellite)'),
      ('Darjeeling 132 kV','132', 27.0624172, 88.2765017, 'WBSETCL',   'OSM centroid · Lebong, Darjeeling 734105'),
      ('Kurseong 132 kV',  '132', 26.8995144, 88.2477980, 'WBSETCL',   'OSM centroid · Kurseong'),
      -- Adjacent Jalpaiguri Area (same map, useful feeders)
      ('Chalsa 132 kV',    '132', 26.8754289, 88.8041941, 'WBSETCL',   'OSM centroid · Chalsa, Jalpaiguri AO'),
      ('Maynaguri 132 kV', '132', 26.5708756, 88.8142596, 'WBSETCL',   'OSM centroid · Maynaguri'),
      ('Birpara 220 kV',   '220', 26.7050713, 89.1507246, 'POWERGRID', 'OSM centroid · Birpara'),
      ('Falakata 220 kV',  '220', 26.5635350, 89.1900295, 'WBSETCL',   'OSM centroid · Falakata'),
      -- Malda Area Office + POWERGRID Malda
      ('Malda 400 kV',            '400', 25.0220242, 88.0809369, 'POWERGRID', 'OSM centroid · Shyampur / Jhaljhalia, Malda (PG)'),
      ('Malda 132 kV',            '132', 25.0053016, 88.1237412, 'WBSETCL',   'OSM centroid · Ghorapir More, Uttar Ramchandrapur, Malda 732101'),
      ('Gazole 220 kV',           '220', 25.1504987, 88.1594642, 'WBSETCL',   'OSM centroid · Gazole 220 kV GIS, Malda'),
      ('Samsi 132 kV',            '132', 25.2917025, 88.0132212, 'WBSETCL',   'OSM centroid · Samsi, Malda'),
      ('Khejuria 132 kV',         '132', 24.8071195, 87.9444440, 'WBSETCL',   'OSM centroid · Khejuria 132 kV GIS (matches Wikimapia), Malda'),
      ('Harishchandrapur 132 kV', '132', 25.4256891, 87.8777933, 'WBSETCL',   'OSM unnamed yard next to Harishchandrapur 33 kV · confirm on satellite'),
      -- Raiganj Area Office (Uttar Dinajpur + Dakshin Dinajpur)
      ('Dalkhola PG 220 kV',  '220', 25.8833452, 87.8270409, 'POWERGRID', 'OSM centroid · Dalkola (PGCL), Uttar Dinajpur'),
      ('Dalkhola 220 kV',     '220', 25.8858257, 87.8271740, 'WBSETCL',   'OSM centroid · Dalkola 220/132 kV, Uttar Dinajpur'),
      ('Raiganj 132 kV',      '132', 25.6363601, 88.1246058, 'WBSETCL',   'OSM centroid · Sudarshanpur, Raiganj, Uttar Dinajpur (220 kV upgrade planned)'),
      ('Islampur 132 kV',     '132', 26.1967285, 88.1083769, 'WBSETCL',   'OSM centroid · Dhantola, NH 27, Islampur, Uttar Dinajpur 733213'),
      ('Gangarampur 132 kV',  '132', 25.3975000, 88.5580560, 'WBSETCL',   'Wikimapia yard · Gangarampur, Dakshin Dinajpur'),
      ('Balurghat 132 kV',    '132', 25.2449667, 88.7858167, 'WBSETCL',   'Mahinagar / Beltala Park / Boro-Raghunathpur campus, Balurghat 733103 · confirm switchyard centroid on satellite')
      -- Optional Sikkim (uncomment if you want them on the same map):
      -- ('Rangpo 400 kV',  '400', 27.1977965, 88.4833154, 'POWERGRID', 'OSM centroid · Rangpo, Sikkim'),
      -- ('New Melli 220 kV','220', 27.1828995, 88.3207950, 'POWERGRID', 'OSM centroid · New Melli, Sikkim'),
      -- ('Jorethang 220 kV','220', 27.1065284, 88.3344662, '',          'OSM centroid · Jorethang, Sikkim')
    ) as t(name, vcode, lat, lng, owner, remarks)
  loop
    select vl.id into v_id
    from powermap.voltage_levels vl
    where vl.code = r.vcode
    limit 1;

    if v_id is null then
      raise exception 'Missing voltage_levels.code = %. Run 004_powermap_schema.sql first. Existing codes: %',
        r.vcode,
        coalesce((select string_agg(code, ', ' order by code) from powermap.voltage_levels), '(none)');
    end if;

    select a.id into a_id
    from powermap.assets a
    where a.asset_kind = 'substation'
      and coalesce(a.is_deleted, false) = false
      and regexp_replace(lower(a.name), '[^a-z0-9]+', '', 'g')
        = regexp_replace(lower(r.name), '[^a-z0-9]+', '', 'g')
    limit 1;

    if a_id is null then
      insert into powermap.assets (asset_kind, name, remarks, owner)
      values ('substation', r.name, r.remarks, r.owner)
      returning id into a_id;
      n_ins := n_ins + 1;
    else
      n_skip := n_skip + 1;
    end if;

    if not exists (select 1 from powermap.substations s where s.asset_id = a_id) then
      insert into powermap.substations (asset_id, voltage_level_id, lat, lng)
      values (a_id, v_id, r.lat, r.lng);
      n_ss := n_ss + 1;
    end if;
  end loop;

  raise notice 'HV assets inserted: %, substations inserted: %, existing names skipped: %',
    n_ins, n_ss, n_skip;
end $$;

-- What should now be on the map
select a.name, v.code as kv, s.lat, s.lng, a.owner
from powermap.assets a
join powermap.substations s on s.asset_id = a.id
join powermap.voltage_levels v on v.id = s.voltage_level_id
where a.asset_kind = 'substation'
  and coalesce(a.is_deleted, false) = false
  and regexp_replace(lower(a.name), '[^a-z0-9]+', '', 'g') in (
    'binaguri400kv','njp220kv','siliguri220kv','siliguri132kv','ujanu132kv',
    'nbu132kv','darjeeling132kv','kurseong132kv','chalsa132kv','maynaguri132kv',
    'birpara220kv','falakata220kv',
    'malda400kv','malda132kv','gazole220kv','samsi132kv','khejuria132kv',
    'harishchandrapur132kv','dalkholapg220kv','dalkhola220kv','raiganj132kv',
    'islampur132kv','gangarampur132kv','balurghat132kv'
  )
order by v.kv_primary desc, a.name;
