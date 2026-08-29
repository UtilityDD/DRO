const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sb = require('./supabase');
const nscLib = require('./nsc_parse');
const { nscExportCsv } = require('./nsc_query');

const BUCKET = 'nsc';
const PART = 2000;
const UPSERT_CHUNK = 400;

/** Read existing first_seen_on values so a re-upload does not reset them. */
async function stampIncomingFirstSeen(rows) {
  const apps = [...new Set((rows || []).map((r) => String(r?.application_no || '').trim()).filter(Boolean))];
  const existingByApp = new Map();
  for (let i = 0; i < apps.length; i += 80) {
    const chunk = apps.slice(i, i + 80);
    const filter = chunk.map((a) => `"${String(a).replace(/"/g, '')}"`).join(',');
    try {
      const found = await sb.querySupabase(
        `nsc_cases?select=application_no,first_seen_on&application_no=in.(${filter})`
      );
      for (const row of Array.isArray(found) ? found : []) {
        if (row?.application_no && row.first_seen_on) {
          existingByApp.set(String(row.application_no), row.first_seen_on);
        }
      }
    } catch (e) {
      // Column may not exist until 019_nsc_first_seen.sql is applied
      if (!/first_seen_on/i.test(String(e.message || e))) throw e;
      break;
    }
  }
  return nscLib.mergeFirstSeen(rows, existingByApp);
}

function jobPath(id, name) {
  return `imports/${id}/${name}`;
}

async function saveJob(job) {
  job.updated_at = new Date().toISOString();
  await sb.upsertRows('nsc_import_jobs', [job], 'id', { silent: true });
  return job;
}

async function loadJob(id) {
  const rows = await sb.querySupabase(`nsc_import_jobs?id=eq.${encodeURIComponent(id)}&select=*`);
  return Array.isArray(rows) ? rows[0] : null;
}

async function createUpload(user, { filename, reportDate }) {
  const id = crypto.randomUUID();
  const objectPath = jobPath(id, filename || 'dump.xlsb');
  const signed = await sb.storageSignedUpload(BUCKET, objectPath);
  const job = {
    id,
    filename: filename || 'dump.xlsb',
    report_date: reportDate || null,
    status: 'uploading',
    storage_path: objectPath,
    part_count: 0,
    part_index: 0,
    total: 0,
    upserted: 0,
    preview: null,
    error: null,
    created_by: user?.username || '',
  };
  await saveJob(job);
  return { job_id: id, ...signed };
}

async function parseJob(jobId, droCccs) {
  const job = await loadJob(jobId);
  if (!job) throw new Error('Import job missing');
  const buf = await sb.storageDownload(BUCKET, job.storage_path);
  const tmp = path.join(os.tmpdir(), `nsc-${job.id}${path.extname(job.filename || '.xlsb')}`);
  fs.writeFileSync(tmp, buf);
  try {
    const { rows, preview } = nscLib.parseNscWorkbook({
      filePath: tmp,
      filename: job.filename,
      reportDate: job.report_date,
      droCccs,
    });
    const packed = rows.map((r) => nscLib.packNscCloudRow(r));
    const parts = [];
    for (let i = 0; i < packed.length; i += PART) {
      parts.push(packed.slice(i, i + PART));
    }
    for (let i = 0; i < parts.length; i += 1) {
      await sb.storagePutJson(BUCKET, jobPath(job.id, `part-${i}.json`), parts[i]);
    }
    job.status = 'parsed';
    job.part_count = parts.length;
    job.part_index = 0;
    job.total = packed.length;
    job.upserted = 0;
    job.preview = preview;
    job.report_date = preview.report_date || job.report_date;
    job.error = null;
    await saveJob(job);
    return job;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

const PARTS_PER_TICK = 3;

async function tickJob(jobId) {
  const job = await loadJob(jobId);
  if (!job) throw new Error('Import job missing');
  if (job.status === 'done') return job;
  if (job.status !== 'parsed' && job.status !== 'upserting') {
    throw new Error(`Import is ${job.status}`);
  }

  const partCount = Number(job.part_count) || 0;
  let idx = Number(job.part_index) || 0;
  if (!partCount || idx >= partCount) {
    markJobDone(job);
    return job;
  }

  job.status = 'upserting';
  const until = Math.min(partCount, idx + PARTS_PER_TICK);
  while (idx < until) {
    const raw = await sb.storageDownload(BUCKET, jobPath(job.id, `part-${idx}.json`));
    const rows = JSON.parse(raw.toString('utf8'));
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      await sb.upsertRows('nsc_cases', rows.slice(i, i + UPSERT_CHUNK), 'application_no', { silent: true });
    }
    idx += 1;
    job.part_index = idx;
    job.upserted = Number(job.upserted || 0) + rows.length;
  }

  if (idx >= partCount) {
    markJobDone(job);
    return job;
  }
  await saveJob(job);
  return job;
}

function markJobDone(job) {
  job.status = 'done';
  job.error = null;
  try {
    require('./nsc_snap_cache').invalidate();
  } catch {
    /* keep */
  }
  saveJob(job).catch((e) => console.warn('[nsc-import] done save:', e.message));
  setImmediate(() => {
    finalizeJob(job).catch((e) => console.warn('[nsc-import] finalize:', e.message));
  });
}

async function finalizeJob(job) {
  const rd = job.report_date;
  if (rd) {
    try {
      await sb.deleteAllMatching(
        'nsc_cases',
        `or=(report_date.is.null,report_date.neq.${rd})`
      );
    } catch (e) {
      console.warn('[nsc-import] stale delete:', e.message);
    }
  }
  try {
    const pending = [];
    await nscExportCsv({ queue: 'pending' }, { role: 'region' }, async (chunk) => {
      pending.push(chunk);
    });
    await sb.storagePutText(BUCKET, `exports/${rd || 'latest'}/pending.csv`, pending.join(''));
  } catch (e) {
    console.warn('[nsc-import] pending csv:', e.message);
  }
}

async function exportDownloadUrl(q, user) {
  const queue = String(q.queue || 'pending').toLowerCase() === 'withheld' ? 'withheld' : 'pending';
  const filtered = q.division || q.ccc || q.class || q.slab || q.q || q.pole || q.procedure || q.delay_min || q.delay_max;
  if (!filtered && queue === 'pending') {
    try {
      const latest = await sb.querySupabase('nsc_cases?select=report_date&order=report_date.desc.nullslast&limit=1');
      const rd = Array.isArray(latest) && latest[0]?.report_date;
      if (rd) {
        const url = await sb.storageSignedDownload(BUCKET, `exports/${rd}/pending.csv`, 180);
        return { url, filename: `nsc_pending_${rd}.csv` };
      }
    } catch {
      /* fall through to live export */
    }
  }
  return null;
}

module.exports = {
  createUpload,
  parseJob,
  tickJob,
  loadJob,
  exportDownloadUrl,
};
