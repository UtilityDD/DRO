/**
 * Pending NSC workbook parser.
 * Reads SAP pending-NSC dumps (Working / Accepted / Withheld), remaps foreign
 * Zone/Region/Division/CCC onto DRO's 21 CCCs when needed, and keeps essential columns.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');

const NSC_META = '\n||NSC||\n';

const SLABS = [
  { id: 'd0_3', label: '≤3d', min: 0, max: 3 },
  { id: 'd3_7', label: '3–7d', min: 4, max: 7 },
  { id: 'd7_15', label: '7–15d', min: 8, max: 15 },
  { id: 'd15_30', label: '15–30d', min: 16, max: 30 },
  { id: 'm1_3', label: '1–3m', min: 31, max: 90 },
  { id: 'm3_6', label: '3–6m', min: 91, max: 180 },
  { id: 'm6_12', label: '6–12m', min: 181, max: 365 },
  { id: 'y1', label: '>1y', min: 366, max: Infinity },
];

const CUMULATIVE = [
  { id: 'le3', label: '≤3d', op: 'le', days: 3 },
  { id: 'le7', label: '≤7d', op: 'le', days: 7 },
  { id: 'gt7', label: '>7d', op: 'gt', days: 7 },
  { id: 'gt15', label: '>15d', op: 'gt', days: 15 },
  { id: 'gt30', label: '>30d', op: 'gt', days: 30 },
  { id: 'gt90', label: '>90d', op: 'gt', days: 90 },
  { id: 'gt180', label: '>6m', op: 'gt', days: 180 },
  { id: 'gt365', label: '>1y', op: 'gt', days: 365 },
];

const CLASS_FROM_CODE = {
  A: 'Agriculture',
  C: 'Commercial',
  D: 'Domestic',
  I: 'Industrial',
  W: 'PHE',
  H: 'ST Light',
  H2: 'ST Light',
};

const HEADER_ALIASES = {
  APPL_NO: 'application_no',
  APPLICATION_NO: 'application_no',
  APPLICATIONNO: 'application_no',
  CON_ID: 'consumer_id',
  CONSUMER_ID: 'consumer_id',
  CONSUMERID: 'consumer_id',
  NAME: 'consumer_name',
  CONSUMER_NAME: 'consumer_name',
  PHONE_NO: 'phone',
  PHONE: 'phone',
  MOBILE: 'phone',
  CONN_CLASS: 'class_code',
  CLASS: 'class_code',
  DESC: 'class_desc',
  CONSUMER_CLASS: 'class_desc',
  CCC_CODE: 'src_ccc_code',
  CCC: 'src_ccc_code',
  SUPP_OFF: 'src_ccc_name',
  CCC_NAME: 'src_ccc_name',
  DIVN_NAME: 'src_division',
  DIVISION: 'src_division',
  DIVISION_NAME: 'src_division',
  DIVISION_CODE: 'division_code',
  REG: 'src_region',
  REGION: 'src_region',
  SCN_STATUS: 'sap_status',
  STATUS: 'sap_status',
  CREATION_DATE: 'created_on',
  APPLIED_ON: 'created_on',
  QUOTATION_ISSUE_DATE: 'quotation_issue_on',
  QUOTATION_DATE: 'quotation_issue_on',
  COLL_DATE: 'collected_on',
  COLLECTION_DATE: 'collected_on',
  WON: 'wo_no',
  WO_NO: 'wo_no',
  WO_NUMBER: 'wo_no',
  WO_ISSUED: 'wo_issued',
  AGENCY_NAME: 'agency_name',
  AGENCY: 'agency_name',
  SCN_WITHELD_DATE: 'withheld_on',
  SCN_WITHHELD_DATE: 'withheld_on',
  WITHELD_DATE: 'withheld_on',
  WITHHELD_DATE: 'withheld_on',
  SCN_WITHELD_REASON: 'withheld_reason',
  SCN_WITHHELD_REASON: 'withheld_reason',
  WITHELD_REASON: 'withheld_reason',
  WITHHELD_REASON: 'withheld_reason',
  LOAD_WATTS: 'load_watts',
  LOAD_KW: 'load_kw',
  APPLIED_PHASE: 'applied_phase',
  PHASE: 'applied_phase',
  CONN_PHASE: 'applied_phase',
  NO_OF_POLES: 'no_of_poles',
  NO_OF_POLE: 'no_of_poles',
  N_POLE: 'no_of_poles',
  POLES: 'no_of_poles',
  POLE: 'no_of_poles',
  APPLICANT_TYPE: 'applicant_type',
  APPLICANTTYPE: 'applicant_type',
  COMPLEX_NAME: 'complex_name',
  COMPLEX_ID: 'complex_id',
};

function normHeader(h) {
  return String(h || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(list, seed) {
  const rng = mulberry32(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function excelSerialToIso(v) {
  if (v == null || v === '' || v === '(null)' || v === 'null') return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    const utc = Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const d0 = Number(m[1]);
    const mo0 = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const day = mo0 > 12 && d0 <= 12 ? mo0 : d0;
    const mo = mo0 > 12 && d0 <= 12 ? d0 : mo0;
    const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (Number.isFinite(new Date(`${iso}T00:00:00Z`).getTime())) return iso;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) return excelSerialToIso(n);
  return null;
}

function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function slabFor(days) {
  if (days == null || !Number.isFinite(days) || days < 0) {
    return { id: 'unknown', label: 'Unknown' };
  }
  for (const s of SLABS) {
    if (days >= s.min && days <= s.max) return { id: s.id, label: s.label };
  }
  return { id: 'y1', label: '>1y' };
}

function cleanId(v) {
  if (v == null || v === '' || v === '(null)') return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (Math.abs(v) >= 1e11) return String(Math.round(v));
    return String(Math.round(v));
  }
  let s = String(v).trim();
  if (/e\+/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s;
}

function cleanPhone(v) {
  let d = cleanId(v).replace(/\D/g, '');
  if (d.startsWith('91') && d.length > 10) d = d.slice(-10);
  return d.slice(0, 15);
}

function mapAppliedPhase(raw) {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  if (s === 'III' || s === '3' || s === '03' || s === '3PH' || s === '3PHASE' || s === 'THREE' || s === 'THREEPHASE') {
    return '3';
  }
  if (s === 'II' || s === '2' || s === '02' || s === '2PH' || s === '2PHASE') return '2';
  if (s === 'I' || s === '1' || s === '01' || s === '1PH' || s === '1PHASE' || s === 'SINGLE' || s === 'SINGLEPHASE') {
    return '1';
  }
  return '';
}

function phaseOf(row) {
  return mapAppliedPhase(row?.applied_phase || row?.phase);
}

function mapClass(desc, code) {
  const d = String(desc || '').trim().toUpperCase();
  if (d.includes('DOMEST')) return 'Domestic';
  if (d.includes('COMMER')) return 'Commercial';
  if (d.includes('AGRI') || d === 'STW') return 'Agriculture';
  if (d.includes('INDUS')) return 'Industrial';
  if (d.includes('PHE')) return 'PHE';
  if (d.includes('ST LIGHT') || d.includes('ST. LIGHT') || d.includes('STREET')) return 'ST Light';
  const fromCode = CLASS_FROM_CODE[String(code || '').trim().toUpperCase()];
  if (fromCode) return fromCode;
  if (d && d !== 'OTHERS' && d !== 'OTHER' && d !== '(NULL)') return String(desc).trim();
  return 'Others';
}

function mapSapStatus(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s.includes('witheld') || s.includes('withheld') || s.includes('hold')) return 'withheld';
  if (s.includes('accept')) return 'accepted';
  if (s.includes('work') || s.includes('progress')) return 'working';
  if (s === 'pending') return 'working';
  if (s === 'completed' || s === 'done' || s === 'closed') return 'completed';
  return s || 'working';
}

function queueOf(sapStatus) {
  if (sapStatus === 'withheld') return 'withheld';
  if (sapStatus === 'completed') return 'completed';
  return 'pending';
}

function parsePoleCount(v) {
  if (v == null || v === '' || v === '(null)') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function poleCountOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.pole_count != null && row.pole_count !== '') return parsePoleCount(row.pole_count);
  if (row.no_of_poles != null && row.no_of_poles !== '') return parsePoleCount(row.no_of_poles);
  return null;
}

function poleKindOf(row) {
  const n = poleCountOf(row);
  if (n == null) return 'unknown';
  return n > 0 ? 'pole' : 'non_pole';
}

function mapProcedure(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '(null)' || s.toLowerCase() === 'null') {
    return { applicant_type: '', procedure: 'unknown', procedure_label: '—' };
  }
  const u = s.toUpperCase().replace(/\s+/g, ' ');
  if (/PROMOTER|DEVELOPER|HOUSING|COMPLEX/.test(u)) {
    return { applicant_type: s, procedure: 'proc_b', procedure_label: 'Proc. B' };
  }
  return { applicant_type: s, procedure: 'proc_a', procedure_label: 'Individual' };
}

function procedureOf(row) {
  if (!row || typeof row !== 'object') return 'unknown';
  if (row.procedure === 'proc_a' || row.procedure === 'proc_b' || row.procedure === 'unknown') return row.procedure;
  return mapProcedure(row.applicant_type).procedure;
}

const POLE_BINS = [
  { id: 'p0', label: 'Non-pole', min: 0, max: 0 },
  { id: 'p1_2', label: '1–2', min: 1, max: 2 },
  { id: 'p3_5', label: '3–5', min: 3, max: 5 },
  { id: 'p6_10', label: '6–10', min: 6, max: 10 },
  { id: 'p11', label: '>10', min: 11, max: Infinity },
];

function poleBinOf(count) {
  const n = Number(count) || 0;
  return POLE_BINS.find((b) => n >= b.min && n <= b.max) || POLE_BINS[0];
}

function isBlankReason(v) {
  const s = String(v || '').trim();
  if (!s || s === '(null)' || s === 'null') return true;
  const u = s.toUpperCase();
  return u === 'N' || u === 'Y' || u === 'NO' || u === 'YES' || u === 'NA';
}

function findHeaderRow(aoa) {
  const max = Math.min(aoa.length, 12);
  let best = { row: 0, hits: 0 };
  for (let r = 0; r < max; r += 1) {
    const cells = (aoa[r] || []).map((c) => normHeader(c));
    let hits = 0;
    for (const c of cells) {
      if (HEADER_ALIASES[c]) hits += 1;
    }
    if (hits > best.hits) best = { row: r, hits };
  }
  return best.hits >= 3 ? best.row : 0;
}

function pickDataSheet(wb) {
  const names = wb.SheetNames || [];
  const scored = names.map((name) => {
    const n = String(name).toUpperCase();
    let score = 0;
    if (n.includes('PNSC') || n.includes('PENDING') || n.includes('NSC')) score += 10;
    if (n.includes('SUMMARY') || n === 'SHEET1' || n === 'SHEET2') score -= 5;
    const sheet = wb.Sheets[name];
    const ref = sheet && sheet['!ref'];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      score += Math.min(4, Math.floor((range.e.c + 1) / 10));
    }
    return { name, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.name || names[0];
}

function convertViaExcelCsv(srcPath) {
  if (process.platform !== 'win32') return null;
  const dest = path.join(os.tmpdir(), `dro-nsc-${Date.now()}.csv`);
  const src = srcPath.replace(/'/g, "''");
  const out = dest.replace(/'/g, "''");
  const ps = `
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open('${src}', 0, $true)
$target = $null
foreach ($ws in $wb.Worksheets) {
  $n = [string]$ws.Name
  if ($n -match 'PNSC' -or $n -match 'PENDING' -or $n -match 'NSC') { $target = $ws; break }
}
if (-not $target) { $target = $wb.Worksheets.Item(1) }
$target.Activate()
$wb.SaveAs('${out}', 6)
$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
`;
  const r = spawnSync('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    timeout: 180000,
    windowsHide: true,
    encoding: 'utf8',
  });
  if (r.status !== 0 || !fs.existsSync(dest)) {
    throw new Error(`Excel could not convert this workbook${r.stderr ? `: ${String(r.stderr).slice(0, 240)}` : ''}`);
  }
  return dest;
}

function withExt(filePath, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!ext || path.extname(filePath).toLowerCase() === ext) return { path: filePath, extra: null };
  const dest = `${filePath}${ext}`;
  fs.copyFileSync(filePath, dest);
  return { path: dest, extra: dest };
}

function readWorkbookAoa(absPath) {
  const wb = XLSX.readFile(absPath, { raw: true, cellDates: false });
  const name = pickDataSheet(wb);
  const sheet = wb.Sheets[name];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
}

function readAoa(filePath, filename) {
  const { path: absPath, extra } = withExt(filePath, filename);
  try {
    return readWorkbookAoa(absPath);
  } catch (first) {
    const ext = path.extname(filename || absPath).toLowerCase();
    if (ext !== '.xlsb' && ext !== '.xls') throw first;
    let csvPath = null;
    try {
      csvPath = convertViaExcelCsv(absPath);
      const wb = XLSX.readFile(csvPath, { raw: false, cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    } catch (second) {
      throw new Error(first.message || second.message || 'Failed to read workbook');
    } finally {
      if (csvPath) {
        try {
          fs.unlinkSync(csvPath);
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    if (extra) {
      try {
        fs.unlinkSync(extra);
      } catch {
        /* ignore */
      }
    }
  }
}

function buildCccMap(sourceKeys, droCccs) {
  const shuffled = seededShuffle([...sourceKeys].sort(), 3412026);
  const map = new Map();
  shuffled.forEach((key, i) => {
    map.set(key, droCccs[i % droCccs.length]);
  });
  return map;
}

function parseNscWorkbook({ filePath, filename, reportDate, droCccs }) {
  if (!droCccs?.length) throw new Error('DRO CCC list is empty — seed offices first');
  const reportIso = excelSerialToIso(reportDate) || String(reportDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportIso)) {
    throw new Error('Report date must be YYYY-MM-DD');
  }

  const aoa = readAoa(filePath, filename);
  if (!aoa.length) throw new Error('Workbook is empty');
  const headerRow = findHeaderRow(aoa);
  const headers = (aoa[headerRow] || []).map((h, i) => {
    const key = HEADER_ALIASES[normHeader(h)];
    return key || `col_${i}`;
  });
  if (!headers.includes('application_no') && !headers.includes('consumer_id')) {
    throw new Error('Could not find Application No / Consumer ID columns. Use the SAP pending-NSC dump.');
  }

  const droByCode = new Map(droCccs.map((c) => [String(c.code), c]));
  const sourceRows = [];
  for (let r = headerRow + 1; r < aoa.length; r += 1) {
    const line = aoa[r] || [];
    const raw = {};
    headers.forEach((key, i) => {
      raw[key] = line[i];
    });
    const application_no = cleanId(raw.application_no);
    if (!application_no) continue;
    sourceRows.push(raw);
  }
  if (!sourceRows.length) throw new Error('No application rows found');

  const matched = sourceRows.filter((raw) => droByCode.has(cleanId(raw.src_ccc_code))).length;
  const remap = matched / sourceRows.length < 0.3;

  const sourceKeys = [
    ...new Set(
      sourceRows.map((raw) => cleanId(raw.src_ccc_code) || String(raw.src_ccc_name || '').trim()).filter(Boolean)
    ),
  ];
  const cccMap = remap ? buildCccMap(sourceKeys, droCccs) : null;

  const rows = [];
  let skipped = 0;
  for (const raw of sourceRows) {
    const application_no = cleanId(raw.application_no);
    const srcCode = cleanId(raw.src_ccc_code);
    const srcName = String(raw.src_ccc_name || '').trim();
    const srcKey = srcCode || srcName;
    let office = droByCode.get(srcCode);
    if (!office && remap && srcKey) office = cccMap.get(srcKey);
    if (!office) {
      skipped += 1;
      continue;
    }
    const sap_status = mapSapStatus(raw.sap_status);
    const status = queueOf(sap_status);
    const created_on = excelSerialToIso(raw.created_on);
    const quotation_issue_on = excelSerialToIso(raw.quotation_issue_on);
    const collected_on = excelSerialToIso(raw.collected_on);
    const withheld_on = excelSerialToIso(raw.withheld_on);
    const quotation_age_days = daysBetween(collected_on, reportIso);
    const processing_days = daysBetween(created_on, quotation_issue_on);
    const qSlab = slabFor(quotation_age_days);
    const pSlab = slabFor(processing_days);
    const consumer_class = mapClass(raw.class_desc, raw.class_code);
    const withheld_reason = isBlankReason(raw.withheld_reason) ? '' : String(raw.withheld_reason).trim();
    const loadWatts = Number(raw.load_watts);
    const loadKw = Number(raw.load_kw);
    const load_kw = Number.isFinite(loadKw) && loadKw > 0
      ? loadKw
      : Number.isFinite(loadWatts)
        ? Math.round((loadWatts / 1000) * 1000) / 1000
        : 0;
    const pole_count = parsePoleCount(raw.no_of_poles);
    const pole_kind = pole_count > 0 ? 'pole' : 'non_pole';
    const proc = mapProcedure(raw.applicant_type);
    const applied_phase = mapAppliedPhase(raw.applied_phase);

    rows.push({
      application_no,
      consumer_id: cleanId(raw.consumer_id),
      consumer_name: String(raw.consumer_name || '').trim().slice(0, 120),
      phone: cleanPhone(raw.phone),
      consumer_class,
      class_code: String(raw.class_code || '').trim().slice(0, 8),
      ccc_code: office.code,
      ccc_name: office.name,
      division_code: office.division_code,
      division_name: office.division_name,
      region_code: '341',
      status,
      sap_status,
      stage: sap_status,
      applied_on: created_on,
      created_on,
      quotation_issue_on,
      collected_on,
      wo_no: cleanId(raw.wo_no),
      wo_issued: String(raw.wo_issued || '').trim().slice(0, 4),
      agency_name: String(raw.agency_name || '').trim().slice(0, 120),
      withheld_on,
      withheld_reason: withheld_reason.slice(0, 240),
      load_kw,
      applied_phase,
      pole_count,
      pole_kind,
      applicant_type: proc.applicant_type,
      procedure: proc.procedure,
      procedure_label: proc.procedure_label,
      complex_name: String(raw.complex_name || '').trim().slice(0, 160),
      complex_id: cleanId(raw.complex_id),
      category: consumer_class,
      delay_days: quotation_age_days == null || quotation_age_days < 0 ? 0 : quotation_age_days,
      quotation_age_days,
      processing_days,
      quotation_age_slab: qSlab.id,
      quotation_age_label: qSlab.label,
      processing_slab: pSlab.id,
      processing_label: pSlab.label,
      report_date: reportIso,
      remarks: withheld_reason.slice(0, 240),
      updated_at: new Date().toISOString(),
      first_seen_on: new Date().toISOString(),
    });
  }

  const unique = [];
  const seen = new Map();
  for (const row of rows) {
    const prev = seen.get(row.application_no);
    if (prev == null) {
      seen.set(row.application_no, unique.length);
      unique.push(row);
    } else {
      unique[prev] = row;
      skipped += 1;
    }
  }

  const preview = buildPreview(unique, {
    filename: filename || path.basename(filePath),
    report_date: reportIso,
    remapped: remap,
    source_offices: sourceKeys.length,
    skipped,
  });
  return { rows: unique, preview };
}

function bump(map, key, n = 1) {
  const k = key || 'Unknown';
  map.set(k, (map.get(k) || 0) + n);
}

function mapToCounts(map) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function buildPreview(rows, meta) {
  const byStatus = new Map();
  const byQueue = new Map();
  const byDivision = new Map();
  const byClass = new Map();
  const byPhase = new Map();
  const byQSlab = new Map();
  const byPSlab = new Map();
  const byCcc = new Map();
  let three_phase = 0;
  for (const r of rows) {
    bump(byStatus, r.sap_status);
    bump(byQueue, r.status);
    bump(byDivision, r.division_name);
    bump(byClass, r.consumer_class);
    const ph = phaseOf(r);
    if (ph) bump(byPhase, `${ph}-ph`);
    if (ph === '3') three_phase += 1;
    bump(byQSlab, r.quotation_age_label);
    bump(byPSlab, r.processing_label);
    bump(byCcc, r.ccc_name);
  }
  return {
    ...meta,
    total: rows.length,
    three_phase,
    by_status: Object.fromEntries(byStatus),
    by_queue: Object.fromEntries(byQueue),
    by_division: mapToCounts(byDivision),
    by_class: mapToCounts(byClass),
    by_phase: mapToCounts(byPhase),
    by_quotation_slab: SLABS.map((s) => ({
      key: s.label,
      count: byQSlab.get(s.label) || 0,
    })),
    by_processing_slab: SLABS.map((s) => ({
      key: s.label,
      count: byPSlab.get(s.label) || 0,
    })),
    ccc_count: byCcc.size,
  };
}

function extraPayload(row) {
  return {
    consumer_id: row.consumer_id || '',
    phone: row.phone || '',
    consumer_class: row.consumer_class || row.category || '',
    class_code: row.class_code || '',
    sap_status: row.sap_status || row.stage || '',
    created_on: row.created_on || row.applied_on || null,
    quotation_issue_on: row.quotation_issue_on || null,
    collected_on: row.collected_on || null,
    wo_no: row.wo_no || '',
    wo_issued: row.wo_issued || '',
    agency_name: row.agency_name || '',
    withheld_on: row.withheld_on || null,
    withheld_reason: row.withheld_reason || '',
    report_date: row.report_date || null,
    quotation_age_days: row.quotation_age_days ?? row.delay_days ?? null,
    processing_days: row.processing_days ?? null,
    quotation_age_slab: row.quotation_age_slab || '',
    quotation_age_label: row.quotation_age_label || '',
    processing_slab: row.processing_slab || '',
    processing_label: row.processing_label || '',
    ccc_name: row.ccc_name || '',
    division_name: row.division_name || '',
    pole_count: poleCountOf(row) ?? 0,
    pole_kind: poleKindOf(row) === 'unknown' ? (Number(row.pole_count) > 0 ? 'pole' : 'non_pole') : poleKindOf(row),
    applicant_type: row.applicant_type || mapProcedure(row.applicant_type).applicant_type,
    procedure: procedureOf(row),
    procedure_label: row.procedure_label || mapProcedure(row.applicant_type).procedure_label,
    complex_name: row.complex_name || '',
    complex_id: row.complex_id || '',
    applied_phase: phaseOf(row),
  };
}

function packNscCloudRow(row) {
  const extra = extraPayload(row);
  const text = String(row.remarks || '').split(NSC_META)[0];
  return {
    application_no: row.application_no,
    consumer_name: row.consumer_name || '',
    ccc_code: row.ccc_code,
    division_code: row.division_code || '',
    region_code: row.region_code || '341',
    applied_on: row.applied_on || row.created_on || null,
    status: row.status || 'pending',
    stage: row.sap_status || row.stage || '',
    delay_days: Number(row.delay_days || row.quotation_age_days || 0) || 0,
    load_kw: Number(row.load_kw || 0) || 0,
    category: row.consumer_class || row.category || '',
    remarks: `${text}${NSC_META}${JSON.stringify(extra)}`,
    batch_id: row.batch_id ?? null,
    updated_at: row.updated_at || new Date().toISOString(),
    first_seen_on: row.first_seen_on || null,
    consumer_id: extra.consumer_id,
    phone: extra.phone,
    consumer_class: extra.consumer_class,
    class_code: extra.class_code,
    sap_status: extra.sap_status,
    quotation_issue_on: extra.quotation_issue_on,
    collected_on: extra.collected_on,
    wo_no: extra.wo_no,
    wo_issued: extra.wo_issued,
    agency_name: extra.agency_name,
    withheld_on: extra.withheld_on,
    withheld_reason: extra.withheld_reason,
    report_date: extra.report_date,
    quotation_age_days: extra.quotation_age_days,
    processing_days: extra.processing_days,
    quotation_age_slab: extra.quotation_age_slab,
    processing_slab: extra.processing_slab,
    pole_count: extra.pole_count ?? 0,
    applicant_type: extra.applicant_type || '',
    procedure: extra.procedure || 'proc_a',
    applied_phase: extra.applied_phase || null,
  };
}

function slimNscCloudRow(row) {
  const packed = packNscCloudRow(row);
  const keep = [
    'application_no',
    'consumer_name',
    'ccc_code',
    'division_code',
    'region_code',
    'applied_on',
    'status',
    'stage',
    'delay_days',
    'load_kw',
    'category',
    'remarks',
    'batch_id',
    'updated_at',
    'first_seen_on',
  ];
  const out = {};
  for (const k of keep) out[k] = packed[k] ?? null;
  return out;
}

/** Keep the original DRO arrival time when the same application is uploaded again. */
function mergeFirstSeen(incoming, existingByApp) {
  const now = new Date().toISOString();
  return (incoming || []).map((row) => {
    const app = String(row?.application_no || '').trim();
    const prev = app ? existingByApp.get(app) : null;
    const kept = prev || row.first_seen_on || null;
    return { ...row, first_seen_on: kept || now };
  });
}

function hydrateNscRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const first = rows[0];
  const packed = String(first.remarks || '').includes('||NSC||');
  if (packed || first.quotation_age_label == null) return rows.map(hydrateNsc);
  return rows;
}

function hydrateNsc(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  const raw = String(row.remarks || '');
  const i = raw.indexOf(NSC_META);
  if (i >= 0) {
    out.remarks = raw.slice(0, i);
    try {
      Object.assign(out, JSON.parse(raw.slice(i + NSC_META.length) || '{}'));
    } catch {
      /* keep */
    }
  }
  out.sap_status = out.sap_status || out.stage || (out.status === 'withheld' ? 'withheld' : 'working');
  const q = queueOf(out.sap_status);
  if (q === 'withheld' || String(out.status).toLowerCase() === 'withheld') out.status = 'withheld';
  else if (q === 'completed' || String(out.status).toLowerCase() === 'completed') out.status = 'completed';
  else out.status = 'pending';
  out.consumer_class = out.consumer_class || out.category || 'Others';
  out.quotation_age_days = out.quotation_age_days ?? out.delay_days ?? null;
  if (out.quotation_age_days != null && !out.quotation_age_label) {
    const s = slabFor(Number(out.quotation_age_days));
    out.quotation_age_slab = s.id;
    out.quotation_age_label = s.label;
  }
  if (out.processing_days != null && !out.processing_label) {
    const s = slabFor(Number(out.processing_days));
    out.processing_slab = s.id;
    out.processing_label = s.label;
  }
  if (out.pole_count == null && out.no_of_poles != null) out.pole_count = parsePoleCount(out.no_of_poles);
  if (out.pole_count == null || out.pole_count === '') {
    out.pole_count = null;
    out.pole_kind = 'unknown';
  } else {
    out.pole_count = parsePoleCount(out.pole_count);
    out.pole_kind = out.pole_count > 0 ? 'pole' : 'non_pole';
  }
  const proc = mapProcedure(out.applicant_type);
  out.applicant_type = out.applicant_type || proc.applicant_type;
  if (out.procedure !== 'proc_a' && out.procedure !== 'proc_b' && out.procedure !== 'unknown') {
    out.procedure = proc.procedure;
  }
  out.procedure_label = out.procedure_label || proc.procedure_label;
  out.complex_name = String(out.complex_name || '').trim();
  out.applied_phase = mapAppliedPhase(out.applied_phase || out.phase);
  return out;
}

function isPendingQueue(row) {
  const st = String(row.status || '').toLowerCase();
  const sap = String(row.sap_status || row.stage || '').toLowerCase();
  if (st === 'withheld' || sap === 'withheld') return false;
  if (st === 'completed' || sap === 'completed') return false;
  return true;
}

function eventOn(row) {
  return row.withheld_on || row.collected_on || row.created_on || row.quotation_issue_on || null;
}

function yearOfIso(iso) {
  if (!iso || String(iso).length < 4) return null;
  const y = Number(String(iso).slice(0, 4));
  if (!Number.isFinite(y) || y < 2000 || y > 2035) return null;
  return String(y);
}

function monthOfIso(iso) {
  if (!iso || String(iso).length < 7) return null;
  if (!yearOfIso(iso)) return null;
  return String(iso).slice(0, 7);
}

function slabIdOf(row, clock) {
  if (clock === 'processing') return row.processing_slab || 'unknown';
  return row.quotation_age_slab || 'unknown';
}

function daysOf(row, clock) {
  return clock === 'processing' ? row.processing_days : row.quotation_age_days;
}

function matchesCut(days, cut) {
  if (days == null || !Number.isFinite(Number(days)) || Number(days) < 0) return false;
  const d = Number(days);
  if (cut.op === 'le') return d <= cut.days;
  if (cut.op === 'ge') return d >= cut.days;
  if (cut.op === 'gt') return d > cut.days;
  if (cut.op === 'bt') {
    const max = cut.daysMax != null ? cut.daysMax : cut.days;
    return d >= cut.days && d <= max;
  }
  return false;
}

function parseExtraCuts(raw) {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const m = part.match(/^(le|gt|bt):(\d+)(?:-(\d+))?$/i);
    if (!m) continue;
    const op = m[1].toLowerCase();
    const a = Number(m[2]);
    const b = m[3] != null ? Number(m[3]) : NaN;
    if (!Number.isFinite(a) || a < 0 || a > 20000) continue;
    let days = a;
    let daysMax;
    let id;
    let label;
    if (op === 'bt') {
      if (!Number.isFinite(b) || b < 0 || b > 20000) continue;
      days = Math.min(a, b);
      daysMax = Math.max(a, b);
      if (days === daysMax) continue;
      id = `c_bt_${days}_${daysMax}`;
      label = `${days}–${daysMax}d`;
    } else if (op === 'le') {
      id = `c_le_${a}`;
      label = a === 180 ? '≤6m' : a === 365 ? '≤1y' : `≤${a}d`;
    } else {
      id = `c_gt_${a}`;
      label = a === 180 ? '>6m' : a === 365 ? '>1y' : `>${a}d`;
    }
    if (seen.has(id)) continue;
    if (CUMULATIVE.some((c) => c.op === op && c.days === a && op !== 'bt')) continue;
    seen.add(id);
    out.push({ id, label, op, days, daysMax });
  }
  return out;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function daysInRange(days, min, max) {
  if (days == null || !Number.isFinite(Number(days)) || Number(days) < 0) return false;
  const d = Number(days);
  if (min != null && d < min) return false;
  if (max != null && d > max) return false;
  return true;
}

function isAgriClass(row) {
  return isAgriName(row?.consumer_class || row?.category || '', row?.class_code);
}

function isAgriName(name, code) {
  const cls = String(name || '').trim().toLowerCase();
  const c = String(code || '').trim().toUpperCase();
  if (c === 'A') return true;
  return cls.includes('agri') || cls === 'stw';
}

function filterNscRows(rows, q = {}) {
  const queue = String(q.queue || '').toLowerCase();
  const division = String(q.division || '');
  const ccc = String(q.ccc || '');
  const klass = String(q.class || q.klass || '');
  const slab = String(q.slab || '');
  const clock = String(q.clock || 'quotation') === 'processing' ? 'processing' : 'quotation';
  const timeKey = String(q.time || '');
  const search = String(q.q || '').trim().toLowerCase();
  const applyTime = String(q.apply_time || '1') !== '0';
  const delayMin = numOrNull(q.delay_min);
  const delayMax = numOrNull(q.delay_max);
  const pole = String(q.pole || '').toLowerCase();
  const poleMin = numOrNull(q.pole_min);
  const poleMax = numOrNull(q.pole_max);
  const procedure = String(q.procedure || '').toLowerCase();
  const phase = mapAppliedPhase(q.phase);
  const agri = String(q.agri || '').toLowerCase();
  const agency = String(q.agency || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (queue === 'pending' && !isPendingQueue(r)) return false;
    if (queue === 'withheld' && String(r.status) !== 'withheld') return false;
    if (division && String(r.division_code) !== division) return false;
    if (ccc && String(r.ccc_code) !== ccc) return false;
    if (klass && String(r.consumer_class || r.category) !== klass) return false;
    if (slab && slabIdOf(r, clock) !== slab) return false;
    if (delayMin != null || delayMax != null) {
      if (!daysInRange(daysOf(r, clock), delayMin, delayMax)) return false;
    }
    if (pole === 'pole' || pole === 'non_pole' || pole === 'unknown') {
      if (poleKindOf(r) !== pole) return false;
    }
    if (poleMin != null || poleMax != null) {
      const n = poleCountOf(r);
      if (n == null || !daysInRange(n, poleMin, poleMax)) return false;
    }
    if (procedure === 'proc_a' || procedure === 'proc_b' || procedure === 'unknown') {
      if (procedureOf(r) !== procedure) return false;
    }
    if (phase && phaseOf(r) !== phase) return false;
    if (agri === 'agri' && !isAgriClass(r)) return false;
    if (agri === 'non_agri' && isAgriClass(r)) return false;
    if (agency) {
      const name = String(r.agency_name || '').trim().toLowerCase();
      if (agency === '__none__' ? name !== '' : name !== agency) return false;
    }
    if (applyTime && timeKey) {
      const iso = eventOn(r);
      if (timeKey.length === 7 && monthOfIso(iso) !== timeKey) return false;
      if (timeKey.length === 4 && yearOfIso(iso) !== timeKey) return false;
    }
    if (search) {
      const blob = `${r.application_no} ${r.consumer_id} ${r.consumer_name} ${r.phone} ${r.wo_no} ${r.agency_name}`.toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });
}

function buildNscDesk(allRows, q = {}) {
  const clock = String(q.clock || 'quotation') === 'processing' ? 'processing' : 'quotation';
  const queue = String(q.queue || 'pending').toLowerCase();
  const timeKey = String(q.time || '');
  const pendingRows = allRows.filter(isPendingQueue);
  const withheldRows = allRows.filter((r) => String(r.status) === 'withheld');
  const scoped = filterNscRows(allRows, { ...q, apply_time: '0', queue });
  const view = filterNscRows(allRows, { ...q, queue });
  const chartRows = filterNscRows(allRows, {
    ...q,
    queue,
    slab: '',
    delay_min: '',
    delay_max: '',
    pole: '',
    pole_min: '',
    pole_max: '',
    procedure: '',
  });

  const divisions = new Map();
  const cccs = new Map();
  const classes = new Set();
  const years = new Set();
  for (const r of allRows) {
    if (r.division_code) divisions.set(String(r.division_code), r.division_name || r.division_code);
    if (r.ccc_code) {
      if (!q.division || String(r.division_code) === String(q.division)) {
        cccs.set(String(r.ccc_code), r.ccc_name || r.ccc_code);
      }
    }
    if (r.consumer_class) classes.add(r.consumer_class);
  }
  for (const r of scoped) {
    const y = yearOfIso(eventOn(r));
    if (y) years.add(y);
  }

  const extraCuts = parseExtraCuts(q.cuts);
  const allCuts = CUMULATIVE.concat(extraCuts);
  const HOT_SLABS = new Set(['m1_3', 'm3_6', 'm6_12', 'y1']);
  const CRITICAL_SLABS = new Set(['m6_12', 'y1']);
  const byDivision = new Map();
  const byCcc = new Map();
  const byClass = new Map();
  const bySlab = new Map();
  const byCum = new Map();
  const reasons = new Map();
  const ages = [];
  let gtYear = 0;
  let stuck30 = 0;
  let stuck180 = 0;
  for (const cut of allCuts) byCum.set(cut.id, 0);

  function ensureDiv(r) {
    const divName = r.division_name || r.division_code || 'Unknown';
    if (!byDivision.has(divName)) {
      const rec = {
        name: divName,
        code: r.division_code || '',
        total: 0,
        hot: 0,
        critical: 0,
        delay_sum: 0,
        delay_n: 0,
        non_pole: 0,
        pole: 0,
        poles_sum: 0,
        proc_a: 0,
        proc_b: 0,
        hot_proc_b: 0,
      };
      for (const s of SLABS) rec[s.id] = 0;
      rec.unknown = 0;
      for (const cut of allCuts) rec[cut.id] = 0;
      byDivision.set(divName, rec);
    }
    return byDivision.get(divName);
  }

  const byPoleBin = new Map();
  for (const b of POLE_BINS) byPoleBin.set(b.id, 0);
  let mixNonPole = 0;
  let mixPole = 0;
  let mixUnknown = 0;
  let mixPolesSum = 0;
  let mixHotNonPole = 0;
  let mixHotPole = 0;
  let mixProcA = 0;
  let mixProcB = 0;
  let mixProcUnknown = 0;
  let mixHotProcA = 0;
  let mixHotProcB = 0;

  for (const r of chartRows) {
    const rec = ensureDiv(r);
    const sid = slabIdOf(r, clock) || 'unknown';
    rec[sid] = (rec[sid] || 0) + 1;
    rec.total += 1;
    bySlab.set(sid, (bySlab.get(sid) || 0) + 1);
    const d = Number(daysOf(r, clock));
    if (Number.isFinite(d) && d >= 0) {
      rec.delay_sum += d;
      rec.delay_n += 1;
    }
    if (HOT_SLABS.has(sid)) rec.hot += 1;
    if (CRITICAL_SLABS.has(sid)) rec.critical += 1;
    for (const cut of allCuts) {
      if (matchesCut(d, cut)) {
        rec[cut.id] = (rec[cut.id] || 0) + 1;
        byCum.set(cut.id, (byCum.get(cut.id) || 0) + 1);
      }
    }
    const kind = poleKindOf(r);
    const poles = poleCountOf(r) || 0;
    if (kind === 'pole') {
      mixPole += 1;
      rec.pole += 1;
      rec.poles_sum += poles;
      mixPolesSum += poles;
      if (HOT_SLABS.has(sid)) mixHotPole += 1;
    } else if (kind === 'non_pole') {
      mixNonPole += 1;
      rec.non_pole += 1;
      if (HOT_SLABS.has(sid)) mixHotNonPole += 1;
    } else {
      mixUnknown += 1;
    }
    const bin = poleBinOf(kind === 'unknown' ? 0 : poles);
    if (kind !== 'unknown') byPoleBin.set(bin.id, (byPoleBin.get(bin.id) || 0) + 1);
    const proc = procedureOf(r);
    if (proc === 'proc_b') {
      mixProcB += 1;
      rec.proc_b += 1;
      if (HOT_SLABS.has(sid)) {
        mixHotProcB += 1;
        rec.hot_proc_b += 1;
      }
    } else if (proc === 'proc_a') {
      mixProcA += 1;
      rec.proc_a += 1;
      if (HOT_SLABS.has(sid)) mixHotProcA += 1;
    } else mixProcUnknown += 1;
  }

  for (const r of view) {
    const cccName = r.ccc_name || r.ccc_code || 'Unknown';
    if (!byCcc.has(cccName)) {
      byCcc.set(cccName, {
        code: r.ccc_code || '',
        name: cccName,
        count: 0,
        hot: 0,
        critical: 0,
        delay_sum: 0,
        delay_n: 0,
        non_pole: 0,
        pole: 0,
        hot_non_pole: 0,
        hot_pole: 0,
        poles_sum: 0,
        proc_a: 0,
        proc_b: 0,
        hot_proc_b: 0,
      });
    }
    const cccRec = byCcc.get(cccName);
    cccRec.count += 1;
    const cls = r.consumer_class || 'Others';
    byClass.set(cls, (byClass.get(cls) || 0) + 1);
    const sid = slabIdOf(r, clock) || 'unknown';
    const d = Number(daysOf(r, clock));
    if (Number.isFinite(d) && d >= 0) {
      ages.push(d);
      cccRec.delay_sum += d;
      cccRec.delay_n += 1;
    }
    if (HOT_SLABS.has(sid)) {
      cccRec.hot += 1;
      stuck30 += 1;
    }
    if (CRITICAL_SLABS.has(sid)) {
      cccRec.critical += 1;
      stuck180 += 1;
    }
    const kind = poleKindOf(r);
    const poles = poleCountOf(r) || 0;
    if (kind === 'pole') {
      cccRec.pole += 1;
      cccRec.poles_sum += poles;
      if (HOT_SLABS.has(sid)) cccRec.hot_pole += 1;
    } else if (kind === 'non_pole') {
      cccRec.non_pole += 1;
      if (HOT_SLABS.has(sid)) cccRec.hot_non_pole += 1;
    }
    const proc = procedureOf(r);
    if (proc === 'proc_b') {
      cccRec.proc_b += 1;
      if (HOT_SLABS.has(sid)) cccRec.hot_proc_b += 1;
    } else if (proc === 'proc_a') cccRec.proc_a += 1;
    if (sid === 'y1') gtYear += 1;
    if (queue === 'withheld') {
      const reason = String(r.withheld_reason || '').trim() || 'Not recorded';
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
  }

  const divNames = [...new Set(scoped.map((r) => r.division_name || r.division_code).filter(Boolean))];
  const timeline = queue === 'withheld' ? buildTimeline(scoped, timeKey, divNames) : [];

  return {
    report_date: allRows[0]?.report_date || null,
    pending: pendingRows.length,
    withheld: withheldRows.length,
    view: view.length,
    mix_total: chartRows.length,
    avg_days: ages.length ? Math.round(ages.reduce((s, n) => s + n, 0) / ages.length) : 0,
    gt_year: gtYear,
    stuck_30: stuck30,
    stuck_180: stuck180,
    pole: {
      non_pole: mixNonPole,
      pole: mixPole,
      unknown: mixUnknown,
      poles_sum: mixPolesSum,
      hot_non_pole: mixHotNonPole,
      hot_pole: mixHotPole,
      avg_poles: mixPole ? Math.round((10 * mixPolesSum) / mixPole) / 10 : 0,
    },
    by_pole_bin: POLE_BINS.map((b) => ({
      id: b.id,
      name: b.label,
      min: b.min,
      max: b.max === Infinity ? null : b.max,
      count: byPoleBin.get(b.id) || 0,
    })),
    procedure: {
      proc_a: mixProcA,
      proc_b: mixProcB,
      unknown: mixProcUnknown,
      hot_proc_a: mixHotProcA,
      hot_proc_b: mixHotProcB,
    },
    divisions: [...divisions.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([code, name]) => ({ code, name })),
    cccs: [...cccs.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([code, name]) => ({ code, name })),
    classes: [...classes].sort(),
    years: [...years].sort(),
    by_division: [...byDivision.values()]
      .map((d) => ({
        ...d,
        avg_days: d.delay_n ? Math.round(d.delay_sum / d.delay_n) : 0,
        hot_pct: d.total ? Math.round((1000 * d.hot) / d.total) / 10 : 0,
      }))
      .sort((a, b) => b.hot - a.hot || b.total - a.total),
    by_ccc: [...byCcc.values()]
      .map((c) => ({
        code: c.code,
        name: c.name,
        count: c.count,
        hot: c.hot,
        critical: c.critical,
        avg_days: c.delay_n ? Math.round(c.delay_sum / c.delay_n) : 0,
        hot_pct: c.count ? Math.round((1000 * c.hot) / c.count) / 10 : 0,
        non_pole: c.non_pole || 0,
        pole: c.pole || 0,
        hot_non_pole: c.hot_non_pole || 0,
        hot_pole: c.hot_pole || 0,
        poles_sum: c.poles_sum || 0,
        proc_a: c.proc_a || 0,
        proc_b: c.proc_b || 0,
        hot_proc_b: c.hot_proc_b || 0,
      }))
      .sort((a, b) => b.hot - a.hot || b.hot_pct - a.hot_pct)
      .slice(0, 21),
    by_class: [...byClass.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    by_slab: SLABS.map((s) => ({
      id: s.id,
      name: s.label,
      count: bySlab.get(s.id) || 0,
    })),
    by_cumulative: allCuts.map((c) => ({
      id: c.id,
      name: c.label,
      op: c.op,
      days: c.days,
      days_max: c.daysMax,
      count: byCum.get(c.id) || 0,
      custom: !!c.id && String(c.id).startsWith('c_'),
    })),
    timeline,
    timeline_divisions: divNames,
    reasons: [...reasons.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12),
  };
}

function monthYearLabel(ym) {
  if (!ym || String(ym).length < 7) return ym;
  const month = Number(String(ym).slice(5, 7));
  const yy = String(ym).slice(2, 4);
  if (!Number.isFinite(month) || month < 1 || month > 12) return ym;
  return `${month}/${yy}`;
}

function eachMonth(fromYm, toYm) {
  const out = [];
  let y = Number(fromYm.slice(0, 4));
  let m = Number(fromYm.slice(5, 7));
  const y2 = Number(toYm.slice(0, 4));
  const m2 = Number(toYm.slice(5, 7));
  if (![y, m, y2, m2].every(Number.isFinite)) return out;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

function buildTimeline(rows, timeKey, divNames) {
  const year = String(timeKey || '').length === 4 ? String(timeKey) : '';
  const empty = () => {
    const rec = { added: 0 };
    for (const d of divNames) rec[d] = 0;
    return rec;
  };
  const buckets = new Map();
  const seen = [];
  for (const r of rows) {
    const ym = monthOfIso(eventOn(r));
    if (!ym) continue;
    if (year && ym.slice(0, 4) !== year) continue;
    const rec = buckets.get(ym) || empty();
    rec.added += 1;
    const div = r.division_name || r.division_code || 'Unknown';
    rec[div] = (rec[div] || 0) + 1;
    buckets.set(ym, rec);
    seen.push(ym);
  }
  let keys;
  if (year) {
    keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  } else if (seen.length) {
    const sortedSeen = [...new Set(seen)].sort();
    keys = eachMonth(sortedSeen[0], sortedSeen[sortedSeen.length - 1]);
  } else {
    return [];
  }
  let run = 0;
  return keys.map((key) => {
    const rec = buckets.get(key) || empty();
    run += rec.added;
    return { key, label: monthYearLabel(key), added: rec.added, cumulative: run, ...rec };
  });
}

function nscExportRow(r) {
  return {
    application_no: r.application_no || '',
    consumer_id: r.consumer_id || '',
    consumer_name: r.consumer_name || '',
    consumer_class: r.consumer_class || '',
    phone: r.phone || '',
    division_name: r.division_name || '',
    ccc_name: r.ccc_name || '',
    sap_status: r.sap_status || '',
    status: r.status || '',
    agency_name: r.agency_name || '',
    wo_no: r.wo_no || '',
    quotation_issue_on: r.quotation_issue_on || '',
    collected_on: r.collected_on || '',
    withheld_on: r.withheld_on || '',
    withheld_reason: r.withheld_reason || '',
    quotation_age_days: r.quotation_age_days ?? '',
    processing_days: r.processing_days ?? '',
    pole_count: poleCountOf(r) ?? '',
    pole_kind: poleKindOf(r),
    applicant_type: r.applicant_type || '',
    procedure: procedureOf(r),
    procedure_label: r.procedure_label || mapProcedure(r.applicant_type).procedure_label,
    complex_name: r.complex_name || '',
    applied_phase: phaseOf(r),
  };
}

function nscListRow(r) {
  const out = nscExportRow(r);
  out.quotation_age_days = r.quotation_age_days ?? null;
  out.processing_days = r.processing_days ?? null;
  out.pole_count = poleCountOf(r);
  out.pole_kind = poleKindOf(r);
  out.applicant_type = r.applicant_type || '';
  out.procedure = procedureOf(r);
  out.procedure_label = r.procedure_label || mapProcedure(r.applicant_type).procedure_label;
  out.complex_name = r.complex_name || '';
  return out;
}

module.exports = {
  SLABS,
  CUMULATIVE,
  NSC_META,
  parseNscWorkbook,
  packNscCloudRow,
  slimNscCloudRow,
  mergeFirstSeen,
  hydrateNsc,
  hydrateNscRows,
  extraPayload,
  buildPreview,
  isPendingQueue,
  queueOf,
  mapSapStatus,
  slabFor,
  filterNscRows,
  buildNscDesk,
  nscExportRow,
  nscListRow,
  mapAppliedPhase,
  phaseOf,
};
