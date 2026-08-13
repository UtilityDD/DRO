import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api, AUTH_MODULES, canUploadModule } from '../api';
import { useAuth } from '../auth';
import { isAtcWorkbook, parseAtcWorkbookFromAoa } from '../lib/atcParse';

type AtcSlot = 'IA' | 'IB';
type StagedAtc = {
  format: AtcSlot;
  filename: string;
  rows: Record<string, unknown>[];
  months: string[];
};

type Guide = { title: string; dos: string[]; donts: string[] };

const ATC_SLOT_GUIDE: Record<AtcSlot, Guide> = {
  IA: {
    title: 'With CCC (Incl. Bulk) — Do & Don’t',
    dos: [
      'Use the Format-IA / Incl. Bulk workbook (CCC rows).',
      'Keep official month headers (e.g. May’25, Mar’26).',
      'Re-upload to fix months — only months in this file are replaced.',
    ],
    donts: [
      'Don’t put the Division-only (Excl. Bulk) sheet here.',
      'Don’t delete or rename month header columns.',
      'Don’t upload password-protected or scanned PDFs.',
    ],
  },
  IB: {
    title: 'Without CCC (Excl. Bulk) — Do & Don’t',
    dos: [
      'Use the Format-IB / Excl. Bulk workbook (Division+).',
      'Keep official month headers (e.g. May’25, Mar’26).',
      'Re-upload to fix months — only months in this file are replaced.',
    ],
    donts: [
      'Don’t put the CCC / Incl. Bulk sheet here.',
      'Don’t delete or rename month header columns.',
      'Don’t expect months missing from the file to change.',
    ],
  },
};

const GUIDE: Record<string, Guide> = {
  atc: {
    title: 'AT&C upload — Do & Don’t',
    dos: [
      'Upload the CCC sheet in With CCC (Incl. Bulk).',
      'Upload the Division sheet in Without CCC (Excl. Bulk).',
      'Re-upload to fix mistakes — only months in the new file are replaced.',
      'Keep the official header months (e.g. May’25, Mar’26, May’26).',
      'Statewide sheets are OK — only Zone 34 / Region 341 offices are kept.',
    ],
    donts: [
      'Don’t put the Division-only sheet in the With CCC slot (and vice versa).',
      'Don’t delete or rename month header columns.',
      'Don’t expect months missing from the file to change.',
      'Don’t upload password-protected or scanned PDFs.',
    ],
  },
  nsc: {
    title: 'NSC — Do & Don’t',
    dos: ['Use the template columns.', 'One row per application.'],
    donts: ['Don’t leave application_no blank.', 'Don’t mix other modules in the same file.'],
  },
  disco: {
    title: 'Disconnection — Do & Don’t',
    dos: ['Use the template columns.', 'Include ccc_code and status.'],
    donts: ['Don’t leave consumer_id blank.'],
  },
  grievance: {
    title: 'Grievances — Do & Don’t',
    dos: ['Use docket_no as the unique key.'],
    donts: ['Don’t duplicate docket numbers with conflicting data.'],
  },
  'tech-works': {
    title: 'Tech Works — Do & Don’t',
    dos: ['Include work_id and division_code.'],
    donts: ['Don’t remove required status fields.'],
  },
  'spot-billing': {
    title: 'Spot Billing — Do & Don’t',
    dos: ['Include period_label and ccc_code.'],
    donts: ['Don’t mix multiple months without period_label.'],
  },
  consumers: {
    title: 'Consumers — Do & Don’t',
    dos: ['Use consumer_id as the unique key.'],
    donts: ['Don’t upload partial IDs that collide with live data without review.'],
  },
  bulk: {
    title: 'Bulk — Do & Don’t',
    dos: ['Include consumer_id and division_code.'],
    donts: ['Don’t omit contract demand when updating demand.'],
  },
};

const TEMPLATES: Record<string, string[]> = {
  nsc: ['application_no', 'consumer_name', 'ccc_code', 'status', 'delay_days', 'category'],
  disco: ['consumer_id', 'consumer_name', 'ccc_code', 'disco_date', 'amount_due', 'status'],
  grievance: ['docket_no', 'consumer_name', 'ccc_code', 'category', 'aging_days', 'status'],
  'tech-works': ['work_id', 'title', 'division_code', 'vendor_name', 'billing_status', 'status'],
  'spot-billing': ['ccc_code', 'consumer_class', 'target_count', 'billed_count', 'period_label'],
  consumers: ['consumer_id', 'name', 'ccc_code', 'consumer_class', 'status', 'meter_no'],
  bulk: ['consumer_id', 'name', 'division_code', 'contract_demand', 'voltage_level'],
};

function monthsFromRows(rows: Record<string, unknown>[]) {
  return [...new Set(rows.map((r) => String(r.period_label || '')).filter(Boolean))].sort();
}

const ATC_DIFF_FIELDS: { key: string; label: string; kind: 'pct' | 'mu' | 'count' }[] = [
  { key: 'atc_loss', label: 'AT&C %', kind: 'pct' },
  { key: 'dist_loss', label: 'T&D %', kind: 'pct' },
  { key: 'coll_eff', label: 'Coll %', kind: 'pct' },
  { key: 'input_mu', label: 'Input MU', kind: 'mu' },
  { key: 'demand_mu', label: 'Demand MU', kind: 'mu' },
  { key: 'collection_mu', label: 'Coll MU', kind: 'mu' },
  { key: 'target_atc', label: 'Target AT&C', kind: 'pct' },
  { key: 'target_dist', label: 'Target T&D', kind: 'pct' },
  { key: 'consumer_count', label: 'Consumers', kind: 'count' },
];

type AtcDiffRow = {
  id: string;
  office: string;
  officeName: string;
  period: string;
  format: string;
  field: string;
  fieldLabel: string;
  oldVal: string;
  newVal: string;
  delta: string;
  kind: 'change' | 'new';
};

function atcRowKey(r: Record<string, unknown>) {
  const fmt = String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
  return `${r.period_label}|${fmt}|${r.office_code}`;
}

function toDiffNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtDiffNum(n: number | null, kind: 'pct' | 'mu' | 'count') {
  if (n == null) return '—';
  if (kind === 'count') return String(Math.round(n));
  if (kind === 'pct') return n.toFixed(2);
  return Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(3);
}

function sameNum(a: number | null, b: number | null) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.0005;
}

function buildAtcDiff(
  incoming: Record<string, unknown>[],
  existing: Record<string, unknown>[]
): { rows: AtcDiffRow[]; newOffices: number; changedOffices: number; unchangedOffices: number } {
  const map = new Map(existing.map((r) => [atcRowKey(r), r]));
  const out: AtcDiffRow[] = [];
  let newOffices = 0;
  let changedOffices = 0;
  let unchangedOffices = 0;

  for (const neu of incoming) {
    const key = atcRowKey(neu);
    const old = map.get(key);
    const office = String(neu.office_code || '');
    const officeName = String(neu.office_name || '');
    const period = String(neu.period_label || '');
    const format = String(neu.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';

    if (!old) {
      newOffices += 1;
      for (const f of ATC_DIFF_FIELDS) {
        const nv = toDiffNum(neu[f.key]);
        if (nv == null) continue;
        out.push({
          id: `${key}|${f.key}|new`,
          office,
          officeName,
          period,
          format,
          field: f.key,
          fieldLabel: f.label,
          oldVal: '—',
          newVal: fmtDiffNum(nv, f.kind),
          delta: 'new',
          kind: 'new',
        });
      }
      continue;
    }

    let changed = false;
    for (const f of ATC_DIFF_FIELDS) {
      const ov = toDiffNum(old[f.key]);
      const nv = toDiffNum(neu[f.key]);
      if (sameNum(ov, nv)) continue;
      changed = true;
      const delta =
        ov != null && nv != null ? fmtDiffNum(nv - ov, f.kind === 'count' ? 'mu' : f.kind) : '—';
      out.push({
        id: `${key}|${f.key}`,
        office,
        officeName,
        period,
        format,
        field: f.key,
        fieldLabel: f.label,
        oldVal: fmtDiffNum(ov, f.kind),
        newVal: fmtDiffNum(nv, f.kind),
        delta,
        kind: 'change',
      });
    }
    if (changed) changedOffices += 1;
    else unchangedOffices += 1;
  }

  out.sort((a, b) => {
    const ps = a.period.localeCompare(b.period);
    if (ps) return ps;
    const fs = a.format.localeCompare(b.format);
    if (fs) return fs;
    const os = a.office.localeCompare(b.office);
    if (os) return os;
    return a.fieldLabel.localeCompare(b.fieldLabel);
  });

  return { rows: out, newOffices, changedOffices, unchangedOffices };
}

export function UploadPage() {
  const { user } = useAuth();
  const allowedModules = AUTH_MODULES.filter((m) => canUploadModule(user, m.id));
  const [module, setModule] = useState<string>(
    allowedModules.find((m) => m.uploadKey === 'atc')?.uploadKey ||
      allowedModules[0]?.uploadKey ||
      'nsc'
  );
  const [period, setPeriod] = useState("Aug'26");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [filename, setFilename] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [batches, setBatches] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [activeGuide, setActiveGuide] = useState<Guide | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLines, setConfirmLines] = useState<string[]>([]);
  const [confirmDiff, setConfirmDiff] = useState<AtcDiffRow[]>([]);
  const [diffSummary, setDiffSummary] = useState({ newOffices: 0, changedOffices: 0, unchangedOffices: 0 });
  const [diffFilter, setDiffFilter] = useState<'change' | 'new' | 'all'>('change');
  const [pendingRows, setPendingRows] = useState<Record<string, unknown>[] | null>(null);
  const [pendingFilename, setPendingFilename] = useState('');
  const [iaSlot, setIaSlot] = useState<StagedAtc | null>(null);
  const [ibSlot, setIbSlot] = useState<StagedAtc | null>(null);
  const [existingByFormat, setExistingByFormat] = useState<{ IA: string[]; IB: string[] }>({
    IA: [],
    IB: [],
  });
  const [cloudHost, setCloudHost] = useState('');
  const [storeMode, setStoreMode] = useState<'supabase' | 'local'>('local');

  const meta = AUTH_MODULES.find((m) => m.uploadKey === module) || AUTH_MODULES[0];
  const allowed = canUploadModule(user, meta.id);
  const isAtc = module === 'atc';
  const moduleGuide = GUIDE[module] || GUIDE.atc;
  const guide = activeGuide || moduleGuide;

  const openGuide = (g?: Guide) => {
    setActiveGuide(g || null);
    setGuideOpen(true);
  };

  useEffect(() => {
    if (allowedModules.length && !allowedModules.some((m) => m.uploadKey === module)) {
      setModule(allowedModules[0].uploadKey);
    }
  }, [allowedModules, module]);

  useEffect(() => {
    api.batches().then((r) => setBatches(r.rows)).catch(() => {});
    api
      .health()
      .then((h) => {
        setStoreMode(h.store === 'supabase' ? 'supabase' : 'local');
        setCloudHost(h.supabase?.host || '');
      })
      .catch(() => setStoreMode('local'));
  }, []);

  useEffect(() => {
    if (!isAtc || !allowed) return;
    Promise.all([api.atcQuery('format=IA'), api.atcQuery('format=IB')])
      .then(([ia, ib]) => {
        setExistingByFormat({
          IA: ia.periods || [],
          IB: ib.periods || [],
        });
      })
      .catch(() => {});
  }, [isAtc, allowed, message]);

  const stagedMonths = useMemo(() => {
    const ia = iaSlot?.months || [];
    const ib = ibSlot?.months || [];
    return { IA: ia, IB: ib };
  }, [iaSlot, ibSlot]);

  if (!allowedModules.length) {
    return (
      <div className="panel">
        <h2>Upload</h2>
        <p className="error">No upload permission. Ask an admin.</p>
      </div>
    );
  }

  const parseWorkbookSheets = (wb: XLSX.WorkBook) =>
    wb.SheetNames.map((name) => ({
      name,
      aoa: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1,
        defval: null,
        raw: true,
      }) as unknown[][],
    }));

  const onAtcSlotFile = async (slot: AtcSlot, file: File) => {
    setError('');
    setMessage('');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheets = parseWorkbookSheets(wb);
    const parsed = parseAtcWorkbookFromAoa(sheets, {});
    const forSlot = parsed.rows.filter(
      (r) => String(r.source_format || 'IA').toUpperCase() === slot
    );
    if (!forSlot.length) {
      setError(
        slot === 'IA'
          ? 'No With-CCC (Incl. Bulk) data found in this file.'
          : 'No Without-CCC (Excl. Bulk) data found in this file.'
      );
      return;
    }
    const months = monthsFromRows(forSlot);
    const staged: StagedAtc = {
      format: slot,
      filename: file.name,
      rows: forSlot,
      months,
    };
    if (slot === 'IA') setIaSlot(staged);
    else setIbSlot(staged);
    if (parsed.period_label) setPeriod(parsed.period_label);
    const other =
      slot === 'IA'
        ? parsed.counts.IB > 0
          ? ' · Division sheet also found — drop it in Without CCC if needed'
          : ''
        : parsed.counts.IA > 0
          ? ' · CCC sheet also found — drop it in With CCC if needed'
          : '';
    const skipped =
      parsed.filtered_out > 0
        ? ` · skipped ${parsed.filtered_out} out-of-scope offices (kept 34 / 341* only)`
        : '';
    setMessage(
      `${slot === 'IA' ? 'With CCC' : 'Without CCC'}: ${forSlot.length} rows · ${months.join(', ') || '—'}${other}${skipped}`
    );
  };

  const onGenericFile = async (file: File) => {
    setError('');
    setMessage('');
    setFilename(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);

    if (module === 'atc') {
      const sheets = parseWorkbookSheets(wb);
      if (isAtcWorkbook(wb.SheetNames, sheets[0]?.aoa) || sheets.some((s) => s.aoa.length > 5)) {
        const parsed = parseAtcWorkbookFromAoa(sheets, {});
        if (parsed.rows.length) {
          const months = monthsFromRows(parsed.rows);
          if (parsed.period_label) setPeriod(parsed.period_label);
          setRows(parsed.rows);
          setMessage(
            `Parsed ${parsed.counts.IA} Incl. + ${parsed.counts.IB} Excl. · ${months.join(', ')}`
          );
          return;
        }
      }
    }

    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    setRows(json);
    setMessage(`Ready: ${json.length} rows`);
  };

  const downloadTemplate = () => {
    const headers = TEMPLATES[module];
    if (!headers) return;
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'template');
    XLSX.writeFile(wb, `dro_${module}_template.xlsx`);
  };

  const buildConfirmLines = (uploadRows: Record<string, unknown>[]) => {
    const byFmt: Record<string, string[]> = { IA: [], IB: [] };
    for (const r of uploadRows) {
      const f = String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
      const m = String(r.period_label || '');
      if (m && !byFmt[f].includes(m)) byFmt[f].push(m);
    }
    const lines: string[] = [];
    for (const f of ['IA', 'IB'] as const) {
      if (!byFmt[f].length) continue;
      const label = f === 'IA' ? 'With CCC (Incl. Bulk)' : 'Without CCC (Excl. Bulk)';
      const overlap = byFmt[f].filter((m) => existingByFormat[f].includes(m));
      const fresh = byFmt[f].filter((m) => !existingByFormat[f].includes(m));
      lines.push(`${label}: ${byFmt[f].join(', ')}`);
      if (overlap.length) lines.push(`  → Replace existing: ${overlap.join(', ')}`);
      if (fresh.length) lines.push(`  → New months: ${fresh.join(', ')}`);
    }
    lines.push('Other months already stored will stay unchanged.');
    return lines;
  };

  const runUpload = async (uploadRows: Record<string, unknown>[], name: string) => {
    setBusy(true);
    setError('');
    try {
      const chunkSize = 500;
      let total = 0;
      let lastCloud: { persisted?: boolean; host?: string; error?: string } | undefined;
      for (let i = 0; i < uploadRows.length; i += chunkSize) {
        const chunk = uploadRows.slice(i, i + chunkSize);
        const res = await api.upload(module, {
          rows: chunk,
          filename: name,
          period_label: period,
        });
        total += res.upserted;
        lastCloud = res.cloud;
      }
      if (lastCloud?.persisted && (lastCloud.host || storeMode === 'supabase')) {
        setMessage(`Uploaded ${total} rows to Supabase${lastCloud.host ? ` (${lastCloud.host})` : ''}`);
      } else if (storeMode === 'supabase' && lastCloud && !lastCloud.persisted) {
        setMessage(`Saved ${total} rows locally`);
        setError(
          lastCloud.error
            ? `Supabase upload failed: ${lastCloud.error}`
            : 'Supabase upload failed — data kept locally. Run 005_atc_expand.sql if this is AT&C.'
        );
      } else {
        setMessage(`Saved ${total} rows locally`);
      }
      try {
        const b = await api.batches();
        setBatches(b.rows);
      } catch {
        /* session may have dropped after a long sync; upload itself already finished */
      }
      setRows([]);
      setFilename('');
      setIaSlot(null);
      setIbSlot(null);
      setPendingRows(null);
      setConfirmDiff([]);
      setConfirmOpen(false);
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Upload failed');
      const status = (err as Error & { status?: number }).status;
      if (status === 401) {
        setError('Session expired — log in again (admin / 1234), then retry upload.');
      } else {
        setError(err.message || 'Upload failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const actionLabel = storeMode === 'supabase' ? 'Upload to Supabase' : 'Save locally';
  const busyLabel = storeMode === 'supabase' ? 'Uploading…' : 'Saving…';
  const confirmActionLabel = storeMode === 'supabase' ? 'Upload to Supabase' : 'Save';

  const requestPublish = async () => {
    if (isAtc) {
      const combined = [...(iaSlot?.rows || []), ...(ibSlot?.rows || [])];
      if (!combined.length) return;
      const name = [iaSlot?.filename, ibSlot?.filename].filter(Boolean).join(' + ');
      setBusy(true);
      setError('');
      try {
        const needIA = combined.some((r) => String(r.source_format || 'IA').toUpperCase() !== 'IB');
        const needIB = combined.some((r) => String(r.source_format || 'IA').toUpperCase() === 'IB');
        const [ia, ib] = await Promise.all([
          needIA ? api.atcQuery('format=IA') : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
          needIB ? api.atcQuery('format=IB') : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
        ]);
        const existing = [...(ia.rows || []), ...(ib.rows || [])];
        const months = new Set(combined.map((r) => String(r.period_label || '')).filter(Boolean));
        const existingScoped = existing.filter((r) => months.has(String(r.period_label || '')));
        const diff = buildAtcDiff(combined, existingScoped);
        setPendingRows(combined);
        setPendingFilename(name);
        setConfirmLines(buildConfirmLines(combined));
        setConfirmDiff(diff.rows);
        setDiffSummary({
          newOffices: diff.newOffices,
          changedOffices: diff.changedOffices,
          unchangedOffices: diff.unchangedOffices,
        });
        setDiffFilter(diff.rows.some((r) => r.kind === 'change') ? 'change' : 'new');
        setConfirmOpen(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not compare with existing data');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!rows.length) return;
    setPendingRows(rows);
    setPendingFilename(filename);
    setConfirmLines([`Publish ${rows.length} rows to ${meta.label}?`]);
    setConfirmDiff([]);
    setDiffSummary({ newOffices: 0, changedOffices: 0, unchangedOffices: 0 });
    setConfirmOpen(true);
  };

  const visibleDiff = useMemo(() => {
    if (diffFilter === 'all') return confirmDiff;
    return confirmDiff.filter((r) => r.kind === diffFilter);
  }, [confirmDiff, diffFilter]);

  const clearSlot = (slot: AtcSlot) => {
    if (slot === 'IA') setIaSlot(null);
    else setIbSlot(null);
    setMessage('');
  };

  return (
    <div className="upload-page">
      <div className="panel upload-panel">
        <div className="upload-head">
          <div>
            <h2>Upload</h2>
            <p className="upload-dest muted">
              {storeMode === 'supabase'
                ? `Destination: Supabase${cloudHost ? ` · ${cloudHost}` : ''}`
                : 'Destination: local files (Supabase not configured)'}
            </p>
          </div>
          <div className="upload-head-actions">
            <select
              className="upload-module"
              value={module}
              onChange={(e) => {
                setModule(e.target.value);
                setRows([]);
                setIaSlot(null);
                setIbSlot(null);
                setMessage('');
                setError('');
              }}
              aria-label="Database"
            >
              {allowedModules.map((m) => (
                <option key={m.id} value={m.uploadKey}>
                  {m.label}
                </option>
              ))}
            </select>
            {!isAtc && (
              <button type="button" className="btn secondary" onClick={() => openGuide()}>
                Do &amp; Don’t
              </button>
            )}
          </div>
        </div>

        {!allowed && <p className="error">No upload permission for this database.</p>}

        {isAtc && allowed && (
          <div className="upload-atc">
            <div className="upload-slots">
              <AtcDropSlot
                title="With CCC"
                tag="Incl. Bulk"
                staged={iaSlot}
                onFile={(f) => onAtcSlotFile('IA', f)}
                onClear={() => clearSlot('IA')}
                onGuide={() => openGuide(ATC_SLOT_GUIDE.IA)}
              />
              <AtcDropSlot
                title="Without CCC"
                tag="Excl. Bulk"
                staged={ibSlot}
                onFile={(f) => onAtcSlotFile('IB', f)}
                onClear={() => clearSlot('IB')}
                onGuide={() => openGuide(ATC_SLOT_GUIDE.IB)}
              />
            </div>
            <div className="upload-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || (!iaSlot && !ibSlot)}
                onClick={requestPublish}
              >
                {busy ? busyLabel : actionLabel}
              </button>
            </div>
            {(stagedMonths.IA.length > 0 || stagedMonths.IB.length > 0) && (
              <p className="upload-status muted">
                {[
                  stagedMonths.IA.length ? `Incl. ${stagedMonths.IA.join(', ')}` : null,
                  stagedMonths.IB.length ? `Excl. ${stagedMonths.IB.join(', ')}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}

        {!isAtc && allowed && (
          <div className="upload-generic">
            <label className="upload-file-label">
              <span>File</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onGenericFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            {module !== 'atc' && TEMPLATES[module] && (
              <button type="button" className="btn secondary" onClick={downloadTemplate}>
                Template
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={!rows.length || busy}
              onClick={requestPublish}
            >
              {busy ? busyLabel : rows.length ? `${actionLabel} (${rows.length})` : actionLabel}
            </button>
          </div>
        )}

        {message && <p className="upload-status muted">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel upload-batches">
        <h3>Recent</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Module</th>
                <th>File</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {batches.slice(0, 12).map((b) => (
                <tr key={String(b.id)}>
                  <td>{String(b.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                  <td>{String(b.module)}</td>
                  <td>{String(b.filename || '—')}</td>
                  <td>{String(b.row_count)}</td>
                </tr>
              ))}
              {!batches.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No uploads yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {guideOpen && (
        <div className="upload-modal-root" role="dialog" aria-modal="true">
          <button
            type="button"
            className="upload-modal-backdrop"
            aria-label="Close"
            onClick={() => {
              setGuideOpen(false);
              setActiveGuide(null);
            }}
          />
          <div className="upload-modal panel">
            <div className="upload-modal-head">
              <h3>{guide.title}</h3>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setGuideOpen(false);
                  setActiveGuide(null);
                }}
              >
                Close
              </button>
            </div>
            <div className="upload-guide-grid">
              <div>
                <h4 className="upload-guide-do">Do</h4>
                <ul>
                  {guide.dos.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="upload-guide-dont">Don’t</h4>
                <ul>
                  {guide.donts.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && pendingRows && (
        <div className="upload-modal-root" role="dialog" aria-modal="true">
          <button
            type="button"
            className="upload-modal-backdrop"
            aria-label="Cancel"
            onClick={() => !busy && setConfirmOpen(false)}
          />
          <div className={`upload-modal panel ${isAtc ? 'upload-modal-wide' : ''}`}>
            <div className="upload-modal-head">
              <h3>{storeMode === 'supabase' ? 'Review changes before upload' : 'Review changes before save'}</h3>
              <button type="button" className="linkish" disabled={busy} onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              {pendingFilename}
              {storeMode === 'supabase' && cloudHost ? ` → ${cloudHost}` : ''}
            </p>
            <ul className="upload-confirm-list">
              {confirmLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {isAtc && (
              <div className="upload-diff">
                <div className="upload-diff-summary">
                  <span>{diffSummary.changedOffices} offices with changes</span>
                  <span>{diffSummary.newOffices} new</span>
                  <span>{diffSummary.unchangedOffices} unchanged</span>
                  <span>{confirmDiff.filter((r) => r.kind === 'change').length} field mismatches</span>
                </div>
                <div className="upload-diff-filters">
                  {(
                    [
                      ['change', 'Mismatch'],
                      ['new', 'New'],
                      ['all', 'All'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`btn secondary ${diffFilter === id ? 'active' : ''}`}
                      onClick={() => setDiffFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="table-wrap upload-diff-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Office</th>
                        <th>Month</th>
                        <th>Fmt</th>
                        <th>Field</th>
                        <th>Existing</th>
                        <th>New</th>
                        <th>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDiff.slice(0, 250).map((r) => (
                        <tr key={r.id} className={r.kind === 'change' ? 'upload-diff-change' : 'upload-diff-new'}>
                          <td>
                            <div className="upload-diff-office">{r.officeName || r.office}</div>
                            <div className="muted upload-diff-code">{r.office}</div>
                          </td>
                          <td>{r.period}</td>
                          <td>{r.format}</td>
                          <td>{r.fieldLabel}</td>
                          <td>{r.oldVal}</td>
                          <td>{r.newVal}</td>
                          <td>{r.delta}</td>
                        </tr>
                      ))}
                      {!visibleDiff.length && (
                        <tr>
                          <td colSpan={7} className="muted">
                            {diffFilter === 'change'
                              ? 'No mismatches — values match existing data for overlapping offices.'
                              : 'No rows in this view.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {visibleDiff.length > 250 && (
                  <p className="muted upload-diff-cap">Showing first 250 of {visibleDiff.length} rows</p>
                )}
              </div>
            )}

            <div className="upload-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => runUpload(pendingRows, pendingFilename)}
              >
                {busy ? busyLabel : confirmActionLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AtcDropSlot({
  title,
  tag,
  staged,
  onFile,
  onClear,
  onGuide,
}: {
  title: string;
  tag: string;
  staged: StagedAtc | null;
  onFile: (f: File) => void;
  onClear: () => void;
  onGuide: () => void;
}) {
  return (
    <label className={`upload-slot ${staged ? 'has-file' : ''}`}>
      <div className="upload-slot-top">
        <strong>{title}</strong>
        <div className="upload-slot-actions">
          <span className="upload-slot-tag">{tag}</span>
          <button
            type="button"
            className="linkish upload-slot-guide"
            onClick={(e) => {
              e.preventDefault();
              onGuide();
            }}
          >
            Do &amp; Don’t
          </button>
        </div>
      </div>
      {staged ? (
        <div className="upload-slot-file">
          <span className="upload-slot-name">{staged.filename}</span>
          <span className="muted">
            {staged.rows.length} rows · {staged.months.join(', ') || '—'}
          </span>
          <button
            type="button"
            className="linkish"
            onClick={(e) => {
              e.preventDefault();
              onClear();
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <span className="upload-slot-hint">Drop Excel or browse</span>
      )}
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}
