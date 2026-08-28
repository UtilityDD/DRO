/**
 * Smart ATC snapshot merge.
 * Achievement months (the workbook's UPTO month) always win.
 * YoY / March header columns never wipe a stored achievement row.
 */

function atcRowKey(r) {
  const fmt = String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
  return `${r.period_label}|${fmt}|${r.office_code}`;
}

function pointSource(r) {
  return String(r.point_source || '').toLowerCase() === 'achievement' ? 'achievement' : 'header_month';
}

function fileQualityScore(filename) {
  const n = String(filename || '').toUpperCase();
  let s = 20;
  if (/_FINAL/.test(n) || /(^|[^A-Z])FINAL([^A-Z]|$)/.test(n)) s += 50;
  if (/_REVISED/.test(n) || /REVISED/.test(n) || /_COMP/.test(n)) s += 40;
  if (/_RAW/.test(n) || /(^|[^A-Z])RAW([^A-Z]|$)/.test(n)) s -= 20;
  if (/\(\d+\)/.test(n)) s -= 25;
  return s;
}

function isDedicatedIbFilename(filename) {
  const n = String(filename || '').toUpperCase();
  if (/CCC/.test(n) && /WISE/.test(n)) return false;
  return /1\.1\s*B/.test(n) || /FORMAT[\s-]*I\s*B/.test(n) || /DIVISIONWISE/.test(n) || /DIVISION WISE/.test(n);
}

function isDedicatedIaFilename(filename) {
  const n = String(filename || '').toUpperCase();
  return /1\.1\s*A/.test(n) || /CCCWISE/.test(n) || /CCC WISE/.test(n) || /FORMAT[\s-]*IA/.test(n);
}

function betterOrigin(a, b) {
  const qa = fileQualityScore(a._filename);
  const qb = fileQualityScore(b._filename);
  if (qa !== qb) return qa > qb;
  return (Number(a._mtime) || 0) >= (Number(b._mtime) || 0);
}

const FILL_KEYS = [
  'atc_loss',
  'dist_loss',
  'coll_eff',
  'target_atc',
  'target_dist',
  'input_mu',
  'demand_mu',
  'collection_mu',
  'consumer_count',
  'atc_mar',
  'dist_mar',
  'atc_yoy',
  'dist_yoy',
  'coll_eff_mar',
  'coll_eff_yoy',
];

function fillNulls(target, src) {
  let changed = false;
  for (const k of FILL_KEYS) {
    if ((target[k] == null || target[k] === '') && src[k] != null && src[k] !== '') {
      target[k] = src[k];
      changed = true;
    }
  }
  return changed;
}

function uniqueSkips(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const k = `${s.filename}|${s.period}|${s.format}|${s.reason}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * Collapse many parsed files into one incoming set (duplicate months, embedded IB).
 * Rows may carry _filename, _mtime, _embedded.
 */
function collapseIncoming(taggedRows) {
  const skipped = [];
  const dedicatedIbPeriods = new Set();
  for (const r of taggedRows) {
    if (String(r.source_format || 'IA').toUpperCase() !== 'IB') continue;
    if (pointSource(r) !== 'achievement') continue;
    if (r._embedded) continue;
    if (isDedicatedIbFilename(r._filename)) dedicatedIbPeriods.add(String(r.period_label || ''));
  }

  const kept = [];
  for (const r of taggedRows) {
    const fmt = String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
    if (fmt === 'IB' && r._embedded && dedicatedIbPeriods.has(String(r.period_label || ''))) {
      skipped.push({
        filename: r._filename || '',
        period: String(r.period_label || ''),
        format: 'IB',
        reason: 'embedded',
      });
      continue;
    }
    kept.push(r);
  }

  const achByKey = new Map();
  for (const r of kept) {
    if (pointSource(r) !== 'achievement') continue;
    const k = atcRowKey(r);
    const prev = achByKey.get(k);
    if (!prev || betterOrigin(r, prev)) achByKey.set(k, r);
  }
  for (const r of kept) {
    if (pointSource(r) !== 'achievement') continue;
    const winner = achByKey.get(atcRowKey(r));
    if (winner && (winner._filename || '') !== (r._filename || '')) {
      skipped.push({
        filename: r._filename || '',
        period: String(r.period_label || ''),
        format: String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA',
        reason: 'duplicate',
      });
    }
  }

  const out = [...achByKey.values()].map((r) => ({ ...r }));
  const headerByKey = new Map();
  for (const r of kept) {
    if (pointSource(r) === 'achievement') continue;
    const k = atcRowKey(r);
    if (achByKey.has(k)) continue;
    const prev = headerByKey.get(k);
    if (!prev) headerByKey.set(k, { ...r });
    else fillNulls(headerByKey.get(k), r);
  }
  out.push(...headerByKey.values());
  return { rows: out, skipped: uniqueSkips(skipped) };
}

/**
 * Drop incoming header_month rows that would lose to a stored achievement.
 * Achievement rows always proceed.
 */
function filterAgainstStored(incoming, existing) {
  const stored = new Map((existing || []).map((r) => [atcRowKey(r), r]));
  const kept = [];
  let skippedHeader = 0;
  for (const r of incoming) {
    if (pointSource(r) === 'achievement') {
      kept.push(r);
      continue;
    }
    const prev = stored.get(atcRowKey(r));
    if (prev && pointSource(prev) === 'achievement') {
      skippedHeader += 1;
      continue;
    }
    kept.push(r);
  }
  return { rows: kept, skippedHeader };
}

/**
 * Apply incoming mapped rows onto the live collection.
 * Mutates `existing` in place. Returns stats.
 */
function mergeAtcSnapshots(existing, incoming, { nextId, now }) {
  const index = new Map(existing.map((r) => [atcRowKey(r), r]));
  let inserted = 0;
  let replaced = 0;
  let filled = 0;
  let skippedHeader = 0;

  const ach = incoming.filter((r) => pointSource(r) === 'achievement');
  const hdr = incoming.filter((r) => pointSource(r) !== 'achievement');

  for (const mapped of [...ach, ...hdr]) {
    const key = atcRowKey(mapped);
    const prev = index.get(key);
    const src = pointSource(mapped);
    if (!prev) {
      mapped.id = nextId(existing);
      mapped.created_at = mapped.created_at || now;
      mapped.updated_at = now;
      existing.push(mapped);
      index.set(key, mapped);
      inserted += 1;
      continue;
    }
    const prevSrc = pointSource(prev);
    if (src === 'header_month' && prevSrc === 'achievement') {
      skippedHeader += 1;
      continue;
    }
    if (src === 'header_month' && prevSrc !== 'achievement') {
      const changed = fillNulls(prev, mapped);
      prev.updated_at = now;
      if (mapped.batch_id != null) prev.batch_id = mapped.batch_id;
      if (changed) filled += 1;
      continue;
    }
    const id = prev.id;
    const created = prev.created_at || mapped.created_at || now;
    const keepMu = {};
    for (const k of ['input_mu', 'demand_mu', 'collection_mu', 'consumer_count']) {
      if ((mapped[k] == null || mapped[k] === '') && prev[k] != null && prev[k] !== '') {
        keepMu[k] = prev[k];
      }
    }
    Object.assign(prev, mapped, keepMu, {
      id,
      created_at: created,
      updated_at: now,
      point_source: 'achievement',
    });
    replaced += 1;
  }

  return {
    upserted: inserted + replaced + filled,
    inserted,
    replaced,
    filled,
    skippedHeader,
  };
}

function stripOrigin(row) {
  const out = { ...row };
  delete out._filename;
  delete out._mtime;
  delete out._embedded;
  return out;
}

module.exports = {
  atcRowKey,
  pointSource,
  fileQualityScore,
  isDedicatedIbFilename,
  isDedicatedIaFilename,
  collapseIncoming,
  filterAgainstStored,
  mergeAtcSnapshots,
  stripOrigin,
  FILL_KEYS,
};
