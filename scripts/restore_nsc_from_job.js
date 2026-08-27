/**
 * Restore nsc_cases from a completed import job's packed part JSON in Storage.
 * Usage: node scripts/restore_nsc_from_job.js [job-id]
 */
const sb = require('../server/src/supabase');

const JOB_ID = process.argv[2] || '45e30e28-84d8-4777-9149-eeed395e4066';
const DEMO_APPS = Array.from({ length: 8 }, (_, i) => `NSC-341-${1000 + i}`);
const CHUNK = 400;

async function main() {
  const job = await sb.querySupabase(
    `nsc_import_jobs?id=eq.${encodeURIComponent(JOB_ID)}&select=id,status,filename,report_date,total,upserted,storage_path`
  );
  const meta = Array.isArray(job) ? job[0] : null;
  if (!meta) throw new Error(`Import job ${JOB_ID} not found`);
  console.log('[restore-nsc] job', JSON.stringify(meta));

  const before = await sb.countRows('nsc_cases');
  console.log('[restore-nsc] live count before', before);

  const prefix = `imports/${JOB_ID}/`;
  let upserted = 0;
  for (let i = 0; i < 64; i += 1) {
    const objectPath = `${prefix}part-${i}.json`;
    let buf;
    try {
      buf = await sb.storageDownload('nsc', objectPath);
    } catch (e) {
      if (i === 0) throw e;
      break;
    }
    const rows = JSON.parse(buf.toString('utf8'));
    if (!Array.isArray(rows) || !rows.length) {
      console.log('[restore-nsc] empty part', i);
      continue;
    }
    for (let j = 0; j < rows.length; j += CHUNK) {
      const slice = rows.slice(j, j + CHUNK);
      await sb.upsertRows('nsc_cases', slice, 'application_no', { silent: true });
    }
    upserted += rows.length;
    console.log('[restore-nsc] part', i, rows.length, 'running', upserted);
  }

  const demoFilter = `application_no=in.(${DEMO_APPS.map((a) => `"${a}"`).join(',')})`;
  const demoCount = await sb.countRows('nsc_cases', demoFilter);
  if (demoCount) {
    await sb.deleteAllMatching('nsc_cases', demoFilter);
    console.log('[restore-nsc] removed demo rows', demoCount);
  }

  const after = await sb.countRows('nsc_cases');
  const pending = await sb.countRows('nsc_cases', 'status=eq.pending');
  const withheld = await sb.countRows('nsc_cases', 'status=eq.withheld');
  console.log('[restore-nsc] done', { upserted, expected: meta.total, after, pending, withheld });
  if (meta.total && after < Number(meta.total) * 0.95) {
    throw new Error(`Restore short: ${after} vs job total ${meta.total}`);
  }
}

main().catch((e) => {
  console.error('[restore-nsc]', e.message || e);
  process.exit(1);
});
