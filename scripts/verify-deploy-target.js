/**
 * Fail fast if this repo is linked to the wrong Vercel project.
 * Run before any production deploy: npm run deploy:verify
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targetPath = path.join(root, 'deploy', 'target.json');
const linkPath = path.join(root, '.vercel', 'project.json');
const strict = process.argv.includes('--strict');

function loadTarget() {
  if (!fs.existsSync(targetPath)) {
    console.error('Missing deploy/target.json');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
}

function main() {
  const target = loadTarget();
  const expected = target.vercel.project == null ? '' : String(target.vercel.project).trim();
  const productionUrl = String(target.vercel.productionUrl || 'https://dro-insight.vercel.app/');
  const forbidden = (target.vercel.forbiddenProjects || []).map((n) => String(n).toLowerCase());

  console.log(`[deploy:verify] Product: ${target.product}`);
  console.log(`[deploy:verify] Canonical URL: ${productionUrl}`);
  console.log(`[deploy:verify] Expected Vercel project: ${expected || '(not set — ask user / set deploy/target.json)'}`);
  console.log(`[deploy:verify] Forbidden Vercel projects: ${forbidden.join(', ')}`);
  console.log(`[deploy:verify] Never deploy to: ${(target.vercel.forbiddenProductionHosts || []).join(', ')}`);
  console.log('');

  if (!expected) {
    const msg =
      '[deploy:verify] vercel.project is not set in deploy/target.json.\n' +
      `  Log into the Vercel account that owns ${productionUrl}, set vercel.project to that project name, then link.\n` +
      '  Do not create a new project under another team. See docs/DEPLOYMENT.md';
    console.error(msg);
    process.exit(1);
  }

  if (!fs.existsSync(linkPath)) {
    const msg = `[deploy:verify] No .vercel/project.json — link this repo first:\n  npx vercel link --project ${expected} --yes`;
    if (strict) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(msg);
    return;
  }

  const linked = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
  const linkedName = String(linked.projectName || '').trim();
  const linkedId = String(linked.projectId || '').trim();

  if (!linkedName && !linkedId) {
    console.error('[deploy:verify] .vercel/project.json is missing projectName/projectId');
    process.exit(1);
  }

  if (linkedName) {
    const lower = linkedName.toLowerCase();
    if (forbidden.includes(lower)) {
      console.error('');
      console.error(`[deploy:verify] BLOCKED: this folder is linked to forbidden project "${linkedName}".`);
      console.error('[deploy:verify] That is not the DRO production project (dro-insight.vercel.app).');
      console.error('');
      console.error(`Relink safely:\n  Remove-Item -Recurse -Force .vercel\n  npx vercel link --project ${expected} --yes`);
      console.error('');
      console.error('See docs/DEPLOYMENT.md');
      process.exit(1);
    }

    if (lower !== expected.toLowerCase()) {
      console.error('');
      console.error(`[deploy:verify] BLOCKED: linked project "${linkedName}" does not match "${expected}".`);
      console.error(`Relink: npx vercel link --project ${expected} --yes`);
      console.error('See docs/DEPLOYMENT.md');
      process.exit(1);
    }
  }

  console.log(`[deploy:verify] OK — linked to ${linkedName || expected}${linkedId ? ` (${linkedId})` : ''}`);
}

main();
