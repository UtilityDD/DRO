# DRO deployment guide

Read this before pushing or deploying. **DRO Ops and Smart Line Man (SLM) are different products.** Deploying this repo to the wrong Vercel project will overwrite live SLM sites (`smartlineman.in`).

---

## What belongs where

| Item | DRO Ops (this repo) | Smart Line Man (SLM) |
|------|---------------------|----------------------|
| **Purpose** | WBSEDCL Darjeeling Region ops PWA | Smart Line Man consumer app |
| **Repo folder** | `DRO/` | Separate SLM repo (not this one) |
| **Git remote `origin`** | `github.com/UtilityDD/DRO` | — |
| **Git remote `slm`** | `github.com/smartlinemanapp/dro-insight` — **DRO code mirror only** | Not the SLM app source |
| **Vercel project** | **`dro-ops`** (create / use this) | **`slm`** — **never link DRO here** |
| **Production URLs** | TBD on `dro-ops` project | `slm-inky.vercel.app`, `smartlineman.in` |

> **Common mistake:** The git remote is named `slm` because it mirrors DRO code to `dro-insight`. That name does **not** mean “deploy to the SLM Vercel project.”

---

## Forbidden targets (never deploy DRO here)

Vercel projects:

- `slm`
- `slm_web`
- `mzo-report-pwa`, `power-map-v2`, and other unrelated projects

Production hosts:

- `smartlineman.in` / `www.smartlineman.in`
- `slm-inky.vercel.app`
- `slmweb-ivory.vercel.app`

If you see any of these after a deploy, **stop and roll back immediately.**

---

## One-time setup

### 1. Create a dedicated Vercel project for DRO

In [Vercel dashboard](https://vercel.com) → **Add New → Project**:

- Import **`UtilityDD/DRO`** (or connect this folder)
- **Project name:** `dro-ops` (must match [`deploy/target.json`](../deploy/target.json))
- **Root directory:** repository root (where root `vercel.json` lives)
- **Build command:** `node scripts/vercel-build.js`
- **Output directory:** `apps/web/dist`
- **Install command:** `npm install`

Do **not** reuse the existing `slm` project.

### 2. Link this working copy to `dro-ops` only

From repo root, logged into the correct Vercel team (`dipankar-das-projects-1592747b`):

```bash
# If a wrong link exists, remove it first
Remove-Item -Recurse -Force .vercel   # PowerShell
# rm -rf .vercel                      # macOS / Linux

npx vercel link --project dro-ops --yes
```

Confirm `.vercel/project.json` exists and is **gitignored** (never commit it).

### 3. Configure production env vars

In Vercel → **dro-ops** → Settings → Environment Variables, set the same secrets the API needs (Supabase URL, service role key, session secret, etc.). See [`docs/SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

---

## Safe deploy checklist

Run through this **every time** before production:

1. **Branch / changes** — you intend to ship DRO, not SLM.
2. **Git remote** — pushing code is fine to `origin` or `slm` (mirror); pushing does not pick the Vercel project.
3. **Vercel link** — run:
   ```bash
   npm run deploy:verify
   ```
   Must print `OK — linked to dro-ops`. If it says **BLOCKED**, do not deploy.
4. **Local build** — must pass:
   ```bash
   npm run build
   ```
5. **Deploy** — use the guarded script (runs verify first):
   ```bash
   npm run deploy:prod
   ```
6. **Post-deploy smoke test** — open the **new** deployment URL from the CLI output. Confirm it is the DRO login/ops UI, **not** the SLM landing page.

---

## Commands reference

| Command | Purpose |
|---------|---------|
| `npm run build` | Local production build |
| `npm run deploy:verify` | Check Vercel link is `dro-ops`, not a forbidden project |
| `npm run deploy:prod` | Verify + deploy to production (`dro-ops` only) |

Manual deploy (only after verify passes):

```bash
npm run deploy:verify -- --strict
npx vercel deploy --prod --yes
```

---

## Git remotes

```bash
git remote -v
# origin  https://github.com/UtilityDD/DRO.git
# slm     https://github.com/smartlinemanapp/dro-insight.git
```

- **`origin`** — primary DRO repository
- **`slm`** — optional mirror for `dro-insight`; name is historical, not a deploy target

Typical flow:

```bash
git push origin main      # primary
git push slm main         # optional mirror — still not an SLM app deploy
npm run deploy:prod       # Vercel deploy to dro-ops only
```

---

## Roll back a mistaken production deploy

If DRO was deployed to **`slm`** by accident:

1. **Do not** run `vercel deploy --prod` again from this repo.
2. In Vercel → **slm** project → Deployments, find the last good SLM deployment (before DRO).
3. Promote / roll back:
   ```bash
   npx vercel promote <previous-slm-deployment-url> --yes
   ```
4. Remove the wrong link from DRO:
   ```bash
   Remove-Item -Recurse -Force .vercel
   ```
5. Revert the mistaken git push if needed:
   ```bash
   git revert <bad-commit-sha>
   git push slm main
   ```

---

## For AI / automation agents

Before any Vercel production action on this repo:

1. Read [`deploy/target.json`](../deploy/target.json).
2. Run `npm run deploy:verify -- --strict` and **abort** on non-zero exit.
3. Never run `vercel link --project slm` or `vercel deploy --prod` without verify passing.
4. Never assume the git remote named `slm` maps to the SLM Vercel project.
5. If no `dro-ops` project exists yet, **ask the user** to create it — do not pick another project.

---

## Files

| File | Role |
|------|------|
| [`vercel.json`](../vercel.json) | Root Vercel config (build + API rewrites) |
| [`deploy/target.json`](../deploy/target.json) | Allowed / forbidden project names (used by verify script) |
| [`scripts/verify-deploy-target.js`](../scripts/verify-deploy-target.js) | Pre-deploy safety check |
| [`.vercel/project.json`](../.vercel/) | Local link to Vercel project — **gitignored** |
