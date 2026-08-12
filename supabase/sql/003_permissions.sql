-- Authorization: permissions JSONB matrix per user
-- { "nsc": { "view": true, "upload": true, "edit": false }, ... }

alter table dro.portal_users
  add column if not exists permissions jsonb default '{}'::jsonb;

comment on column dro.portal_users.permissions is
  'Per-module grants: view / upload / edit for nsc, disco, grievance, tech_works, spot_billing, bulk, consumers, atc';

-- Optional: keep legacy boolean columns for migration; app now uses permissions JSONB.
