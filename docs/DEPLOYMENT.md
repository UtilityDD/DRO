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
| **Canonical production URL** | **https://dro-insight.vercel.app/** | `slm-inky.vercel.app`, `smartlineman.in` |
| **Vercel project** | The project that already serves `dro-insight.vercel.app` (set in [`deploy/target.json`](../deploy/target.json)) | **`slm`** — **never link DRO here** |

> **Canonical live site:** [https://dro-insight.vercel.app/](https://dro-insight.vercel.app/)  
> **Common mistake:** The git remote is named `slm` because it mirrors DRO code to `dro-insight`. That name does **not** mean “deploy to the SLM Vercel project.” Never deploy DRO to `slm` / `smartlineman.in`.

---

## Forbidden targets (never deploy DRO here)

Vercel projects:

- `slm`
- `slm_web`
- `dro-ops` (deleted mistaken project — do not recreate under the wrong team)
- `mzo-report-pwa`, `power-map-v2`, and other unrelated projects

Production hosts:

- `smartlineman.in` / `www.smartlineman.in`
- `slm-inky.vercel.app`
- `slmweb-ivory.vercel.app`
- `dro-ops.vercel.app`

If you see any of these after a deploy, **stop and roll back immediately.**

---

## Rule: deploy only to the account that owns dro-insight

1. Log into the **same Vercel account/team** that owns **https://dro-insight.vercel.app/**
2. Confirm the project name in the dashboard (the one whose Production domain is `dro-insight.vercel.app`).
3. Put that project name in [`deploy/target.json`](../deploy/target.json) as `vercel.project`.
4. Link this folder to **that** project only:

```bash
Remove-Item -Recurse -Force .vercel   # PowerShell — clear any bad link
# rm -rf .vercel                      # macOS / Linux

npx vercel link --project <project-that-owns-dro-insight> --yes
npm run deploy:verify -- --strict
```

5. Only then deploy:

```bash
npm run deploy:prod
```

**Do not** create a new Vercel project under another team. **Do not** link to `slm`.

### Configure production env vars

In Vercel → **that DRO project** → Settings → Environment Variables, set Supabase URL, service role key, session secret, etc. See [`docs/SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

---

## Safe deploy checklist

Run through this **every time** before production:

1. **Branch / changes** — you intend to ship DRO, not SLM.
2. **Correct Vercel login** — `npx vercel whoami` is the account that owns `dro-insight.vercel.app`.
3. **Git remote** — pushing code is fine to `origin` or `slm` (mirror); pushing does not pick the Vercel project.
4. **Vercel link** — run:
   ```bash
   npm run deploy:verify
   ```
   Must print `OK — linked to …`. If it says **BLOCKED**, do not deploy.
5. **Local build** — must pass:
   ```bash
   npm run build
   ```
6. **Deploy** — use the guarded script (runs verify first):
   ```bash
   npm run deploy:prod
   ```
7. **Post-deploy smoke test** — open **https://dro-insight.vercel.app/** and confirm DRO login/ops UI, **not** the SLM landing page.

---

## Commands reference

| Command | Purpose |
|---------|---------|
| `npm run build` | Local production build |
| `npm run deploy:verify` | Check Vercel link is the DRO project, not a forbidden project |
| `npm run deploy:prod` | Verify + deploy to production |

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
npm run deploy:prod       # Vercel deploy to the project that owns dro-insight only
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

If a mistaken **new** project was created under the wrong team (e.g. `dro-ops`):

```bash
npx vercel project rm <wrong-project-name>
Remove-Item -Recurse -Force .vercel
```

---

## For AI / automation agents

Before any Vercel production action on this repo:

1. Read [`deploy/target.json`](../deploy/target.json).
2. If `vercel.project` is `null`, **stop and ask the user** which account/project owns `dro-insight.vercel.app`. Do not create a new project.
3. Run `npm run deploy:verify -- --strict` and **abort** on non-zero exit.
4. Never run `vercel link --project slm` or recreate `dro-ops` under another team.
5. Never assume the git remote named `slm` maps to the SLM Vercel project.
6. After deploy, smoke-test **https://dro-insight.vercel.app/** only.

---

## Files

| File | Role |
|------|------|
| [`vercel.json`](../vercel.json) | Root Vercel config (build + API rewrites) |
| [`deploy/target.json`](../deploy/target.json) | Allowed / forbidden project names (used by verify script) |
| [`scripts/verify-deploy-target.js`](../scripts/verify-deploy-target.js) | Pre-deploy safety check |
| [`.vercel/project.json`](../.vercel/) | Local link to Vercel project — **gitignored** |
