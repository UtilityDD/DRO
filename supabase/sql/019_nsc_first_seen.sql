-- Preserve when an NSC case first entered DRO across re-uploads.
do $$
declare
  sch text;
begin
  foreach sch in array array['public', 'dro']
  loop
    if to_regclass(sch || '.nsc_cases') is null then
      continue;
    end if;

    execute format(
      'alter table %I.nsc_cases add column if not exists first_seen_on timestamptz',
      sch
    );

    execute format(
      'update %I.nsc_cases set first_seen_on = coalesce(first_seen_on, updated_at, now()) where first_seen_on is null',
      sch
    );

    execute format(
      'create or replace function %I.nsc_preserve_first_seen() returns trigger language plpgsql as $f$
       begin
         if tg_op = ''UPDATE'' then
           if old.first_seen_on is not null then
             new.first_seen_on := old.first_seen_on;
           elsif new.first_seen_on is null then
             new.first_seen_on := now();
           end if;
         elsif tg_op = ''INSERT'' then
           if new.first_seen_on is null then
             new.first_seen_on := now();
           end if;
         end if;
         return new;
       end;
       $f$',
      sch
    );

    execute format('drop trigger if exists trg_nsc_preserve_first_seen on %I.nsc_cases', sch);
    execute format(
      'create trigger trg_nsc_preserve_first_seen
         before insert or update on %I.nsc_cases
         for each row execute function %I.nsc_preserve_first_seen()',
      sch,
      sch
    );
  end loop;
end $$;
