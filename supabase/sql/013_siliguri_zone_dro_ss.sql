-- DO NOT RUN on the shared Power Map database.
-- This rewrites org_units into a Siliguri Zone tree and would pollute the
-- other map app. Use 012_insert_missing_dro_ss.sql (INSERT-only) instead.
--
-- Map DRO 33/11 kV substations into Siliguri Zone → Darjeeling Region.
-- No CREATE TABLE. Idempotent: safe to re-run.
--
-- 1. Upserts office tree (zone 34 / region 341 / divisions / CCCs)
-- 2. Inserts missing 33/11 stations, each assigned to its CCC
-- 3. Updates lat/lng + org on stations already inserted by 012
-- 4. Adds transformer MVA where missing
--
-- Reload Power Map after this. Expect 25 stations around Siliguri / Darjeeling.

insert into powermap.voltage_levels (code, label, kv_primary, kv_secondary, color, sort_order)
select '33', '33 kV', 33, 11, '#0284c7', 40
where not exists (select 1 from powermap.voltage_levels where code in ('33', '33/11'));

insert into powermap.org_units (id, parent_id, type, name, code)
values
  ('00000000-0000-4000-8000-000000000034', null, 'zone', 'Siliguri Zone', '34'),
  ('00000000-0000-4000-8000-000000000341', '00000000-0000-4000-8000-000000000034', 'region', 'Darjeeling Region', '341'),
  ('00000000-0000-4000-8000-000000003412', '00000000-0000-4000-8000-000000000341', 'division', 'Siliguri Town', '3412'),
  ('00000000-0000-4000-8000-000000003413', '00000000-0000-4000-8000-000000000341', 'division', 'Kurseong', '3413'),
  ('00000000-0000-4000-8000-000000003414', '00000000-0000-4000-8000-000000000341', 'division', 'Darjeeling', '3414'),
  ('00000000-0000-4000-8000-000000003415', '00000000-0000-4000-8000-000000000341', 'division', 'Siliguri Sub Urban', '3415'),
  ('00000000-0000-4000-8000-000003412400', '00000000-0000-4000-8000-000000003412', 'ccc', 'Milanpally', '3412400'),
  ('00000000-0000-4000-8000-000003412401', '00000000-0000-4000-8000-000000003412', 'ccc', 'NJP Gate Bazar', '3412401'),
  ('00000000-0000-4000-8000-000003412501', '00000000-0000-4000-8000-000000003412', 'ccc', 'Subhaspally', '3412501'),
  ('00000000-0000-4000-8000-000003412502', '00000000-0000-4000-8000-000000003412', 'ccc', 'Hakimpara', '3412502'),
  ('00000000-0000-4000-8000-000003412503', '00000000-0000-4000-8000-000000003412', 'ccc', 'Power House', '3412503'),
  ('00000000-0000-4000-8000-000003412504', '00000000-0000-4000-8000-000000003412', 'ccc', 'Pradhan Nagar', '3412504'),
  ('00000000-0000-4000-8000-000003412505', '00000000-0000-4000-8000-000000003412', 'ccc', 'Siliguri Town', '3412505'),
  ('00000000-0000-4000-8000-000003413101', '00000000-0000-4000-8000-000000003413', 'ccc', 'Sonada', '3413101'),
  ('00000000-0000-4000-8000-000003413201', '00000000-0000-4000-8000-000000003413', 'ccc', 'Mirik', '3413201'),
  ('00000000-0000-4000-8000-000003413202', '00000000-0000-4000-8000-000000003413', 'ccc', 'Kurseong', '3413202'),
  ('00000000-0000-4000-8000-000003414101', '00000000-0000-4000-8000-000000003414', 'ccc', 'Sukhiapokhri', '3414101'),
  ('00000000-0000-4000-8000-000003414102', '00000000-0000-4000-8000-000000003414', 'ccc', 'Takdah', '3414102'),
  ('00000000-0000-4000-8000-000003414201', '00000000-0000-4000-8000-000000003414', 'ccc', 'Bijanbari', '3414201'),
  ('00000000-0000-4000-8000-000003414300', '00000000-0000-4000-8000-000000003414', 'ccc', 'Darjeeling', '3414300'),
  ('00000000-0000-4000-8000-000003415101', '00000000-0000-4000-8000-000000003415', 'ccc', 'Naxalbari', '3415101'),
  ('00000000-0000-4000-8000-000003415102', '00000000-0000-4000-8000-000000003415', 'ccc', 'Phansidewa', '3415102'),
  ('00000000-0000-4000-8000-000003415103', '00000000-0000-4000-8000-000000003415', 'ccc', 'Kharibari', '3415103'),
  ('00000000-0000-4000-8000-000003415200', '00000000-0000-4000-8000-000000003415', 'ccc', 'Bagdogra', '3415200'),
  ('00000000-0000-4000-8000-000003415201', '00000000-0000-4000-8000-000000003415', 'ccc', 'Bidhannagar', '3415201'),
  ('00000000-0000-4000-8000-000003415400', '00000000-0000-4000-8000-000000003415', 'ccc', 'Matigara', '3415400'),
  ('00000000-0000-4000-8000-000003415600', '00000000-0000-4000-8000-000000003415', 'ccc', 'Shivmandir', '3415600')
on conflict (code) do update
  set name = excluded.name,
      parent_id = excluded.parent_id,
      type = excluded.type;

with src(name, lat, lng, mva, ccc_code) as (
  values
    ('Bijanbari',      27.0500278, 88.2617778,  6.3,  '3414201'),
    ('Happy valley',   27.05728,   88.18364,   12.6,  '3414300'),
    ('Lebong PH',      26.8807778, 88.2785278,  9.45, '3414300'),
    ('Lodhama',        27.0519444, 88.2750833,  6.3,  '3414300'),
    ('New Ghoom',      27.0071667, 88.2478889, 12.6,  '3414101'),
    ('Old Ghoom',      27.0085556, 88.2553056,  6.3,  '3414101'),
    ('Singamari',      27.0606,    88.2565,     6.3,  '3414300'),
    ('Pokhriabang',    26.9404972, 88.187,      6.3,  '3413202'),
    ('Mirik',          26.881811,  88.189083,   6.3,  '3413201'),
    ('Pankhabari',     26.8756667, 88.2707222, 12.3,  '3413202'),
    ('Fazi',           26.91199,   88.248976,   1.5,  '3413101'),
    ('Dabgram',        26.66831,   88.42267,   15.75, '3412401'),
    ('Deshbandhupara', 26.69402,   88.43694,   18.9,  '3412502'),
    ('Housing Board',  26.75321,   88.4457,    12.6,  '3412400'),
    ('Jhankar',        26.71153,   88.41778,   18.9,  '3412501'),
    ('Rabindranagar',  26.71818,   88.45552,   28.9,  '3412503'),
    ('Siliguri',       26.73901,   88.43589,   25.2,  '3412505'),
    ('Ujanu',          26.73292,   88.4043,    23.9,  '3412504'),
    ('Salbari',        26.76789,   88.38127,   15.75, '3415400'),
    ('Bidhannagar',    26.4848,    88.23545,   17.6,  '3415201'),
    ('Ghospukur',      26.56104,   88.26638,   18.9,  '3415102'),
    ('Khaparail',      26.73278,   88.36258,   18.9,  '3415200'),
    ('Hatighisa',      26.683473,  88.23351,   12.6,  '3415101'),
    ('Kharibari',      26.62794,   88.17179,   12.6,  '3415103'),
    ('TCF PS I',       26.62275,   88.3599444, 11.3,  '3415102')
),
norm as (
  select
    name,
    lat,
    lng,
    mva,
    ccc_code,
    regexp_replace(regexp_replace(lower(name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g') as k
  from src
),
ins_assets as (
  insert into powermap.assets (asset_kind, name, status, remarks, owner, org_unit_id)
  select
    'substation',
    n.name,
    'existing',
    'DRO 33/11 kV · Siliguri Zone / Darjeeling Region',
    'WBSEDCL',
    o.id
  from norm n
  join powermap.org_units o on o.code = n.ccc_code
  where not exists (
    select 1 from powermap.assets a
    where a.asset_kind = 'substation'
      and coalesce(a.is_deleted, false) = false
      and regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g') = n.k
  )
  returning id, name
)
insert into powermap.substations (asset_id, voltage_level_id, lat, lng)
select
  a.id,
  (select id from powermap.voltage_levels where code in ('33', '33/11') order by code limit 1),
  n.lat,
  n.lng
from norm n
join powermap.assets a
  on a.asset_kind = 'substation'
 and coalesce(a.is_deleted, false) = false
 and regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g') = n.k
where not exists (
  select 1 from powermap.substations x where x.asset_id = a.id
);

-- Attach CCC + keep coordinates current for rows already present.
with src(name, lat, lng, ccc_code) as (
  values
    ('Bijanbari',      27.0500278, 88.2617778, '3414201'),
    ('Happy valley',   27.05728,   88.18364,   '3414300'),
    ('Lebong PH',      26.8807778, 88.2785278, '3414300'),
    ('Lodhama',        27.0519444, 88.2750833, '3414300'),
    ('New Ghoom',      27.0071667, 88.2478889, '3414101'),
    ('Old Ghoom',      27.0085556, 88.2553056, '3414101'),
    ('Singamari',      27.0606,    88.2565,    '3414300'),
    ('Pokhriabang',    26.9404972, 88.187,     '3413202'),
    ('Mirik',          26.881811,  88.189083,  '3413201'),
    ('Pankhabari',     26.8756667, 88.2707222, '3413202'),
    ('Fazi',           26.91199,   88.248976,  '3413101'),
    ('Dabgram',        26.66831,   88.42267,   '3412401'),
    ('Deshbandhupara', 26.69402,   88.43694,   '3412502'),
    ('Housing Board',  26.75321,   88.4457,    '3412400'),
    ('Jhankar',        26.71153,   88.41778,   '3412501'),
    ('Rabindranagar',  26.71818,   88.45552,   '3412503'),
    ('Siliguri',       26.73901,   88.43589,   '3412505'),
    ('Ujanu',          26.73292,   88.4043,    '3412504'),
    ('Salbari',        26.76789,   88.38127,   '3415400'),
    ('Bidhannagar',    26.4848,    88.23545,   '3415201'),
    ('Ghospukur',      26.56104,   88.26638,   '3415102'),
    ('Khaparail',      26.73278,   88.36258,   '3415200'),
    ('Hatighisa',      26.683473,  88.23351,   '3415101'),
    ('Kharibari',      26.62794,   88.17179,   '3415103'),
    ('TCF PS I',       26.62275,   88.3599444, '3415102')
),
norm as (
  select
    name, lat, lng, ccc_code,
    regexp_replace(regexp_replace(lower(name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g') as k
  from src
)
update powermap.assets a
set org_unit_id = o.id,
    owner = coalesce(nullif(a.owner, ''), 'WBSEDCL'),
    remarks = case
      when a.remarks is null or a.remarks = '' then 'DRO 33/11 kV · Siliguri Zone / Darjeeling Region'
      else a.remarks
    end
from norm n
join powermap.org_units o on o.code = n.ccc_code
where a.asset_kind = 'substation'
  and coalesce(a.is_deleted, false) = false
  and regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g') = n.k;

with src(name, lat, lng) as (
  values
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
),
norm as (
  select
    name, lat, lng,
    regexp_replace(regexp_replace(lower(name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g') as k
  from src
)
update powermap.substations s
set lat = n.lat,
    lng = n.lng
from powermap.assets a
join norm n
  on regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g') = n.k
where s.asset_id = a.id
  and a.asset_kind = 'substation'
  and coalesce(a.is_deleted, false) = false
  and (s.lat is distinct from n.lat or s.lng is distinct from n.lng);

insert into powermap.transformers (substation_asset_id, rating_mva, quantity, sequence)
select a.id, n.mva, 1, 1
from (
  values
    ('Bijanbari',       6.3),
    ('Happy valley',   12.6),
    ('Lebong PH',       9.45),
    ('Lodhama',         6.3),
    ('New Ghoom',      12.6),
    ('Old Ghoom',       6.3),
    ('Singamari',       6.3),
    ('Pokhriabang',     6.3),
    ('Mirik',           6.3),
    ('Pankhabari',     12.3),
    ('Fazi',            1.5),
    ('Dabgram',        15.75),
    ('Deshbandhupara', 18.9),
    ('Housing Board',  12.6),
    ('Jhankar',        18.9),
    ('Rabindranagar',  28.9),
    ('Siliguri',       25.2),
    ('Ujanu',          23.9),
    ('Salbari',        15.75),
    ('Bidhannagar',    17.6),
    ('Ghospukur',      18.9),
    ('Khaparail',      18.9),
    ('Hatighisa',      12.6),
    ('Kharibari',      12.6),
    ('TCF PS I',       11.3)
) as n(name, mva)
join powermap.assets a
  on a.asset_kind = 'substation'
 and coalesce(a.is_deleted, false) = false
 and regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
   = regexp_replace(regexp_replace(lower(n.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
where not exists (
  select 1 from powermap.transformers t where t.substation_asset_id = a.id
);

-- Expect dro_ss = 25, all with a Darjeeling Region CCC.
select
  count(*) as dro_ss,
  count(a.org_unit_id) as with_ccc
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

select a.name, o.code as ccc, o.name as ccc_name, s.lat, s.lng
from powermap.assets a
join powermap.substations s on s.asset_id = a.id
left join powermap.org_units o on o.id = a.org_unit_id
where a.asset_kind = 'substation'
  and coalesce(a.is_deleted, false) = false
  and regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
    in (
      'bijanbari','happyvalley','lebong','lodhama','newghoom','oldghoom',
      'singamari','pokhriabang','mirik','pankhabari','fazi','dabgram',
      'deshbandhupara','housingboard','jhankar','rabindranagar','siliguri',
      'ujanu','salbari','bidhannagar','ghospukur','khaparail','hatighisa',
      'kharibari','tcfpsi'
    )
order by o.code, a.name;
