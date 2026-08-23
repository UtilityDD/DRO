-- Insert DRO 33/11 kV substations that are not already in powermap.assets.
-- INSERT-only into existing tables. Does not change schema, RLS, or org_units.
-- Do NOT run 013_siliguri_zone_dro_ss.sql on the shared Power Map database.
--
-- If this fails, the SQL editor Messages panel shows the exact reason
-- (missing 33 kV code, column name, enum value, etc.).

do $$
declare
  r record;
  a_id uuid;
  v_id uuid;
  n_ins int := 0;
  n_ss int := 0;
  n_skip int := 0;
begin
  select vl.id into v_id
  from powermap.voltage_levels vl
  where vl.code in ('33', '33/11')
  order by vl.code
  limit 1;

  if v_id is null then
    begin
      insert into powermap.voltage_levels (code, label, kv_primary, kv_secondary, color, sort_order)
      values ('33', '33 kV', 33, 11, '#0284c7', 40)
      returning id into v_id;
    exception when others then
      raise exception 'No 33 kV row in powermap.voltage_levels and insert failed (%). Existing codes: %',
        SQLERRM,
        coalesce((select string_agg(code, ', ' order by code) from powermap.voltage_levels), '(none)');
    end;
  end if;

  for r in
    select * from (values
      ('Bijanbari',      27.0500278, 88.2617778),
      ('Happy valley',   27.05728,   88.18364),
      ('Lebong PH',      26.8807778, 88.2785278),
      ('Lodhama',        27.0519444, 88.2750833),
      ('New Ghoom',      27.0071667, 88.2478889),
      ('Old Ghoom',      27.0085556, 88.2553056),
      ('Singamari',      27.0606,    88.2565),
      ('Pokhriabang',    26.9404972, 88.187),
      ('Mirik',          26.881811,  88.189083),
      ('Pankhabari',     26.8756667, 88.2707222),
      ('Fazi',           26.91199,   88.248976),
      ('Dabgram',        26.66831,   88.42267),
      ('Deshbandhupara', 26.69402,   88.43694),
      ('Housing Board',  26.75321,   88.4457),
      ('Jhankar',        26.71153,   88.41778),
      ('Rabindranagar',  26.71818,   88.45552),
      ('Siliguri',       26.73901,   88.43589),
      ('Ujanu',          26.73292,   88.4043),
      ('Salbari',        26.76789,   88.38127),
      ('Bidhannagar',    26.4848,    88.23545),
      ('Ghospukur',      26.56104,   88.26638),
      ('Khaparail',      26.73278,   88.36258),
      ('Hatighisa',      26.683473,  88.23351),
      ('Kharibari',      26.62794,   88.17179),
      ('TCF PS I',       26.62275,   88.3599444)
    ) as t(name, lat, lng)
  loop
    select a.id into a_id
    from powermap.assets a
    where a.asset_kind = 'substation'
      and coalesce(a.is_deleted, false) = false
      and regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
        = regexp_replace(regexp_replace(lower(r.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
    limit 1;

    if a_id is null then
      insert into powermap.assets (asset_kind, name, remarks, owner)
      values ('substation', r.name, 'DRO 33/11 kV (power.wb.gov.in)', 'WBSEDCL')
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

  raise notice 'DRO assets inserted: %, substations inserted: %, existing names skipped: %',
    n_ins, n_ss, n_skip;
end $$;

select count(*) as dro_ss_now
from powermap.assets a
join powermap.substations s on s.asset_id = a.id
where a.asset_kind = 'substation'
  and coalesce(a.is_deleted, false) = false
  and regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
    in (
      'bijanbari','happyvalley','lebong','lodhama','newghoom','oldghoom',
      'singamari','pokhriabang','mirik','pankhabari','fazi','dabgram',
      'deshbandhupara','housingboard','jhankar','rabindranagar','siliguri',
      'ujanu','salbari','bidhannagar','ghospukur','khaparail','hatighisa',
      'kharibari','tcfpsi'
    );

-- Names still missing (empty = done)
with wanted(name) as (
  values
    ('Bijanbari'),('Happy valley'),('Lebong PH'),('Lodhama'),('New Ghoom'),
    ('Old Ghoom'),('Singamari'),('Pokhriabang'),('Mirik'),('Pankhabari'),
    ('Fazi'),('Dabgram'),('Deshbandhupara'),('Housing Board'),('Jhankar'),
    ('Rabindranagar'),('Siliguri'),('Ujanu'),('Salbari'),('Bidhannagar'),
    ('Ghospukur'),('Khaparail'),('Hatighisa'),('Kharibari'),('TCF PS I')
)
select w.name as still_missing
from wanted w
where not exists (
  select 1
  from powermap.assets a
  join powermap.substations s on s.asset_id = a.id
  where a.asset_kind = 'substation'
    and coalesce(a.is_deleted, false) = false
    and regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
      = regexp_replace(regexp_replace(lower(w.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
);
