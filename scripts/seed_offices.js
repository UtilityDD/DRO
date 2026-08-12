/**
 * Copy offices seed into SQL-friendly notes.
 * Local runtime seeding is handled by server/src/seed.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, '_ccc_seed.json'), 'utf8'));
console.log('Divisions:', Object.keys(seed).length);
for (const [d, cccs] of Object.entries(seed)) {
  console.log(d, '→', cccs.length, 'CCCs');
}
