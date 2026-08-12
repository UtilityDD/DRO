# Office hierarchy (official)

Source: WBSEDCL CCC master mapping screenshot.

Canonical file: [`data/office_map.json`](../data/office_map.json)

```
Siliguri Zone (34)
  └── Darjeeling Region (341)
        ├── Siliguri Town (3412) — 7 CCC
        ├── Kurseong (3413) — 3 CCC
        ├── Darjeeling (3414) — 4 CCC
        └── Siliguri Sub Urban (3415) — 7 CCC
```

**21 CCCs** total. Lodhama (3414204) is not in the official map and was removed.

Consumer counts are carried from the earlier ATC sheet where codes match; update anytime via Upload / seed.

Reseed local:

```bash
npm run seed --prefix server
```

Supabase (public schema) after tables exist:

```bash
# SQL Editor: run supabase/sql/004_seed_offices_public.sql
# or: npm run supabase:push --prefix server
```
