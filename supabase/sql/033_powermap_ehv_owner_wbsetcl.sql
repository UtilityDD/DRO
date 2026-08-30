-- Assign WBSETCL as owner for EHV (132 / 220 kV) substations that have no owner set.
-- 33 kV stays WBSEDCL elsewhere; 400 kV and already-labelled owners are left alone.

update powermap.assets a
set
  owner = 'WBSETCL',
  updated_at = now()
from powermap.substations s
join powermap.voltage_levels v on v.id = s.voltage_level_id
where a.id = s.asset_id
  and a.asset_kind = 'substation'
  and coalesce(a.is_deleted, false) = false
  and v.code in ('132', '220')
  and nullif(trim(coalesce(a.owner, '')), '') is null;

-- Optional check:
-- select a.name, v.code as kv, a.owner, a.status
-- from powermap.assets a
-- join powermap.substations s on s.asset_id = a.id
-- join powermap.voltage_levels v on v.id = s.voltage_level_id
-- where v.code in ('132', '220')
-- order by v.code, a.name;
