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

async function tickJob(jobId) {
  const job = await loadJob(jobId);
  if (!job) throw new Error('Import job missing');
  if (job.status === 'done') return job;
  if (job.status !== 'parsed' && job.status !== 'upserting') {
    throw new Error(`Import is ${job.status}`);
  }
  job.status = 'upserting';
  const idx = Number(job.part_index) || 0;
  if (idx >= Number(job.part_count) || !job.part_count) {
    await finalizeJob(job);
    return job;
  }
  const raw = await sb.storageDownload(BUCKET, jobPath(job.id, `part-${idx}.json`));
  const rows = JSON.parse(raw.toString('utf8'));
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await sb.upsertRows('nsc_cases', rows.slice(i, i + UPSERT_CHUNK), 'application_no', { silent: true });
  }
  job.part_index = idx + 1;
  job.upserted = Number(job.upserted || 0) + rows.length;
  if (job.part_index >= job.part_count) {
    await finalizeJob(job);
  } else {
    await saveJob(job);
  }
  return job;
}

async function finalizeJob(job) {
  const rd = job.report_date;
  if (rd) {
      try {
      await sb.deleteByFilter('nsc_cases', `report_date=neq.${rd}`);
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
  job.status = 'done';
  job.error = null;
  await saveJob(job);
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
