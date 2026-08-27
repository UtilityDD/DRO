/**
 * Import Format-IA / IB ATC workbook into atc_snapshots (upsert by period|format|code).
 * Usage: node scripts/import_atc_xlsx.js [path-to-xlsx]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'server', 'node_modules', 'xlsx'));
const { parseAtcWorkbook, mergeAtcSnapshots } = require('../server/src/atc_parse');
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
  const now = new Date().toISOString();
  const incoming = parsed.rows.map((row) => ({
    ...row,
    batch_id: null,
    updated_at: now,
  }));
  const { applied, skippedHeader } = mergeAtcSnapshots(existing, incoming, { now, nextId });
  writeCollectionSync('atc_snapshots', existing);
  console.log(
    `Upserted ${applied.length} ATC rows (${skippedHeader} header months kept as existing achievement) → server/data/atc_snapshots.json (total ${existing.length})`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
