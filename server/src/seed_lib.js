const fs = require('fs');
const path = require('path');
const { writeCollectionSync } = require('./store');
const { fullPerms, makePerms } = require('./permissions');

const MAP_PATH = path.join(__dirname, '..', '..', 'data', 'office_map.json');

function loadOfficeMap() {
  return JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
}

function buildOfficesFromMap(map) {
  const offices = [
    {
      id: 1,
      office_type: 'zone',
      code: String(map.zone.code),
      name: map.zone.name,
      parent_code: null,
      region_code: null,
      division_code: null,
      consumer_count: 0,
      is_active: true,
    },
    {
      id: 2,
      office_type: 'region',
      code: String(map.region.code),
      name: map.region.name,
      parent_code: String(map.zone.code),
      region_code: String(map.region.code),
      division_code: null,
      consumer_count: 0,
      is_active: true,
    },
  ];

  let id = 3;
  let regionTotal = 0;

  for (const div of map.divisions) {
    const divTotal = (div.cccs || []).reduce((s, c) => s + (Number(c.consumers) || 0), 0);
    regionTotal += divTotal;
    offices.push({
      id: id++,
      office_type: 'division',
      code: String(div.code),
      name: div.name,
      parent_code: String(map.region.code),
      region_code: String(map.region.code),
      division_code: String(div.code),
      consumer_count: divTotal,
      is_active: true,
    });
    for (const c of div.cccs || []) {
      offices.push({
        id: id++,
        office_type: 'ccc',
        code: String(c.code),
        name: c.name,
        parent_code: String(div.code),
        region_code: String(map.region.code),
        division_code: String(div.code),
        consumer_count: Number(c.consumers) || 0,
        is_active: true,
      });
    }
  }

  const region = offices.find((o) => o.code === String(map.region.code));
  if (region) region.consumer_count = regionTotal;
  return offices;
}

/** @deprecated ATC-sheet shaped map — prefer office_map.json */
function buildOfficesFromSeed(seedMap) {
  const DIV_META = {
    'SILIGURI  TOWN': { code: '3412', name: 'Siliguri Town' },
    'SILIGURI SUBARBAN': { code: '3415', name: 'Siliguri Sub Urban' },
    KURSEONG: { code: '3413', name: 'Kurseong' },
    DARJEELING: { code: '3414', name: 'Darjeeling' },
  };
  const map = {
    zone: { code: '34', name: 'Siliguri Zone' },
    region: { code: '341', name: 'Darjeeling Region' },
    divisions: Object.entries(seedMap).map(([raw, cccs]) => {
      const meta = DIV_META[raw] || { code: String(cccs[0]?.code || '').slice(0, 4), name: raw.trim() };
      return {
        code: meta.code,
        name: meta.name,
        cccs: cccs.map((c) => ({ code: String(c.code), name: c.ccc, consumers: c.consumers || 0 })),
      };
    }),
  };
  return buildOfficesFromMap(map);
}

function defaultUsers() {
  return [
    {
      id: 1,
      username: 'admin',
      pin: '1234',
      name: 'DRO Admin',
      role: 'admin',
      zone_code: '34',
      region_code: '341',
      division_code: '',
      ccc_code: '',
      permissions: fullPerms(),
      last_login: null,
    },
    {
      id: 2,
      username: 'region',
      pin: '3410',
      name: 'Region Officer',
      role: 'region',
      zone_code: '34',
      region_code: '341',
      division_code: '',
      ccc_code: '',
      permissions: makePerms({
        nsc: { view: true, upload: true, edit: true },
        disco: { view: true, upload: true, edit: true },
        grievance: { view: true, upload: false, edit: true },
        tech_works: { view: true, upload: false, edit: true },
        spot_billing: { view: true, upload: false, edit: false },
        bulk: { view: true, upload: true, edit: true },
        consumers: { view: true, upload: true, edit: false },
        atc: { view: true, upload: true, edit: false },
      }),
      last_login: null,
    },
    {
      id: 3,
      username: 'stown',
      pin: '3412',
      name: 'Siliguri Town Division',
      role: 'division',
      zone_code: '34',
      region_code: '341',
      division_code: '3412',
      ccc_code: '',
      permissions: makePerms({
        nsc: { view: true, upload: true, edit: true },
        disco: { view: true, upload: true, edit: true },
        grievance: { view: true, upload: true, edit: true },
        tech_works: { view: true, upload: false, edit: true },
        spot_billing: { view: true, upload: true, edit: false },
        bulk: { view: false, upload: false, edit: false },
        consumers: { view: true, upload: false, edit: false },
        atc: { view: true, upload: false, edit: false },
      }),
      last_login: null,
    },
    {
      id: 4,
      username: 'hakim',
      pin: '2502',
      name: 'Hakimpara CCC',
      role: 'ccc',
      zone_code: '34',
      region_code: '341',
      division_code: '3412',
      ccc_code: '3412502',
      permissions: makePerms({
        nsc: { view: true, upload: false, edit: false },
        disco: { view: true, upload: false, edit: true },
        grievance: { view: true, upload: true, edit: true },
        tech_works: { view: false, upload: false, edit: false },
        spot_billing: { view: true, upload: false, edit: false },
        bulk: { view: false, upload: false, edit: false },
        consumers: { view: true, upload: false, edit: false },
        atc: { view: true, upload: false, edit: false },
      }),
      last_login: null,
    },
  ];
}

function seedAll(seedMapOrNull) {
  const map = seedMapOrNull && !seedMapOrNull.divisions ? null : seedMapOrNull;
  const offices = map?.divisions
    ? buildOfficesFromMap(map)
    : fs.existsSync(MAP_PATH)
      ? buildOfficesFromMap(loadOfficeMap())
      : buildOfficesFromSeed(seedMapOrNull || {});

  writeCollectionSync('offices', offices);
  writeCollectionSync('portal_users', defaultUsers());
  writeCollectionSync('upload_batches', []);
  writeCollectionSync('consumer_master', []);
  writeCollectionSync('bulk_consumers', []);
  writeCollectionSync('nsc_cases', sampleNsc(offices));
  writeCollectionSync('disconnections', sampleDisco(offices));
  writeCollectionSync('grievances', sampleGrievances(offices));
  writeCollectionSync('tech_works', sampleTech(offices));
  writeCollectionSync('spot_billing', sampleSpot(offices));
  writeCollectionSync('atc_snapshots', sampleAtc(offices));
  writeCollectionSync('activity_logs', []);
  return { offices: offices.length, users: 4, cccs: offices.filter((o) => o.office_type === 'ccc').length };
}

function cccsOf(offices) {
  return offices.filter((o) => o.office_type === 'ccc');
}

function sampleNsc(offices) {
  const cccs = cccsOf(offices).slice(0, 8);
  const statuses = ['pending', 'pending', 'in_progress', 'completed', 'pending'];
  return cccs.map((c, i) => ({
    id: i + 1,
    application_no: `NSC-341-${1000 + i}`,
    consumer_name: `Applicant ${i + 1}`,
    ccc_code: c.code,
    division_code: c.division_code,
    region_code: '341',
    applied_on: '2026-06-01',
    status: statuses[i % statuses.length],
    stage: i % 2 ? 'Estimate' : 'Quotation',
    delay_days: (i + 1) * 7,
    load_kw: 1 + (i % 5),
    category: i % 2 ? 'Domestic' : 'Commercial',
    remarks: '',
    batch_id: null,
    updated_at: new Date().toISOString(),
  }));
}

function sampleDisco(offices) {
  const cccs = cccsOf(offices).slice(0, 6);
  return cccs.map((c, i) => ({
    id: i + 1,
    consumer_id: `C341${10000 + i}`,
    consumer_name: `Defaulter ${i + 1}`,
    ccc_code: c.code,
    division_code: c.division_code,
    region_code: '341',
    disco_date: '2026-07-15',
    amount_due: 2500 + i * 800,
    status: i % 3 === 0 ? 'reconnected' : 'pending',
    reconnect_date: i % 3 === 0 ? '2026-08-01' : null,
    remarks: 'Revenue drive',
    batch_id: null,
    updated_at: new Date().toISOString(),
  }));
}

function sampleGrievances(offices) {
  const cccs = cccsOf(offices).slice(0, 5);
  return cccs.map((c, i) => ({
    id: i + 1,
    docket_no: `DKT-341-${2000 + i}`,
    consumer_id: `C341${20000 + i}`,
    consumer_name: `Complainant ${i + 1}`,
    ccc_code: c.code,
    division_code: c.division_code,
    region_code: '341',
    category: ['Billing', 'No Power', 'Meter', 'Voltage', 'Other'][i % 5],
    lodged_on: '2026-07-20',
    status: i % 2 ? 'open' : 'closed',
    aging_days: 3 + i * 4,
    priority: i === 0 ? 'high' : 'normal',
    remarks: '',
    batch_id: null,
    updated_at: new Date().toISOString(),
  }));
}

function sampleTech(offices) {
  const divs = offices.filter((o) => o.office_type === 'division');
  return divs.map((d, i) => ({
    id: i + 1,
    work_id: `TW-341-${300 + i}`,
    title: `Priority feeder work ${i + 1}`,
    ccc_code: '',
    division_code: d.code,
    region_code: '341',
    priority: i === 0 ? 'high' : 'medium',
    status: i % 2 ? 'open' : 'in_progress',
    vendor_name: ['ABC Infra', 'Hill Power', 'Siliguri Elec', 'North Tech'][i % 4],
    billing_status: i % 2 ? 'pending' : 'submitted',
    target_date: '2026-09-30',
    completed_on: null,
    remarks: '',
    batch_id: null,
    updated_at: new Date().toISOString(),
  }));
}

function sampleSpot(offices) {
  const cccs = cccsOf(offices);
  return cccs.map((c, i) => {
    const target = Math.round((c.consumer_count || 1000) * 0.08);
    const billed = Math.round(target * (0.7 + (i % 5) * 0.05));
    return {
      id: i + 1,
      period_label: "Aug'26",
      ccc_code: c.code,
      division_code: c.division_code,
      region_code: '341',
      consumer_class: 'Domestic',
      target_count: target,
      billed_count: billed,
      unbilled_count: Math.max(0, target - billed),
      batch_id: null,
      updated_at: new Date().toISOString(),
    };
  });
}

function sampleAtc(offices) {
  // Prefer real Format-IA/IB workbook when available (re-import overwrites by key).
  const imported = tryLoadAtcWorkbook();
  if (imported?.length) return imported;
  const cccs = cccsOf(offices);
  return cccs.map((c, i) => ({
    id: i + 1,
    period_label: "May'26",
    period_sort: '2026-05',
    target_fy: '2026-27',
    source_format: 'IA',
    basis_label: 'Format-IA (CCC path)',
    office_type: 'ccc',
    office_code: c.code,
    office_name: c.name,
    division_code: c.division_code,
    region_code: '341',
    ccc_code: c.code,
    consumer_count: c.consumer_count || 0,
    atc_loss: 0.04 + (i % 7) * 0.012,
    dist_loss: 0.035 + (i % 7) * 0.01,
    coll_eff: 0.97 + (i % 5) * 0.004,
    batch_id: null,
    created_at: new Date().toISOString(),
  }));
}

function tryLoadAtcWorkbook() {
  try {
    const fs = require('fs');
    const XLSX = require('xlsx');
    const { parseAtcWorkbook, periodSortKey } = require('./atc_parse');
    const candidates = [
      process.env.DRO_ATC_XLSX,
      String.raw`C:\Users\USER\Downloads\1.1A. CCCWISE ATC LOSS May'26_final_ (1).xlsx`,
    ].filter(Boolean);
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) return null;
    const wb = XLSX.readFile(file);
    const parsed = parseAtcWorkbook(wb, (sheet) =>
      XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })
    );
    const now = new Date().toISOString();
    return parsed.rows.map((r, i) => ({
      ...r,
      id: i + 1,
      period_sort: r.period_sort || periodSortKey(r.period_label),
      batch_id: null,
      created_at: now,
      updated_at: now,
    }));
  } catch (e) {
    console.warn('[seed] ATC workbook import skipped:', e.message);
    return null;
  }
}

module.exports = {
  loadOfficeMap,
  buildOfficesFromMap,
  buildOfficesFromSeed,
  defaultUsers,
  seedAll,
};
