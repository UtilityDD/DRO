# DRO Ops — Darjeeling Region PWA

Single-database interactive ops portal for WBSEDCL **Darjeeling Region (341)** day-to-day monitoring.

## Stack

- **Frontend:** Vite + React + TypeScript PWA (`apps/web`)
- **API:** Express session auth (`server`)
- **Data (local default):** JSON store under `server/data` (auto-seeded)
- **Data (production):** Supabase Postgres schema `dro` — see `supabase/sql/`

## Quick start

```bash
# from repo root
npm install
npm install --prefix server
npm install --prefix apps/web
npm run seed --prefix server
npm run dev
```

- Web: http://localhost:5173  
- API: http://localhost:8787  

## Your own Supabase account

DRO does **not** use the MZO Supabase project. Point it at a project you create:

1. Create a free project at [supabase.com](https://supabase.com)  
2. Run SQL in `supabase/sql/` (001 → 002 → 003) and expose schema `dro`  
3. Copy `server/data/supabase_config.example.json` → `supabase_config.json` and paste **your** Project URL + **service_role** key  
4. `npm run supabase:push --prefix server` then restart the API  

Full steps: [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md)

**Deploying to Vercel:** read [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) first — live site is **https://dro-insight.vercel.app/**; never deploy to **`slm`** / `smartlineman.in`, and do not create a substitute project under another account.

Check: `http://localhost:8787/api/health` → `"store":"supabase"` when connected.

### Demo logins

| User | PIN | Scope |
|------|-----|--------|
| admin | 1234 | Full admin |
| region | 3410 | Region |
| stown | 3412 | Siliguri Town division |
| hakim | 2502 | Hakimpara CCC |

## Modules

- Hierarchy (Zone → Region → Division → CCC)
- New Connection (NSC)
- Disconnection / revenue drive
- Consumer grievances
- Priority technical works + vendor billing
- Spot billing
- Bulk consumers
- AT&C snapshots
- Upload Center (Excel → chunked publish)
- Admin users / activity log

## Supabase

1. Create a free Supabase project
2. Run `supabase/sql/001_schema.sql` then `002_seed_offices.sql`
3. Expose schema `dro` in API settings
4. (Optional next step) Point server at Supabase — local JSON store works fully for Phase 0–3 demos

## Hierarchy source

CCC / Division mapping seeded from ATC Format-IA sheet (`_ccc_seed.json`).
