/**
 * Fail fast if this repo is linked to the wrong Vercel project.
 * Run before any production deploy: npm run deploy:verify
 */
const { spawnSync } = require('child_process');
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

function vercelJson(args) {
  const result = spawnSync('npx', ['--yes', 'vercel@59.5.0', ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    return null;
  }
  const text = (result.stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function projectIdForName(name) {
  const data = vercelJson(['project', 'inspect', name, '--json']);
  return data?.id || null;
}

function main() {
  const target = loadTarget();
  const expected = target.vercel.project;
  const forbidden = target.vercel.forbiddenProjects || [];

  console.log(`[deploy:verify] Product: ${target.product}`);
  console.log(`[deploy:verify] Expected Vercel project: ${expected}`);
  console.log(`[deploy:verify] Forbidden Vercel projects: ${forbidden.join(', ')}`);
  console.log(`[deploy:verify] Never deploy to: ${(target.vercel.forbiddenProductionHosts || []).join(', ')}`);
  console.log('');

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
  const linkedId = linked.projectId;
  if (!linkedId) {
    console.error('[deploy:verify] .vercel/project.json is missing projectId');
    process.exit(1);
  }

  for (const name of forbidden) {
    const id = projectIdForName(name);
    if (id && id === linkedId) {
      console.error('');
      console.error(`[deploy:verify] BLOCKED: this folder is linked to forbidden project "${name}".`);
      console.error(`[deploy:verify] That project serves production sites such as smartlineman.in — NOT DRO.`);
      console.error('');
      console.error(`Relink safely:\n  Remove-Item -Recurse -Force .vercel\n  npx vercel link --project ${expected} --yes`);
      console.error('');
      console.error('See docs/DEPLOYMENT.md');
      process.exit(1);
    }
  }

  const expectedId = projectIdForName(expected);
  if (!expectedId) {
    const msg = `[deploy:verify] Vercel project "${expected}" was not found. Create it in the dashboard first, then link.`;
    if (strict) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(msg);
    return;
  }

  if (linkedId !== expectedId) {
    console.error('');
    console.error(`[deploy:verify] BLOCKED: linked projectId ${linkedId} does not match "${expected}" (${expectedId}).`);
    console.error(`Relink: npx vercel link --project ${expected} --yes`);
    console.error('See docs/DEPLOYMENT.md');
    process.exit(1);
  }

  console.log(`[deploy:verify] OK — linked to ${expected} (${linkedId})`);
}

main();
