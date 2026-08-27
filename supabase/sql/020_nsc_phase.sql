-- NSC applied phase from SAP APPLIED_PHASE (I / III → 1 / 3).
-- Safe to re-run.

do $$
declare
  sch text;
begin
  foreach sch in array array['public', 'dro'] loop
    if to_regclass(sch || '.nsc_cases') is null then
      continue;
    end if;

    execute format('alter table %I.nsc_cases add column if not exists applied_phase text', sch);
    execute format('create index if not exists idx_nsc_phase on %I.nsc_cases (applied_phase)', sch);
  end loop;
end $$;

notify pgrst, 'reload schema';
