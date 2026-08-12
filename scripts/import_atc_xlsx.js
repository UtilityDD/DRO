/**
 * Import Format-IA / IB ATC workbook into atc_snapshots (upsert by period|format|code).
 * Usage: node scripts/import_atc_xlsx.js [path-to-xlsx]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'server', 'node_modules', 'xlsx'));
const { parseAtcWorkbook } = require('../server/src/atc_parse');
const { writeCollectionSync, readCollectionSync, nextId, initStore } = require('../server/src/store');

const DEFAULT =
  process.argv[2] ||
  String.raw`C:\Users\USER\Downloads\1.1A. CCCWISE ATC LOSS May'26_final_ (1).xlsx`;

async function main() {
  await initStore();
  const file = DEFAULT;
  if (!fs.existsSync(file)) {
    console.error('File not found:', file);
    process.exit(1);
  }
  const wb = XLSX.readFile(file);
  const parsed = parseAtcWorkbook(wb, (sheet) =>
    XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })
  );
  console.log('Period:', parsed.period_label, 'FY target:', parsed.target_fy, 'counts', parsed.counts);

  const existing = readCollectionSync('atc_snapshots', []);
  const keyFn = (r) => `${r.period_label}|${r.source_format || 'IA'}|${r.office_code}`;
  const index = new Map(existing.map((r) => [keyFn(r), r]));
  let upserted = 0;
  const now = new Date().toISOString();

  for (const row of parsed.rows) {
    const mapped = {
      ...row,
      batch_id: null,
      updated_at: now,
      created_at: now,
    };
    const key = keyFn(mapped);
    const prev = index.get(key);
    if (prev) {
      Object.assign(prev, mapped, { id: prev.id, created_at: prev.created_at || now });
    } else {
      mapped.id = nextId(existing);
      existing.push(mapped);
      index.set(key, mapped);
    }
    upserted += 1;
  }

  writeCollectionSync('atc_snapshots', existing);
  console.log(`Upserted ${upserted} ATC rows → server/data/atc_snapshots.json (total ${existing.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
