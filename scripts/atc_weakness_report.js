/** One-off / reusable ATC weakness ranking from local atc_snapshots.json */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'server', 'data', 'atc_snapshots.json');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const ia = rows.filter((r) => String(r.source_format || 'IA').toUpperCase() === 'IA');

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const withMu = ia.filter((r) => n(r.input_mu) != null && n(r.input_mu) > 0);
const periods = [...new Set(withMu.map((r) => r.period_label))].sort((a, b) => {
  const sa = withMu.find((r) => r.period_label === a)?.period_sort || a;
  const sb = withMu.find((r) => r.period_label === b)?.period_sort || b;
  return String(sa).localeCompare(String(sb));
});

const latest = periods[periods.length - 1];
const prev = periods[periods.length - 2];

function enrich(r) {
  const input = n(r.input_mu);
  const demand = n(r.demand_mu);
  const coll = n(r.collection_mu);
  if (input == null || input <= 0) return null;
  const unbilled = demand == null ? null : input - demand;
  const outstanding = demand != null && coll != null ? demand - coll : null;
  const atcGap = coll == null ? null : input - coll;
  const tdPct = unbilled == null ? n(r.dist_loss) : (unbilled / input) * 100;
  const atcPct = atcGap == null ? n(r.atc_loss) : (atcGap / input) * 100;
  const collEff = demand && demand > 0 && coll != null ? (coll / demand) * 100 : n(r.coll_eff);
  return {
    office_code: String(r.office_code),
    office_name: String(r.office_name || r.office_code),
    office_type: r.office_type,
    division_code: r.division_code || (String(r.office_code).length >= 4 ? String(r.office_code).slice(0, 4) : ''),
    input,
    demand,
    coll,
    unbilled,
    outstanding,
    atcGap,
    tdPct,
    atcPct,
    collEff,
  };
}

function isDro(type, code) {
  if (type === 'ccc') return /^341[2-5]\d{3}$/.test(code);
  if (type === 'division') return /^341[2-5]$/.test(code);
  return true;
}

const prevMap = new Map(
  withMu
    .filter((r) => r.period_label === prev)
    .map((r) => {
      const e = enrich(r);
      return e ? [`${e.office_code}|${e.office_type}`, e] : null;
    })
    .filter(Boolean)
);

function list(type) {
  return withMu
    .filter((r) => r.period_label === latest && r.office_type === type)
    .map(enrich)
    .filter(Boolean)
    .filter((r) => isDro(type, r.office_code))
    .map((r) => {
      const p = prevMap.get(`${r.office_code}|${r.office_type}`);
      const dUnb = p && r.unbilled != null && p.unbilled != null ? r.unbilled - p.unbilled : null;
      const dOut = p && r.outstanding != null && p.outstanding != null ? r.outstanding - p.outstanding : null;
      const dCollEff = p && r.collEff != null && p.collEff != null ? r.collEff - p.collEff : null;
      const dAtc = p && r.atcPct != null && p.atcPct != null ? r.atcPct - p.atcPct : null;
      const dIn = p && r.input != null && p.input != null ? r.input - p.input : null;
      const dDem = p && r.demand != null && p.demand != null ? r.demand - p.demand : null;
      const dCol = p && r.coll != null && p.coll != null ? r.coll - p.coll : null;
      return { ...r, dUnb, dOut, dCollEff, dAtc, dIn, dDem, dCol };
    });
}

function score(r) {
  const u = Math.max(0, r.unbilled || 0);
  const o = Math.max(0, r.outstanding || 0);
  const g = Math.max(0, r.atcGap || 0);
  const du = Math.max(0, r.dUnb || 0);
  const dce = Math.max(0, -(r.dCollEff || 0));
  return u * 0.45 + o * 0.35 + g * 0.1 + du * 0.8 + dce * 0.6;
}

function top(arr, key, lim = 8, desc = true) {
  return [...arr]
    .filter((r) => r[key] != null)
    .sort((a, b) => (desc ? (b[key] || 0) - (a[key] || 0) : (a[key] || 0) - (b[key] || 0)))
    .slice(0, lim);
}

const out = { latest, prev, division: {}, ccc: {} };
for (const type of ['division', 'ccc']) {
  const arr = list(type);
  out[type] = {
    n: arr.length,
    byUnbilled: top(arr, 'unbilled'),
    byOutstanding: top(arr, 'outstanding'),
    byAtcGap: top(arr, 'atcGap'),
    byAtcPct: top(arr, 'atcPct'),
    wideningUnbilled: top(arr, 'dUnb'),
    collEffDrop: top(arr, 'dCollEff', 8, false),
    composite: [...arr].sort((a, b) => score(b) - score(a)).slice(0, 10).map((r) => ({ ...r, focusScore: score(r) })),
  };
}

const outPath = path.join(__dirname, '..', 'tmp_weakness.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('wrote', outPath);
console.log('latest', latest, 'prev', prev);
console.log('division', out.division.n, 'ccc', out.ccc.n);
for (const type of ['division', 'ccc']) {
  console.log('\n==', type, 'COMPOSITE ==');
  for (const [i, r] of out[type].composite.entries()) {
    console.log(
      i + 1,
      r.office_code,
      r.office_name,
      'score',
      r.focusScore.toFixed(2),
      'unb',
      r.unbilled?.toFixed(2),
      'out',
      r.outstanding?.toFixed(2),
      'atc%',
      r.atcPct?.toFixed(2),
      'td%',
      r.tdPct?.toFixed(2)
    );
  }
}
