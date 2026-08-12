# Use your own Supabase account (not MZO)

DRO is built to run against **your** Supabase project. Nothing is hardcoded to another zone’s project.

## Your project (pjnmnmmerksyhatnowps)

Keys are saved in `server/data/supabase_config.json` (gitignored) with **schema: public**.

### One step you must do in the dashboard

1. Open [SQL Editor](https://supabase.com/dashboard/project/pjnmnmmerksyhatnowps/sql/new)
2. Paste contents of [`supabase/sql/SETUP_PUBLIC.sql`](../supabase/sql/SETUP_PUBLIC.sql)
3. Click **Run**

Then tell the agent “SQL done” (or run locally):

```bash
npm run seed --prefix server
npm run supabase:push --prefix server
```

Restart the API — `/api/health` should show `"store":"supabase"`.

### AT&C column expansion (if you already ran SETUP_PUBLIC earlier)

Run [`supabase/sql/005_atc_expand.sql`](../supabase/sql/005_atc_expand.sql) in SQL Editor, then:

```bash
node scripts/import_atc_xlsx.js
npm run supabase:push --prefix server
```

## 2. Run SQL (schema `dro`)

In Supabase → **SQL Editor** → New query, run in order:

1. [`supabase/sql/001_schema.sql`](../supabase/sql/001_schema.sql)  
2. [`supabase/sql/002_seed_offices.sql`](../supabase/sql/002_seed_offices.sql)  
3. [`supabase/sql/003_permissions.sql`](../supabase/sql/003_permissions.sql)  

## 3. Expose schema `dro`

**Project Settings → API → Exposed schemas** → add `dro` (keep `public`). Save.

## 4. Copy API keys into DRO

**Project Settings → API**:

- **Project URL** → `supabaseUrl`  
- **service_role** (secret) → `supabaseServiceRoleKey`  

```bash
copy server\data\supabase_config.example.json server\data\supabase_config.json
```

Edit `server/data/supabase_config.json` with your URL + service_role key.

Or use env vars from `.env.example`:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

`supabase_config.json` and `.env` are gitignored — do not commit keys.

## 5. Push local seed / check connection

```bash
npm run seed --prefix server
npm run supabase:status --prefix server
npm run supabase:push --prefix server
```

Restart API:

```bash
npm run dev --prefix server
```

Visit http://localhost:5173 — login still `admin` / `1234` after seed push.

## 6. Verify in app

`GET /api/health` shows whether Supabase is active:

```json
{ "ok": true, "store": "supabase", "supabase": { "configured": true, "host": "xxxx.supabase.co" } }
```

If `store` is `"local"`, credentials are missing or the URL still contains `YOUR_PROJECT`.

## Notes

- Use **service_role** on the Express server only (never in the browser).  
- Free tier (~500 MB) is enough for lean ~5L consumer master + ops tables.  
- Switching accounts = new project + new `supabase_config.json` + re-run SQL + `supabase:push`.
