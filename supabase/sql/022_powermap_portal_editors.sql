-- Link Power Map editor scope to DRO portal accounts.
--
-- Previously an editor signed in to the map with a separate name + PIN held in
-- powermap.editors. Edit rights now come from the portal session (permissions
-- .powermap.edit), and this table only answers "which substations may this
-- portal user touch". pin_hash therefore becomes optional: rows created from
-- the portal have none.
--
-- Run after 021_insert_hv_substations.sql

alter table powermap.editors
  add column if not exists portal_username text;

alter table powermap.editors
  alter column pin_hash drop not null;

-- One scope row per portal account. Legacy PIN rows keep portal_username null,
-- and repeated nulls stay allowed under a unique index.
create unique index if not exists editors_portal_username_uidx
  on powermap.editors (lower(trim(portal_username)))
  where active and portal_username is not null;

-- The public bridge view is `select *`, so it must be replaced to pick up the
-- new column. Appending columns is permitted by create or replace view.
create or replace view public.pm_editors as
  select * from powermap.editors;

grant select, insert, update, delete on public.pm_editors to anon, authenticated, service_role;
