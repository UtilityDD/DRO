# DRO Insights — developer guide

How to run, change, and ship **DRO Insights** (Darjeeling Region ops PWA) without breaking login, NSC, Power Map, or the live site.

Canonical production: **https://dro-insight.vercel.app/**

Related docs:

| Doc | When to read |
|-----|----------------|
| [README](../README.md) | First clone / demo logins |
| [SUPABASE_SETUP](SUPABASE_SETUP.md) | New Supabase project or schema SQL |
| [DEPLOYMENT](DEPLOYMENT.md) | Any push or Vercel action |
| [AUTHORIZATION](AUTHORIZATION.md) | Roles, scopes, module permissions |
| [OFFICE_MAP](OFFICE_MAP.md) | Zone / division / CCC codes |

---

## 1. What this product is

DRO Insights is an internal ops portal for WBSEDCL **Darjeeling Region (341)**. Officers sign in with a username + PIN (not Supabase Auth). The app covers:

- Home pulse and office hierarchy
- New Connection (NSC) desk
- Disconnection, grievances, priority works, field notes, spot billing
- Consumer master, bulk consumers, AT&C
- Power Map (imported network map, restyled to match DRO)
- Upload Center and Users & Auth

It is **not** Smart Line Man (SLM). The git remote named `slm` is only a **DRO code mirror**. Never deploy this repo to the SLM Vercel project or `smartlineman.in`.

### Account ownership

GitHub is **not** the same login as Supabase or Vercel. Do not assume one mailbox owns everything.

| Surface | Account | Used for |
|---------|---------|----------|
| **GitHub** | **utility.dipankar@gmail.com** | Code: `UtilityDD/DRO` (`origin`) and the DRO mirror `smartlinemanapp/dro-insight` (`slm` remote). Push from this GitHub identity. |
| **Vercel (DRO live site)** | **smartlinemanapp@gmail.com** | Vercel project **dro-insight** → **https://dro-insight.vercel.app/**. Git push to the `slm` mirror triggers this deploy. |
| **Supabase (DRO ops)** | **smartlinemanapp@gmail.com** | DRO login, NSC, AT&C, offices, `portal_users` (`pjnmnmmerksyhatnowps`, schema `public`) |
| **Supabase (Power Map)** | **utility.dipankar@gmail.com** | HV substations / lines (`unsmtschmcvftfqwabaq`, schema `powermap`) |

Log into **utility.dipankar@gmail.com** for GitHub. Log into **smartlinemanapp@gmail.com** for DRO Vercel and DRO Supabase. Use **utility.dipankar@gmail.com** only for the Power Map database. Do not CLI-deploy DRO from the GitHub mailbox’s Vercel session.

---

## 2. Repo map

```
apps/web/                 Vite + React + TypeScript PWA
  src/pages/              One desk per route (NSC, AT&C, Power Map, …)
  src/lib/                Shared parsers, caches, desk builders
  src/powermap/           DRO bridge: client, scoped CSS
  public/geo/             District / block GeoJSON (large, cached)

server/                   Express API (sessions + store)
  src/index.js            Routes
  src/store.js            In-memory cache + persist
  src/supabase.js         PostgREST helper (service_role)
  src/nsc_*.js            NSC query, import, versioned snap cache
  data/                   Local JSON + supabase_config.json (gitignored)

api/index.js              Vercel serverless entry → server

vendor/PowerMapV2/        Embedded map app (do not treat as a second product)

supabase/sql/             DRO schema / migrations
docs/                     This guide and the docs above
deploy/target.json        Allowed / forbidden Vercel projects
scripts/                  Build, seed, CSS scoping, one-off imports
```

npm workspaces: `apps/web` and `server`. Root scripts start both.

---

## 3. Local setup

Requirements: Node 18+ (20 recommended), npm.

```bash
npm install
npm install --prefix server
npm install --prefix apps/web
npm run dev
```

| Surface | URL |
|---------|-----|
| Web | http://localhost:5173 |
| API | http://localhost:8787 |
| Health | http://localhost:8787/api/health |

Vite proxies `/api` to port 8787 and listens on all interfaces (`server.host: true`) so `localhost` and `127.0.0.1` both work on Windows.

Copy credentials (never commit this file):

```bash
copy server\data\supabase_config.example.json server\data\supabase_config.json
```

Fill DRO `supabaseUrl` + **service_role** key, `schema: "public"`. Optionally set Power Map URL + **anon** key.

`/api/health` should show `"store":"supabase"` and `"schema":"public"` when the config file is loaded.

### Demo PINs (local seed only)

| User | PIN | Scope |
|------|-----|--------|
| admin | 1234 | Full admin |
| region | 3410 | Region |
| stown | 3412 | Siliguri Town |
| hakim | 2502 | Hakimpara CCC |

Production PINs live in `public.portal_users`. Do not commit `server/data/portal_users.json`.

---

## 4. Two Supabase projects

Keep these separate. Mixing the URLs breaks login or the map.

| Role | Account | Typical project | Keys | Schema |
|------|---------|-----------------|------|--------|
| DRO login, NSC, AT&C, offices, users | **smartlinemanapp@gmail.com** | `pjnmnmmerksyhatnowps` | **service_role** on the server only | `public` (exposed) |
| Power Map HV substations / lines | **utility.dipankar@gmail.com** | `unsmtschmcvftfqwabaq` | **anon** in the browser | `powermap` (plus public `pm_*` views) |

Vercel env (Production) for DRO:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SCHEMA=public`, `SESSION_SECRET`
- `POWERMAP_SUPABASE_URL`, `POWERMAP_ANON_KEY`, `POWERMAP_SCHEMA=powermap`

Do **not** put the Power Map URL into `SUPABASE_URL`. Schema `dro` is **not** exposed on the live DRO project (`PGRST106`). Default in code is `public`.

Local file overrides env when `server/data/supabase_config.json` exists. On Vercel that file is absent, so env wins.

---

## 5. How the server store works

`server/src/store.js` loads tables into memory.

1. **Auth tables first** — `offices`, `portal_users`. Login can proceed.
2. **Then the rest** — AT&C, grievances, etc. NSC cases are **not** fully pulled on boot (`DEFER_TABLES`).
3. On Vercel the filesystem is read-only. Empty Supabase + no bundled JSON = empty cache.

### Login safety (do not regress)

Login used to `writeCollection('portal_users')`, which **deleted every user** and re-inserted them (`replaceTable`). A failed insert left `portal_users` empty and every PIN returned 401.

Rules:

- Login only **PATCHes** `last_login` via `touchUserLogin`.
- Persist of `portal_users` is **upsert by username**, never an empty replace.
- `replaceTable` refuses an empty payload.
- If logs say `loaded portal_users: 0 rows`, live login will fail until the table is restored.

### Persist rules

| Table | Persist style |
|-------|----------------|
| `portal_users` | Upsert on `username`; refuse empty |
| `atc_snapshots` | Upsert (never full replace of the dump) |
| `nsc_cases` | Upsert; refuse tiny writes over a large live dump |
| Most others | `replaceTable` (delete-then-insert) — do not call with `[]` |

Supabase fetches time out at 20s and fall back to local JSON when a file exists.

---

## 6. Frontend patterns

- Routes are **lazy** (`App.tsx`) so Leaflet / xlsx / Recharts are not on the first paint.
- Session cookie: `dro_sid` (httpOnly). `apps/web/src/auth.tsx` calls `/api/session` on boot.
- Scope: CCC / division users only see their offices. Filters live in `server/src/store.js` (`scopeFilter`) and `permissions.js`.
- Page chrome: `AppShell.tsx` (nav, theme, masthead). Power Map uses the same masthead — do not bring back the vendor TopBar as a second header.
- Styles: `apps/web/src/styles.css`. Power Map extras: `powermap.css` (scoped) + `powermap-dro.css`. After editing vendor CSS, run `node scripts/scope-powermap-css.mjs`.

`@` in Vite aliases to `vendor/PowerMapV2/src`, except `@/lib/supabase` which is remapped to `apps/web/src/powermap/supabase.ts`. Import DRO pages with relative paths, not `@/`.

---

## 7. Versioned dumps (NSC, AT&C, Power Map)

Ops dumps usually change **once a day**, rarely 2–3 times. Do not re-download Supabase on every chart open.

Shared client store for desk dumps: `apps/web/src/lib/dumpCache.ts` (IndexedDB `dro-ops-dumps`).  
NSC still uses its own IDB (`nscCache.ts`) because pending / withheld are two large queues.  
Power Map keeps the full network in its own IDB (`powermap-dro-v2`) and keys reuse by a **network stamp**.

### AT&C

**Version** = latest `period_label` + row count (`atcVersionOf` / `atc_snap_cache.js`).

| Layer | Behaviour |
|-------|-----------|
| Browser | Full IA+IB dump in IndexedDB; IA/IB switch is local |
| Client (`atcDump.ts`) | Same version → no download. Status recheck at most every 6 hours |
| `GET /api/atc` | Uses the in-memory store. `?refresh=1` re-pulls Supabase |
| `GET /api/atc/status` | Cheap count + latest period |
| Upload / persist | Invalidates the server memo |

The dump month shows next to **Refresh** on the AT&C page. Hovering AT&C in the nav prefetches the dump.

### NSC

**Version** = `report_date` + pending count + withheld count  
(`nscVersionOf` on the client, `nsc_snap_cache.js` on the server).

| Layer | Behaviour |
|-------|-----------|
| Browser IndexedDB (`dro-ops-nsc`) | Keep pending / withheld chart rows keyed by version |
| Client (`nscQueue.ts`) | Same version → no download. Recheck status at most every 6 hours |
| Server memory | Warm instance reuses last `/api/nsc/queue` payload for that version |
| Upload | Import / persist **invalidates** the server snap |

Do **not** treat “cached row count ≠ live count” as stale. That caused the withheld chart to clear and re-download until it timed out.

Refresh in the NSC toolbar forces a new pull. The dump date next to Refresh is the version you are on.

Key files:

- `apps/web/src/pages/NscDeskPage.tsx` — desk UI
- `apps/web/src/lib/nscQueue.ts` / `nscCache.ts` — versioned cache
- `server/src/nsc_query.js` — PostgREST paging
- `server/src/nsc_import.js` — upload job + invalidate
- `server/src/nsc_snap_cache.js` — in-process memo

### Power Map

**Version** = `pm_network_stamp.version` after migration `032_powermap_network_revision.sql`  
(`r:{revision}|ss:{n}|ln:{n}`). Until that SQL is applied in the **Power Map** project, the client falls back to  
`c:{ssCount}|{lineCount}|{max(assets.updated_at)}`.

| Layer | Behaviour |
|-------|-----------|
| Browser IndexedDB (`powermap-dro-v2`) | Full substations / lines / taps / org units |
| IDB store `personalDrafts` (DB v2) | Editor-only on-device SS + feeder drafts — **never** live map / never cloud until promote ships |
| Meta key `networkVersion` | Last stamp that matches the stored dump |
| Client (`vendor/PowerMapV2/src/lib/networkRepo.ts` → `loadNetwork`) | Fetch stamp first. Same stamp → **reuse IDB**, no `pm_v_*` pull. Mismatch or empty cache → full pull, then store stamp |
| Toolbar | Shows `Cached · r:N · …` or `Live · r:N · …`. Click forces `loadNetwork({ force: true })` |
| Super-admin saves | Cloud write bumps `powermap.network_meta.revision` (triggers in 032); client refreshes local stamp |
| Editor saves (SS + feeders) | **Personal drafts** in IDB only (comment required). Promote → suggestion comes later |

Run `032` in the Power Map Supabase SQL editor (**utility.dipankar@gmail.com** / `unsmtschmcvftfqwabaq`). Without it, fallback stamps still avoid most full reloads when nothing changed.

Verified live stamp example after apply: `r:2|ss:152|ln:183`.

Do **not** full-pull `pm_v_substations` + `pm_v_lines` on every Power Map visit once a stamp is available.

Key files:

- `supabase/sql/032_powermap_network_revision.sql` — revision table, triggers, `pm_network_stamp`
- `vendor/PowerMapV2/src/lib/networkRepo.ts` — `fetchNetworkStamp` / versioned `loadNetwork`
- `vendor/PowerMapV2/src/lib/personalDrafts.ts` — on-device draft CRUD + stale-live check
- `apps/web/src/pages/PowerMapPage.tsx` — version badge + force refresh
- `apps/web/src/powermap/supabase.ts` — `networkStamp` table name on the public bridge

---

## 8. Power Map

Embedded from `vendor/PowerMapV2`. DRO wraps it in `PowerMapPage.tsx`:

- No vendor TopBar; wrapper class is `pm-shell` (not `app-shell`, which collides with DRO).
- Gate `<PowerMapApp />` until `ensurePowerMapClient()` finishes so bootstrap does not lock onto a stale offline seed.
- Live substations: Power Map project `powermap` schema / public `pm_*` views (`POWERMAP_SUPABASE_URL` + `POWERMAP_ANON_KEY` on Vercel — not the DRO portal project).
- Geometry (`/geo/*.geojson`) is cached long-term (Vercel + service worker). Do not shrink it to “save bandwidth.”
- Network dump is **versioned** (see §7 Power Map). Prefer stamp reuse over re-downloading the whole grid.
- Neighbour / out-of-DRO EHV stubs are normal rows with remarks; do not invent cross-border links without OSM evidence.

### Layers vs ownership (what is DB vs code)

| Item | Storage |
|------|---------|
| Layers panel toggles, basemap, scenes, district focus | **Client only** (Zustand). Not a DB catalog — keep it that way for view prefs. |
| Scene presets (`mapScope.ts`) | **Code** |
| Voltage chips / colours (`VOLTAGE_CATALOG`) | **Code** UI; DB has `voltage_levels` for FKs on write |
| Asset `owner` value | **Database** — `powermap.assets.owner` (`text`) |
| Ownership dropdown list (`OWNER_OPTIONS`) | **Code** — WBSEDCL, WBSETCL, POWERGRID, NTPC, DVC, CESC |
| Report owner bucketing | **Code** — `normalizeOwner()` (33 kV → WBSEDCL; blank 132/220 → WBSETCL) |

### Personal drafts (editors)

Authorized editors save SS + feeder edits to **this device** (IndexedDB `personalDrafts`), with a required personal comment. Live map and cloud suggestions are unchanged until a later **promote → suggestion** flow. Settings → **My drafts**; teal map markers (orange = pending suggestions for super admin).

### Ownership fill + EHV SQL (Power Map project)

Run these in the **Power Map** SQL editor (`unsmtschmcvftfqwabaq`), in order when applying for the first time:

| Script | Purpose |
|--------|---------|
| `033_powermap_ehv_owner_wbsetcl.sql` | Blank 132/220 SS → WBSETCL |
| `034_raiganj_132_kush_gang.sql` | Raiganj GSS → Kushmandi GSS + Gangarampur GSS (132 kV, proposed); Kushmandi GSS class → 132 |
| `035_powermap_fill_owners.sql` | Canonicalize aliases; fill all blank SS/line/tap owners by voltage; force 33 kV SS → WBSEDCL |

After network SQL, hard-refresh Power Map (or force toolbar reload) so the stamp / dump updates.

## 9. Adding a desk or API

**New page**

1. Add `apps/web/src/pages/YourPage.tsx`.
2. `React.lazy` it in `App.tsx`.
3. Add a nav item in `AppShell.tsx` (`links` + `canAccessPath` / `moduleId`).
4. If it needs a permission, add the module in `server/src/permissions.js` and `docs/AUTHORIZATION.md`.

**New API**

1. Route in `server/src/index.js` behind `requireAuth` (and `requirePerm` when it is module data).
2. Read via `readCollection` / `ensureCollection` / `nscQuery` — do not `selectAll` huge tables on every request.
3. Writes go through `writeCollection` / `writeCollectionAndPersist` so cache and cloud stay aligned.

**New SQL**

Add `supabase/sql/0xx_….sql`. Run it in the **DRO** project SQL editor for ops tables, or the **Power Map** project for `powermap.*`. Do not assume `dro` is exposed.

---

## 10. What not to commit

Gitignored or leave untracked unless someone explicitly asks:

- `server/data/*.json` (includes `supabase_config.json` and local PIN files)
- `.env`, `.vercel/project.json`
- `data/hv_substations_dro.csv` / `.json` and similar one-off HV dumps
- `tmp_*`, inspect folders, scratch scripts with live data

Never commit service_role or anon keys.

---

## 11. Build, commit, deploy

```bash
npm run build                 # must pass
npm run deploy:verify         # must not say BLOCKED
```

Safe ship path:

```bash
git push origin main          # github.com/UtilityDD/DRO
git push slm main             # github.com/smartlinemanapp/dro-insight
```

The `slm` **git** push (from the **utility.dipankar@gmail.com** GitHub identity) is what Vercel on **smartlinemanapp@gmail.com** uses for **dro-insight.vercel.app**. GitHub ≠ Vercel ≠ Power Map Supabase. Do not CLI-deploy DRO while logged into a Vercel account that is not **smartlinemanapp@gmail.com**.

There is usually **no** local `.vercel/project.json`. Do not run `vercel deploy` unless `deploy:verify --strict` is OK and the linked project is `dro-insight`.

Forbidden Vercel projects: `slm`, `slm_web`, `dro-ops`, and the list in `deploy/target.json`.

After deploy, smoke-test **https://dro-insight.vercel.app/** — DRO login, not an SLM landing page.

Full checklist: [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 12. Common failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Live login 401, logs `portal_users: 0 rows` | Users table empty or wiped | Restore `public.portal_users`; do not replace-table users on login |
| Login works locally, not on Vercel | No config file on Vercel; env / schema wrong | `SUPABASE_SCHEMA=public`, DRO URL + service_role |
| Pages spin after login | Store not ready / hung Supabase | Auth tables unlock API; fetches time out at 20s |
| Withheld chart blank / timeout | Full dump re-fetched every visit | Trust dump version; use Refresh only after upload |
| Power Map always re-downloads | Stamp unused / 032 not applied | Prefer stamp reuse; run `032` in Power Map project |
| Owner blank / wrong on map | SQL fill not applied | Run `035_powermap_fill_owners.sql` in Power Map project |
| Editor save did not change live map | By design — personal drafts | Check Settings → My drafts; promote→suggestion not shipped yet |
| Power Map looks like a second app | Vendor `app-shell` / TopBar | Keep `pm-shell` + DRO masthead |
| Vite “not loading” on Windows | Bound to IPv6 only | `server.host: true` (already set) |
| `Invalid schema: dro` | Schema not exposed | Use `public` |
| Wrong site after deploy | Linked or deployed to SLM | Stop, roll back; see DEPLOYMENT.md |

---

## 13. Daily workflow (suggested)

1. `npm run dev` — confirm `/api/health` and login.
2. Change one desk or API path; keep persist rules for users / NSC / AT&C.
3. `npm run build` before you call the work done.
4. Commit only the files you mean to ship.
5. Push `origin` then `slm` when the user wants production.
6. Hard-refresh the live site and click the desk you touched.

When in doubt: **do not** empty-replace `portal_users`, **do not** full-pull NSC on every page view, **do not** full-pull Power Map `pm_v_*` when the network stamp is unchanged, **do not** deploy this repo to SLM.
