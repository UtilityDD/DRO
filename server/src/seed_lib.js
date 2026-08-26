const fs = require('fs');
const path = require('path');
const { writeCollectionSync } = require('./store');
const { fullPerms, makePerms } = require('./permissions');
const { hydrateNsc } = require('./nsc_parse');

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
        tech_works: { view: true, upload: false, edit: false },
        spot_billing: { view: true, upload: false, edit: false },
        bulk: { view: false, upload: false, edit: false },
        consumers: { view: true, upload: false, edit: false },
        atc: { view: true, upload: false, edit: false },
      }),
      last_login: null,
    },
  ];
}

/** DRO 33/11 kV substations (power.wb.gov.in), assigned to the four Darjeeling Region divisions. */
function sampleSubstations() {
  const now = new Date().toISOString();
  const divName = {
    '3412': 'Siliguri Town',
    '3413': 'Kurseong',
    '3414': 'Darjeeling',
    '3415': 'Siliguri Sub Urban',
  };
  const cccName = {
    '3412400': 'Milanpally',
    '3412401': 'NJP Gate Bazar',
    '3412501': 'Subhaspally',
    '3412502': 'Hakimpara',
    '3412503': 'Power House',
    '3412504': 'Pradhan Nagar',
    '3412505': 'Siliguri Town',
    '3413101': 'Sonada',
    '3413201': 'Mirik',
    '3413202': 'Kurseong',
    '3414101': 'Sukhiapokhri',
    '3414102': 'Takdah',
    '3414201': 'Bijanbari',
    '3414300': 'Darjeeling',
    '3415101': 'Naxalbari',
    '3415102': 'Phansidewa',
    '3415103': 'Kharibari',
    '3415200': 'Bagdogra',
    '3415201': 'Bidhannagar',
    '3415400': 'Matigara',
    '3415600': 'Shivmandir',
  };
  const rows = [
    ['Bijanbari', 6.3, 27.0500278, 88.2617778, '3414', '3414201', ''],
    ['Happy valley', 12.6, 27.05728, 88.18364, '3414', '3414300', ''],
    ['Lebong PH', 9.45, 26.8807778, 88.2785278, '3414', '3414300', 'Published coordinates sit south of Lebong; verify before GIS use.'],
    ['Lodhama', 6.3, 27.0519444, 88.2750833, '3414', '3414300', ''],
    ['New Ghoom', 12.6, 27.0071667, 88.2478889, '3414', '3414101', ''],
    ['Old Ghoom', 6.3, 27.0085556, 88.2553056, '3414', '3414101', ''],
    ['Singamari', 6.3, 27.0606, 88.2565, '3414', '3414300', ''],
    ['Pokhriabang', 6.3, 26.9404972, 88.187, '3413', '3413202', ''],
    ['Mirik', 6.3, 26.881811, 88.189083, '3413', '3413201', ''],
    ['Pankhabari', 12.3, 26.8756667, 88.2707222, '3413', '3413202', ''],
    ['Fazi', 1.5, 26.91199, 88.248976, '3413', '3413101', ''],
    ['Dabgram', 15.75, 26.66831, 88.42267, '3412', '3412401', ''],
    ['Deshbandhupara', 18.9, 26.69402, 88.43694, '3412', '3412502', ''],
    ['Housing Board', 12.6, 26.75321, 88.4457, '3412', '3412400', ''],
    ['Jhankar', 18.9, 26.71153, 88.41778, '3412', '3412501', ''],
    ['Rabindranagar', 28.9, 26.71818, 88.45552, '3412', '3412503', ''],
    ['Siliguri', 25.2, 26.73901, 88.43589, '3412', '3412505', ''],
    ['Ujanu', 23.9, 26.73292, 88.4043, '3412', '3412504', ''],
    ['Salbari', 15.75, 26.76789, 88.38127, '3415', '3415400', ''],
    ['Bidhannagar', 17.6, 26.4848, 88.23545, '3415', '3415201', 'Published coordinates sit far from Bidhannagar CCC; verify before GIS use.'],
    ['Ghospukur', 18.9, 26.56104, 88.26638, '3415', '3415102', ''],
    ['Khaparail', 18.9, 26.73278, 88.36258, '3415', '3415200', ''],
    ['Hatighisa', 12.6, 26.683473, 88.23351, '3415', '3415101', ''],
    ['Kharibari', 12.6, 26.62794, 88.17179, '3415', '3415103', ''],
    ['TCF PS I', 11.3, 26.62275, 88.3599444, '3415', '3415102', ''],
  ];
  return rows.map(([name, capacity_mva, latitude, longitude, division_code, ccc_code, remarks], i) => ({
    id: i + 1,
    name,
    voltage_kv: '33/11',
    capacity_mva,
    division_code,
    division_name: divName[division_code] || '',
    ccc_code,
    ccc_name: cccName[ccc_code] || '',
    district: 'Darjeeling',
    latitude,
    longitude,
    feeder_count: null,
    status: 'in_service',
    commissioned_on: '',
    remarks,
    source: 'WB Power Dept 33/11 kV substations (power.wb.gov.in)',
    created_at: now,
    updated_at: now,
  }));
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
  writeCollectionSync('tech_work_categories', require('./tech_works').defaultCategories());
  writeCollectionSync('tech_works', sampleTech(offices));
  writeCollectionSync('spot_billing', sampleSpot(offices));
  writeCollectionSync('atc_snapshots', sampleAtc(offices));
  writeCollectionSync('activity_logs', []);
  writeCollectionSync('field_notes', []);
  writeCollectionSync('substations', sampleSubstations());
  return { offices: offices.length, users: 4, cccs: offices.filter((o) => o.office_type === 'ccc').length };
}

function cccsOf(offices) {
  return offices.filter((o) => o.office_type === 'ccc');
}

function sampleNsc(offices) {
  const cccs = cccsOf(offices).slice(0, 8);
  const sap = ['working', 'working', 'accepted', 'withheld', 'working'];
    const report = '2026-08-22';
    return cccs.map((c, i) => {
    const sap_status = sap[i % sap.length];
    const status = sap_status === 'withheld' ? 'withheld' : 'pending';
    const collected = `2026-08-${String(10 + (i % 10)).padStart(2, '0')}`;
    const created = `2026-08-${String(1 + (i % 8)).padStart(2, '0')}`;
    const age = (i + 1) * 7;
    return hydrateNsc({
      id: i + 1,
      application_no: `NSC-341-${1000 + i}`,
      consumer_id: `30117${1000 + i}`,
      consumer_name: `Applicant ${i + 1}`,
      phone: `99327${90000 + i}`,
      ccc_code: c.code,
      ccc_name: c.name,
      division_code: c.division_code,
      region_code: '341',
      applied_on: created,
      created_on: created,
      quotation_issue_on: created,
      collected_on: collected,
      status,
      sap_status,
      stage: sap_status,
      delay_days: age,
      quotation_age_days: age,
      processing_days: 3 + i,
      load_kw: 1 + (i % 5),
      category: i % 2 ? 'Domestic' : 'Commercial',
      consumer_class: i % 2 ? 'Domestic' : 'Commercial',
      class_code: i % 2 ? 'D' : 'C',
      agency_name: i % 2 ? 'M/S Demo Agency' : 'WBSEDCL STAFF',
      wo_no: String(555000 + i),
      wo_issued: 'Y',
      withheld_on: sap_status === 'withheld' ? collected : null,
      withheld_reason: sap_status === 'withheld' ? 'Outstanding Dues Pending to be Cleared' : '',
      report_date: report,
      remarks: '',
      batch_id: null,
      updated_at: new Date().toISOString(),
    });
  });
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

function dayShift(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function atShift(days) {
  return `${dayShift(days)}T10:15:00.000Z`;
}

function officeByCode(offices, code) {
  return offices.find((o) => String(o.code) === String(code));
}

function sampleGrievances(offices) {
  const now = new Date().toISOString();
  const specs = [
    {
      ccc: '3412502',
      type: 'billing',
      name: 'Pranab Ghosh',
      cid: '34125021201',
      phone: '9832011456',
      lodged: -19,
      target: -12,
      users: ['hakim', 'stown'],
      note: 'Wrong meter reading billed for June. Consumer wants revised energy charge.',
      fu: [{ at: atShift(-5), by: 'hakim', remark: 'Site check done. Reading mismatch confirmed. Bill revision pending.' }],
    },
    {
      ccc: '3412503',
      type: 'supply',
      name: 'Rina Chettri',
      cid: '34125031844',
      phone: '9647802211',
      lodged: -10,
      target: -8,
      users: ['stown'],
      note: 'Repeated low voltage in evening peak at Ashrampara lane.',
    },
    {
      ccc: '3414300',
      type: 'legal',
      name: 'Tashi Lama',
      cid: '34143002109',
      phone: '7797340088',
      lodged: -45,
      target: -15,
      users: ['region'],
      note: 'Theft assessment disputed. Consumer seeking hearing before disconnection.',
      fu: [{ at: atShift(-20), by: 'region', remark: 'File sent to legal cell. Hearing date not yet fixed.' }],
    },
    {
      ccc: '3413202',
      type: 'metering',
      name: 'Anil Rai',
      cid: '34132021402',
      phone: '8906673310',
      lodged: -18,
      target: -3,
      users: ['region', 'stown'],
      note: 'Stuck meter. Average billing for three months. Replacement requested.',
      fu: [{ at: atShift(-1), by: 'region', remark: 'Meter issued. Fitting scheduled this week.' }],
    },
    {
      ccc: '3415400',
      type: 'technical',
      name: 'Sabita Sharma',
      cid: '34154001911',
      phone: '9434045577',
      lodged: -15,
      target: 0,
      users: ['region'],
      note: 'Service wire snapped after storm. Temporary tapping still in place.',
      fu: [{ at: atShift(-4), by: 'region', remark: 'Material indent raised. Span not yet replaced.' }],
    },
    {
      ccc: '3412400',
      type: 'billing',
      name: 'Deepak Agarwal',
      cid: '34124003308',
      phone: '9832456670',
      lodged: -6,
      target: 1,
      users: ['stown'],
      note: 'Late payment surcharge levied after online payment already credited.',
    },
    {
      ccc: '3415200',
      type: 'other',
      name: 'Maya Subba',
      cid: '',
      phone: '8670234412',
      lodged: -10,
      target: 0,
      users: ['region'],
      non: true,
      note: 'Street light dark near Bagdogra bazaar crossing. Public complaint, no consumer id.',
      fu: [{ at: atShift(-2), by: 'stown', remark: 'Informed CCC. Fitting team to attend tonight.' }],
    },
    {
      ccc: '3413101',
      type: 'supply',
      name: 'Dawa Sherpa',
      cid: '34131010822',
      phone: '7584051199',
      lodged: -1,
      target: 1,
      users: ['region'],
      note: 'No power since last night at Sonada bazar feeder tail.',
    },
    {
      ccc: '3412501',
      type: 'billing',
      name: 'Kavita Singh',
      cid: '34125015517',
      phone: '9002348815',
      lodged: -5,
      target: 2,
      users: ['hakim', 'region'],
      note: 'Name correction after succession. Bill still in deceased fathers name.',
      fu: [{ at: atShift(-1), by: 'hakim', remark: 'Documents received. Mutation entry in progress.' }],
    },
    {
      ccc: '3415101',
      type: 'technical',
      name: 'Faruk Ali',
      cid: '34151017630',
      phone: '9733042206',
      lodged: -16,
      target: -1,
      users: ['region'],
      note: 'Pole leaning towards house after rain. Consumer fears accident.',
      fu: [{ at: atShift(-10), by: 'region', remark: 'Inspected. Stay wire work pending vendor.' }],
    },
    {
      ccc: '3412504',
      type: 'metering',
      name: 'Nirmala Devi',
      cid: '34125040944',
      phone: '8509321174',
      lodged: -8,
      target: 7,
      users: ['stown'],
      note: 'Burnt meter after lightning. Temporary connection running unmetered.',
      fu: [{ at: atShift(-1), by: 'stown', remark: 'New meter allotted. Fitting tomorrow.' }],
    },
    {
      ccc: '3414102',
      type: 'billing',
      name: 'Bikash Tamang',
      cid: '34141022755',
      phone: '8145572033',
      lodged: -14,
      target: -7,
      users: ['region'],
      note: 'High bill after meter change. Consumer alleges jump in unit.',
      priority: 'high',
    },
  ];

  return specs.map((spec, i) => {
    const office = officeByCode(offices, spec.ccc) || cccsOf(offices)[0];
    const year = dayShift(spec.lodged).slice(0, 4);
    const complaint_id = `CG/${year}/${String(i + 1).padStart(4, '0')}`;
    const followups = spec.fu || [];
    return {
      id: i + 1,
      complaint_id,
      docket_no: complaint_id,
      complainant_type: spec.non ? 'non_consumer' : 'consumer',
      consumer_id: spec.non ? '' : spec.cid,
      consumer_name: spec.name,
      complainant_phone: spec.phone || '',
      ccc_code: office?.code || spec.ccc,
      office_code: office?.code || spec.ccc,
      office_type: 'ccc',
      office_name: office?.name || spec.ccc,
      division_code: office?.division_code || String(spec.ccc).slice(0, 4),
      region_code: '341',
      category: spec.type,
      lodged_on: dayShift(spec.lodged),
      target_resolve_on: dayShift(spec.target),
      status: 'open',
      aging_days: Math.max(0, -spec.lodged),
      priority: spec.priority || 'normal',
      remarks: spec.note,
      followups,
      followup_users: spec.users,
      assigned_username: spec.users[0],
      created_by: 'admin',
      last_followup_on: followups[0]?.at || null,
      last_followup_by: followups[0]?.by || null,
      batch_id: null,
      created_at: now,
      updated_at: now,
    };
  });
}

function sampleTech(offices) {
  return require('./tech_works').sampleWorks(offices);
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
  sampleGrievances,
  sampleSubstations,
  seedAll,
};
