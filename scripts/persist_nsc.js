const fs = require('fs');
const path = require('path');
const { writeCollectionAndPersist } = require('../server/src/store');

async function main() {
  const file = path.join(__dirname, '../server/data/nsc_cases.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = new Map();
  for (const r of rows) map.set(String(r.application_no), r);
  const unique = [...map.values()].map((r, i) => ({ ...r, id: i + 1 }));
  console.log('[nsc-persist] unique', unique.length, 'from', rows.length);
  const cloud = await writeCollectionAndPersist('nsc_cases', unique);
  console.log('[nsc-persist]', cloud);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
