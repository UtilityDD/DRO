/**
 * Patch pole_count / pole_kind onto the local nsc_cases snapshot from the SAP dump.
 * Usage: node scripts/backfill_nsc_poles.js [xlsb]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_FILE =
  'C:/Users/rouma/Downloads/MALDA ZONE PENDING NSC ACCEPTED WORKING 7 WITHELD APPLICATION AS ON 22-08-2026.xlsb';
const CASES = path.join(__dirname, '..', 'server', 'data', 'nsc_cases.json');

function parsePoleCount(v) {
  if (v == null || v === '' || v === '(null)') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

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

function dumpPoles(srcPath) {
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
$poles = @($ws.Range($ws.Cells.Item(2,31), $ws.Cells.Item($last,31)).Value2)
$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
$n = [Math]::Min($apps.Length, $poles.Length)
for ($i = 0; $i -lt $n; $i++) {
  $a = $apps[$i]
  if ($null -eq $a -or $a -eq '') { continue }
  $p = $poles[$i]
  if ($null -eq $p -or $p -eq '') { $p = 0 }
  Write-Output ($a.ToString() + [char]9 + $p.ToString())
}
`;
  const r = spawnSync('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    timeout: 180000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(r.stderr || 'Excel dump failed');
  const map = new Map();
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const i = line.indexOf('\t');
    if (i < 1) continue;
    const id = cleanId(line.slice(0, i));
    if (!id) continue;
    map.set(id, parsePoleCount(line.slice(i + 1)));
  }
  return map;
}

function main() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  if (!fs.existsSync(CASES)) throw new Error('server/data/nsc_cases.json is missing');
  console.log('[pole-backfill] reading NO_OF_POLES from', path.basename(filePath));
  const poles = dumpPoles(filePath);
  console.log('[pole-backfill] source rows', poles.size);
  const rows = JSON.parse(fs.readFileSync(CASES, 'utf8'));
  let hit = 0;
  let pole = 0;
  for (const row of rows) {
    const n = poles.has(cleanId(row.application_no)) ? poles.get(cleanId(row.application_no)) : 0;
    row.pole_count = n;
    row.pole_kind = n > 0 ? 'pole' : 'non_pole';
    if (poles.has(cleanId(row.application_no))) hit += 1;
    if (n > 0) pole += 1;
  }
  fs.writeFileSync(CASES, JSON.stringify(rows));
  console.log('[pole-backfill] saved', rows.length, 'matched', hit, 'pole-cases', pole);
}

main();
