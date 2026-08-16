const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'apps', 'web');
const viteJs = [
  path.join(webDir, 'node_modules', 'vite', 'bin', 'vite.js'),
  path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
].find((p) => fs.existsSync(p));

if (!viteJs) {
  console.error('vite not found. Run npm install at the repo root.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [viteJs, 'build'], {
  cwd: webDir,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status == null ? 1 : result.status);
