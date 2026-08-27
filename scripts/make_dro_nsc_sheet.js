/**
 * Build a Darjeeling Region pending-NSC workbook from a Malda SAP dump.
 * Randomly assigns DRO divisions/CCCs and keeps half the rows.
 *
 * Usage: node scripts/make_dro_nsc_sheet.js [xlsb]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');

const SRC =
  process.argv[2] ||
  'C:/Users/USER/Downloads/MALDA ZONE PENDING NEW SERVICE CONNECTION ACCEPTED,WORKING & WITHELD DATE 04-08-2026.xlsb';
const KEEP = 0.5;
const SEED = 3410804;

const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'office_map.json'), 'utf8'));

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

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normHeader(h) {
  return String(h || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

function droOffices() {
  const out = [];
  for (const div of MAP.divisions) {
    for (const ccc of div.cccs || []) {
      out.push({
        ccc_code: String(ccc.code),
        ccc_name: ccc.name,
        division_code: String(div.code),
        division_name: div.name,
        region_code: String(MAP.region.code),
        region_name: MAP.region.name,
        zone_code: String(MAP.zone.code),
        zone_name: MAP.zone.name,
        weight: Math.max(1, Number(ccc.consumers) || 1),
      });
    }
  }
  return out;
}

function pickOffice(rng, offices, totalWeight) {
  let n = rng() * totalWeight;
  for (const o of offices) {
    n -= o.weight;
    if (n <= 0) return o;
  }
  return offices[offices.length - 1];
}

function convertViaExcelCsv(srcPath) {
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

function readAoa(filePath) {
  try {
    const wb = XLSX.readFile(filePath, { raw: true, cellDates: false });
    const name = wb.SheetNames.find((n) => /PNSC|PENDING|NSC/i.test(n)) || wb.SheetNames[0];
    return { aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }), csv: null };
  } catch (first) {
    const csvPath = convertViaExcelCsv(filePath);
    const wb = XLSX.readFile(csvPath, { raw: false, cellDates: false });
    return {
      aoa: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true }),
      csv: csvPath,
    };
  }
}

function findHeaderRow(aoa) {
  const keys = new Set([
    'APPL_NO',
    'APPLICATION_NO',
    'CCC_CODE',
    'CCC',
    'SUPP_OFF',
    'CCC_NAME',
    'DIVN_NAME',
    'DIVISION',
    'DIVISION_NAME',
    'DIVISION_CODE',
    'REG',
    'REGION',
  ]);
  let best = { row: 0, hits: 0 };
  for (let r = 0; r < Math.min(aoa.length, 12); r += 1) {
    const hits = (aoa[r] || []).filter((c) => keys.has(normHeader(c))).length;
    if (hits > best.hits) best = { row: r, hits };
  }
  return best.row;
}

function colIndex(headers, names) {
  const want = names.map(normHeader);
  return headers.findIndex((h) => want.includes(normHeader(h)));
}

function main() {
  if (!fs.existsSync(SRC)) throw new Error(`File not found: ${SRC}`);
  const offices = droOffices();
  const totalWeight = offices.reduce((s, o) => s + o.weight, 0);
  const rng = mulberry32(SEED);

  console.log('[dro-sheet] reading', path.basename(SRC));
  const { aoa, csv } = readAoa(SRC);
  try {
    const headerRow = findHeaderRow(aoa);
    const headers = aoa[headerRow] || [];
    const idx = {
      ccc_code: colIndex(headers, ['CCC_CODE', 'CCC']),
      ccc_name: colIndex(headers, ['SUPP_OFF', 'CCC_NAME']),
      division: colIndex(headers, ['DIVN_NAME', 'DIVISION', 'DIVISION_NAME']),
      division_code: colIndex(headers, ['DIVISION_CODE', 'DIVN_CODE']),
      region: colIndex(headers, ['REG', 'REGION', 'REGION_NAME']),
      region_code: colIndex(headers, ['REGION_CODE', 'REG_CODE']),
      zone: colIndex(headers, ['ZONE', 'ZONE_NAME']),
      zone_code: colIndex(headers, ['ZONE_CODE']),
    };
    console.log('[dro-sheet] header row', headerRow, idx);
    console.log('[dro-sheet] headers', headers.map((h, i) => `${i}:${h}`).join(' | '));

    const body = [];
    for (let r = headerRow + 1; r < aoa.length; r += 1) {
      const line = aoa[r] || [];
      if (!line.some((c) => String(c || '').trim())) continue;
      body.push(line);
    }
    const keepN = Math.max(1, Math.round(body.length * KEEP));
    const kept = shuffle(body, rng).slice(0, keepN);
    const counts = new Map();
    for (const row of kept) {
      const office = pickOffice(rng, offices, totalWeight);
      counts.set(office.ccc_name, (counts.get(office.ccc_name) || 0) + 1);
      if (idx.ccc_code >= 0) row[idx.ccc_code] = office.ccc_code;
      if (idx.ccc_name >= 0) row[idx.ccc_name] = office.ccc_name;
      if (idx.division >= 0) row[idx.division] = office.division_name;
      if (idx.division_code >= 0) row[idx.division_code] = office.division_code;
      if (idx.region >= 0) row[idx.region] = office.region_name;
      if (idx.region_code >= 0) row[idx.region_code] = office.region_code;
      if (idx.zone >= 0) row[idx.zone] = office.zone_name;
      if (idx.zone_code >= 0) row[idx.zone_code] = office.zone_code;
    }

    const outAoa = [...aoa.slice(0, headerRow + 1), ...kept];
    const ws = XLSX.utils.aoa_to_sheet(outAoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PNSC DRO');
    const dest = path.join(
      path.dirname(SRC),
      'DARJEELING REGION PENDING NEW SERVICE CONNECTION ACCEPTED,WORKING & WITHELD DATE 04-08-2026.xlsx'
    );
    XLSX.writeFile(wb, dest, { compression: true });
    const byDiv = new Map();
    for (const o of offices) byDiv.set(o.division_name, 0);
    for (const [name, n] of counts) {
      const o = offices.find((x) => x.ccc_name === name);
      if (o) byDiv.set(o.division_name, (byDiv.get(o.division_name) || 0) + n);
    }
    console.log('[dro-sheet] source rows', body.length, 'kept', kept.length);
    console.log('[dro-sheet] by division', Object.fromEntries(byDiv));
    console.log('[dro-sheet] by ccc', Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])));
    console.log('[dro-sheet] wrote', dest);
  } finally {
    if (csv) {
      try {
        fs.unlinkSync(csv);
      } catch {
        /* ignore */
      }
    }
  }
}

main();
