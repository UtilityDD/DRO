-- Field Desk: custom site names, accompanied persons.
-- Safe to re-run.

do $$
declare
  sch text;
  tbl text;
  con text;
begin
  foreach sch in array ARRAY['dro', 'public']
  loop
    tbl := sch || '.field_notes';
    if to_regclass(tbl) is null then
      continue;
    end if;

    execute format('alter table %I.field_notes add column if not exists accompanied jsonb not null default %L::jsonb', sch, '[]');

    for con in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = sch
        and t.relname = 'field_notes'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%site_type%'
    loop
      execute format('alter table %I.field_notes drop constraint if exists %I', sch, con);
    end loop;

    execute format(
      'alter table %I.field_notes add constraint field_notes_site_type_check check (site_type in (%L, %L, %L))',
      sch, 'office', 'ss', 'custom'
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
