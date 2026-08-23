-- Check: did the UPDATE actually hit any rows?
-- Run this first. "matched" = 0 means those DRO names are not in powermap.assets.

with src(name) as (
  values
    ('Bijanbari'),('Happy valley'),('Lebong PH'),('Lodhama'),
    ('New Ghoom'),('Old Ghoom'),('Singamari'),('Pokhriabang'),
    ('Mirik'),('Pankhabari'),('Fazi'),('Dabgram'),('Deshbandhupara'),
    ('Housing Board'),('Jhankar'),('Rabindranagar'),('Siliguri'),
    ('Ujanu'),('Salbari'),('Bidhannagar'),('Ghospukur'),('Khaparail'),
    ('Hatighisa'),('Kharibari'),('TCF PS I')
)
select
  (select count(*) from powermap.assets a
    where a.asset_kind = 'substation' and coalesce(a.is_deleted,false)=false) as substations_in_db,
  (
    select count(*)
    from powermap.assets a
    join src s on regexp_replace(regexp_replace(lower(a.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
              = regexp_replace(regexp_replace(lower(s.name), '(33/11|33kv|33 kv|kv|ss|s/s|ph)$', '', 'g'), '[^a-z0-9]+', '', 'g')
    where a.asset_kind = 'substation' and coalesce(a.is_deleted,false)=false
  ) as matched_dro_names;

-- Names currently on the map (first 60)
select a.name, s.lat, s.lng
from powermap.assets a
join powermap.substations s on s.asset_id = a.id
where a.asset_kind = 'substation' and coalesce(a.is_deleted,false)=false
order by a.name
limit 60;
