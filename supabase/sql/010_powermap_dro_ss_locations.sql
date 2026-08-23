-- UPDATE only: existing powermap.substations lat/lng
-- No new tables (avoids the RLS warning).
-- This does not add stations or assign Siliguri Zone offices.
-- For DRO mapping run supabase/sql/013_siliguri_zone_dro_ss.sql instead.
--
-- Matches by normalised name (ignores spaces, 33kV, SS, PH suffix).
-- Rows whose name does not match a DRO station are left unchanged.

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
    name,
    lat,
    lng,
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
