/**
 * One-off import of the Malda pending-NSC dump as DRO snapshot.
 * Usage: node scripts/import_nsc_xlsb.js [file] [YYYY-MM-DD]
 */
const fs = require('fs');
const path = require('path');
const { parseNscWorkbook } = require('../server/src/nsc_parse');
const { initStore, writeCollectionAndPersist, nextId, readCollection } = require('../server/src/store');

const DEFAULT_FILE =
  'C:/Users/rouma/Downloads/MALDA ZONE PENDING NSC ACCEPTED WORKING 7 WITHELD APPLICATION AS ON 22-08-2026.xlsb';

async function main() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  const reportDate = process.argv[3] || '2026-08-22';
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  await initStore();
  const offices = require('../server/src/store').readCollection('offices', []);
  const divs = new Map(offices.filter((o) => o.office_type === 'division').map((o) => [String(o.code), o.name]));
  const droCccs = offices
    .filter((o) => o.office_type === 'ccc')
    .map((o) => ({
      code: String(o.code),
      name: o.name,
      division_code: String(o.division_code || ''),
      division_name: divs.get(String(o.division_code)) || '',
    }));
  console.log('[nsc-import] parsing', path.basename(filePath), 'as on', reportDate, 'cccs', droCccs.length);
  const { rows, preview } = parseNscWorkbook({
    filePath,
    filename: path.basename(filePath),
    reportDate,
    droCccs,
  });
  console.log('[nsc-import] preview', JSON.stringify(preview, null, 2));
  const numbered = rows.map((r, i) => ({ ...r, id: i + 1 }));
  const batches = readCollection('upload_batches', []);
  const batch = {
    id: nextId(batches),
    module: 'nsc',
    filename: path.basename(filePath),
    uploaded_by: 'import',
    row_count: numbered.length,
    error_count: 0,
    period_label: reportDate,
    notes: `report ${reportDate}`,
    created_at: new Date().toISOString(),
  };
  batches.unshift(batch);
  for (const r of numbered) r.batch_id = batch.id;
  await writeCollectionAndPersist('upload_batches', batches);
  const cloud = await writeCollectionAndPersist('nsc_cases', numbered);
  console.log('[nsc-import] saved', numbered.length, cloud);
}

main().catch((e) => {
  console.error('[nsc-import]', e);
  process.exit(1);
});
