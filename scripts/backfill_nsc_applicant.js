/**
 * Patch applicant_type / procedure onto the local nsc_cases snapshot.
 * Usage: node scripts/backfill_nsc_applicant.js [xlsb]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_FILE =
  'C:/Users/rouma/Downloads/MALDA ZONE PENDING NSC ACCEPTED WORKING 7 WITHELD APPLICATION AS ON 22-08-2026.xlsb';
const CASES = path.join(__dirname, '..', 'server', 'data', 'nsc_cases.json');

function cleanId(v) {
  if (v == null || v === '' || v === '(null)') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v));
  let s = String(v).trim();
  if (/e\+/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s;
}

function mapProcedure(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '(null)') return { applicant_type: '', procedure: 'unknown', procedure_label: 'Not recorded' };
  const u = s.toUpperCase().replace(/\s+/g, ' ');
  if (/PROMOTER|DEVELOPER|HOUSING|COMPLEX/.test(u)) {
    return { applicant_type: s, procedure: 'proc_b', procedure_label: 'Procedure B' };
  }
  return { applicant_type: s, procedure: 'proc_a', procedure_label: 'Individual' };
}

function dumpApplicants(srcPath) {
  const src = srcPath.replace(/'/g, "''");
  const ps = `
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open('${src}', 0, $true)
$ws = $null
foreach ($s in $wb.Worksheets) { if ($s.Name -match 'PNSC|PENDING|NSC') { $ws = $s; break } }
if (-not $ws) { $ws = $wb.Worksheets.Item(1) }
$last = $ws.UsedRange.Rows.Count
$apps = @($ws.Range($ws.Cells.Item(2,6), $ws.Cells.Item($last,6)).Value2)
$types = @($ws.Range($ws.Cells.Item(2,12), $ws.Cells.Item($last,12)).Value2)
$names = @($ws.Range($ws.Cells.Item(2,13), $ws.Cells.Item($last,13)).Value2)
$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
$n = [Math]::Min($apps.Length, $types.Length)
for ($i = 0; $i -lt $n; $i++) {
  $a = $apps[$i]
  if ($null -eq $a -or $a -eq '') { continue }
  $t = $types[$i]
  if ($null -eq $t) { $t = '' }
  $c = ''
  if ($names -and $i -lt $names.Length -and $null -ne $names[$i]) { $c = $names[$i] }
  Write-Output ($a.ToString() + [char]9 + $t.ToString() + [char]9 + $c.ToString())
}
`;
  const r = spawnSync('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    timeout: 180000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 48 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(r.stderr || 'Excel dump failed');
  const map = new Map();
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const id = cleanId(parts[0]);
    if (!id) continue;
    map.set(id, { type: String(parts[1] || '').trim(), complex: String(parts[2] || '').trim() });
  }
  return map;
}

function main() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  if (!fs.existsSync(CASES)) throw new Error('server/data/nsc_cases.json is missing');
  console.log('[applicant-backfill] reading APPLICANT_TYPE from', path.basename(filePath));
  const src = dumpApplicants(filePath);
  console.log('[applicant-backfill] source rows', src.size);
  const rows = JSON.parse(fs.readFileSync(CASES, 'utf8'));
  let hit = 0;
  let procB = 0;
  for (const row of rows) {
    const rec = src.get(cleanId(row.application_no));
    const mapped = mapProcedure(rec ? rec.type : row.applicant_type);
    row.applicant_type = mapped.applicant_type;
    row.procedure = mapped.procedure;
    row.procedure_label = mapped.procedure_label;
    if (rec && rec.complex) row.complex_name = rec.complex;
    if (rec) hit += 1;
    if (mapped.procedure === 'proc_b') procB += 1;
  }
  fs.writeFileSync(CASES, JSON.stringify(rows));
  console.log('[applicant-backfill] saved', rows.length, 'matched', hit, 'procedure-b', procB);
}

main();
