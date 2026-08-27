import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api, AUTH_MODULES, canUploadModule } from '../api';
import { useAuth } from '../auth';
import { formatAtcBasis, selectAtcCirculars, type AtcKeepSlot, type AtcSkip } from '../lib/atcSelect';

type StagedAtc = {
  filename: string;
  files: string[];
  keep: AtcKeepSlot[];
  skip: AtcSkip[];
  rows: Record<string, unknown>[];
  achievementRows: Record<string, unknown>[];
  headerRows: Record<string, unknown>[];
  months: string[];
  achievementMonths: string[];
  headerMonths: string[];
  counts: { IA: number; IB: number };
  filteredOut: number;
  periodLabel: string;
  divCount: number;
};

type Guide = { title: string; dos: string[]; donts: string[] };

function isHeaderPoint(r: Record<string, unknown>) {
  return String(r.point_source || '') === 'header_month';
}

function isFullAchievement(r: Record<string, unknown> | undefined) {
  if (!r) return false;
  if (isHeaderPoint(r)) return false;
  if (String(r.point_source || '') === 'achievement') return true;
  return [r.input_mu, r.demand_mu, r.collection_mu, r.consumer_count].some((v) => v != null && v !== '');
}

async function fileToBase64(file: File) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const ATC_GUIDE: Guide = {
  title: 'AT&C monthly workbook — Do & Don’t',
  dos: [
    'Drop one circular, or Shift-select / drop a folder of mixed months — extras are ignored.',
    'The app keeps one real circular per month (Excl. Bulk and Incl. Bulk) and skips duplicates.',
    'Publish writes those achievement months only (comparison columns do not overwrite a full month).',
    'Statewide sheets are OK — only Darjeeling Region (zone 34 / 341*) is kept.',
    'Re-upload the same month to correct figures.',
  ],
  donts: [
    'Don’t upload password-protected or scanned PDFs.',
    'Don’t expect other months already stored to change.',
    'Don’t tick “fill comparison months” if those months already have a full circular.',
  ],
};

const GUIDE: Record<string, Guide> = {
  atc: ATC_GUIDE,
  nsc: {
    title: 'Pending NSC — Do & Don’t',
    dos: [
      'Upload the SAP pending-NSC dump (Working / Accepted / Withheld).',
      'Enter the report date from the file name (e.g. 22-08-2026).',
      'Malda / other-zone files are remapped onto Darjeeling Region’s 21 CCCs.',
      'Re-upload replaces the whole pending snapshot.',
    ],
    donts: [
      'Don’t upload completed-connection history — this desk is pending only.',
      'Don’t mix other modules in the same file.',
      'Don’t password-protect the workbook.',
    ],
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
    title: 'Priority Works — Do & Don’t',
    dos: [
      'One row per work. Use work_id as the unique key.',
      'Put the work head in category_name (must match an existing category).',
      'Use MVA for SS works and CKT KM for line / feeder works.',
    ],
    donts: ['Don’t split one TAA across conflicting work_id rows.', 'Don’t leave division_code blank.'],
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
  'tech-works': [
    'work_id',
    'category_name',
    'division_code',
    'related_ss_name',
    'description',
    'existing_parameter',
    'proposed_parameter',
    'proposal_enote_no',
    'proposal_enote_date',
    'taa_no',
    'taa_date',
    'scheme_value',
    'billing_progress',
    'major_material',
    'po_no',
    'po_date',
    'agency_name',
    'work_start_date',
    'material_issue_status',
    'work_progress',
    'status',
  ],
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
  const [searchParams] = useSearchParams();
  const allowedModules = AUTH_MODULES.filter(
    (m) => m.id !== 'grievance' && m.id !== 'field_notes' && canUploadModule(user, m.id)
  );
  const requestedModule = searchParams.get('module') || '';
  const [module, setModule] = useState<string>(
    allowedModules.find((m) => m.uploadKey === requestedModule)?.uploadKey ||
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
  const [atcStaged, setAtcStaged] = useState<StagedAtc | null>(null);
  const [fillHeaderMonths, setFillHeaderMonths] = useState(false);
  const [existingByFormat, setExistingByFormat] = useState<{ IA: string[]; IB: string[] }>({
    IA: [],
    IB: [],
  });
  const [cloudHost, setCloudHost] = useState('');
  const [storeMode, setStoreMode] = useState<'supabase' | 'local'>('local');
  const [nscReportDate, setNscReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [nscParseId, setNscParseId] = useState('');
  const [nscCloudJob, setNscCloudJob] = useState('');
  const [nscPreview, setNscPreview] = useState<{
    filename: string;
    report_date: string;
    remapped: boolean;
    total: number;
    ccc_count: number;
    three_phase?: number;
    by_queue: Record<string, number>;
    by_division: { key: string; count: number }[];
    by_quotation_slab: { key: string; count: number }[];
  } | null>(null);

  const meta = AUTH_MODULES.find((m) => m.uploadKey === module) || AUTH_MODULES[0];
  const allowed = canUploadModule(user, meta.id);
  const isAtc = module === 'atc';
  const isNsc = module === 'nsc';
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

  if (!allowedModules.length) {
    return (
      <div className="panel">
        <h2>Upload</h2>
        <p className="error">No upload permission. Ask an admin.</p>
      </div>
    );
  }

  const onAtcFiles = async (fileList: File[]) => {
    const incoming = [...fileList];
    if (!incoming.length) return;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const parsed: Parameters<typeof selectAtcCirculars>[0] = [];
      for (let i = 0; i < incoming.length; i += 1) {
        const file = incoming[i];
        setMessage(`Reading ${i + 1} of ${incoming.length} · ${file.name}`);
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (ext !== 'xlsx' && ext !== 'xls') {
          parsed.push({ filename: file.name, skipped: 'Not Excel (.xlsx / .xls)' });
          continue;
        }
        if (file.size > 12 * 1024 * 1024) {
          parsed.push({ filename: file.name, skipped: 'File too large to parse here' });
          continue;
        }
        try {
          const base64 = await fileToBase64(file);
          const res = await api.atcParse({ base64, filename: file.name });
          parsed.push({
            filename: file.name,
            lastModified: file.lastModified,
            period_label: res.period_label,
            rows: res.rows || [],
            filtered_out: res.filtered_out || 0,
          });
        } catch (e) {
          parsed.push({
            filename: file.name,
            error: e instanceof Error ? e.message : 'Could not read this workbook',
          });
        }
      }

      const selected = selectAtcCirculars(parsed);
      if (!selected.keep.length) {
        setAtcStaged(null);
        const why = selected.skip.slice(0, 4).map((s) => `${s.filename}: ${s.reason}`).join(' · ');
        setError(why || 'No AT&C circulars found in the files you dropped.');
        setMessage('');
        return;
      }

      const periodLabel =
        selected.periods.length > 1
          ? `${selected.periods[0]}–${selected.periods[selected.periods.length - 1]}`
          : selected.periods[0] || '';
      if (selected.periods.length) setPeriod(selected.periods[selected.periods.length - 1]);
      const usedNames = [...new Set(selected.keep.map((k) => k.filename))];
      const iaKeep = selected.keep.filter((k) => k.format !== 'IB');
      const filteredOut = parsed.reduce((n, f) => n + Number(f.filtered_out || 0), 0);
      setAtcStaged({
        filename: usedNames.length === 1 ? usedNames[0] : `${usedNames.length} circulars`,
        files: usedNames,
        keep: selected.keep,
        skip: selected.skip,
        rows: [...selected.achievementRows, ...selected.headerRows],
        achievementRows: selected.achievementRows,
        headerRows: selected.headerRows,
        months: [...selected.periods, ...selected.headerMonths],
        achievementMonths: selected.periods,
        headerMonths: selected.headerMonths,
        counts: selected.counts,
        filteredOut,
        periodLabel,
        divCount: iaKeep.reduce((n, k) => n + k.divCount, 0),
      });
      const parts = [
        `Keep ${selected.keep.length} circular${selected.keep.length === 1 ? '' : 's'} · ${periodLabel}`,
        selected.counts.IA ? `Excl. Bulk ${selected.counts.IA}` : null,
        selected.counts.IB ? `Incl. Bulk ${selected.counts.IB}` : null,
        selected.skip.length ? `${selected.skip.length} file${selected.skip.length === 1 ? '' : 's'} ignored` : null,
      ].filter(Boolean);
      setMessage(parts.join(' · '));
    } catch (e) {
      setAtcStaged(null);
      setError(e instanceof Error ? e.message : 'Failed to parse AT&C files');
    } finally {
      setBusy(false);
    }
  };

  const onGenericFile = async (file: File) => {
    setError('');
    setMessage('');
    setFilename(file.name);
    setBusy(true);
    try {
      if (module === 'atc') {
        const base64 = await fileToBase64(file);
        const parsed = await api.atcParse({ base64, filename: file.name });
        if (parsed.rows?.length) {
          const months = monthsFromRows(parsed.rows);
          if (parsed.period_label) setPeriod(parsed.period_label);
          setRows(parsed.rows);
          setMessage(
            `Parsed ${parsed.counts?.IA || 0} Incl. + ${parsed.counts?.IB || 0} Excl. · ${months.join(', ')}`
          );
          return;
        }
        setError('No ATC rows found in this workbook.');
        return;
      }

      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      setRows(json);
      setMessage(`Ready: ${json.length} rows`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read file');
    } finally {
      setBusy(false);
    }
  };

  const onNscFile = async (file: File) => {
    setError('');
    setMessage('');
    setNscParseId('');
    setNscCloudJob('');
    setNscPreview(null);
    setBusy(true);
    try {
      if (storeMode === 'supabase') {
        setMessage('Uploading workbook to storage…');
        const signed = await api.nscUploadUrl(file.name, nscReportDate);
        const putHeaders: Record<string, string> = { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' };
        if (signed.token) putHeaders.Authorization = `Bearer ${signed.token}`;
        const put = await fetch(signed.url, { method: 'PUT', body: file, headers: putHeaders });
        if (!put.ok) throw new Error(`Storage upload failed (${put.status})`);
        setMessage('Parsing workbook… this can take a minute for large SAP dumps.');
        const parsed = await api.nscImportParse(signed.job_id);
        setNscCloudJob(signed.job_id);
        setNscParseId(parsed.parse_id);
        const preview = parsed.preview as typeof nscPreview;
        setNscPreview(preview);
        const q = (preview?.by_queue || {}) as Record<string, number>;
        setMessage(
          `${Number(preview?.total || 0).toLocaleString('en-IN')} applications · pending ${q.pending || 0} · withheld ${q.withheld || 0} · 3-phase ${Number((preview as { three_phase?: number })?.three_phase || 0).toLocaleString('en-IN')}${
            preview?.remapped ? ' · remapped onto DRO 21 CCCs' : ''
          } · click Save to write in batches`
        );
        return;
      }
      setMessage('Parsing workbook… this can take a minute for large SAP dumps.');
      const parsed = await api.nscParse(file, nscReportDate);
      setNscParseId(parsed.parse_id);
      setNscPreview(parsed.preview);
      const q = parsed.preview.by_queue || {};
      setMessage(
        `${parsed.preview.total.toLocaleString('en-IN')} applications · pending ${q.pending || 0} · withheld ${q.withheld || 0} · 3-phase ${Number(parsed.preview.three_phase || 0).toLocaleString('en-IN')}${
          parsed.preview.remapped ? ' · remapped onto DRO 21 CCCs' : ''
        }`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse NSC file');
    } finally {
      setBusy(false);
    }
  };

  const commitNsc = async () => {
    if (!nscParseId) return;
    setBusy(true);
    setError('');
    try {
      if (nscCloudJob) {
        let upserted = 0;
        let total = nscPreview?.total || 0;
        let lastIndex = -1;
        let stall = 0;
        const maxTicks = Math.max(40, Math.ceil(Number(nscPreview?.total || 0) / 500) + 8);
        for (let n = 0; n < maxTicks; n += 1) {
          const r = await api.nscImportTick(nscCloudJob);
          const job = r.job || {};
          upserted = job.upserted || 0;
          total = job.total || total;
          const idx = Number(job.part_index) || 0;
          const parts = Number(job.part_count) || 0;
          setMessage(
            parts
              ? `Saving ${upserted.toLocaleString('en-IN')} / ${total.toLocaleString('en-IN')} (batch ${Math.min(idx, parts)}/${parts})…`
              : `Saving ${upserted.toLocaleString('en-IN')} / ${total.toLocaleString('en-IN')}…`
          );
          if (job.error) throw new Error(job.error);
          if (job.status === 'done' || (parts > 0 && idx >= parts)) break;
          if (idx === lastIndex) {
            stall += 1;
            if (stall >= 3) throw new Error('Save stalled — refresh and try again');
          } else {
            stall = 0;
            lastIndex = idx;
          }
        }
        setMessage(`Saved ${upserted.toLocaleString('en-IN')} pending NSC rows${cloudHost ? ` (${cloudHost})` : ''}`);
        setNscParseId('');
        setNscCloudJob('');
        setNscPreview(null);
      } else {
        const res = await api.nscCommit(nscParseId);
        const host = res.cloud?.host ? ` (${res.cloud.host})` : '';
        if (res.cloud?.persisted === false) {
          setMessage(`Saved ${res.upserted.toLocaleString('en-IN')} rows locally`);
          setError(res.cloud.error ? `Supabase upload failed: ${res.cloud.error}` : 'Supabase upload failed — data kept locally.');
        } else {
          setMessage(`Saved ${res.upserted.toLocaleString('en-IN')} pending NSC rows${host}`);
        }
        setNscParseId('');
        setNscPreview(null);
      }
      try {
        const b = await api.batches();
        setBatches(b.rows);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save NSC');
    } finally {
      setBusy(false);
    }
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
    const focus = atcStaged?.periodLabel || period;
    if (focus) {
      lines.push(
        atcStaged && atcStaged.keep.length > 1
          ? `Publish ${atcStaged.keep.length} circulars (${focus}) for Darjeeling Region.`
          : `Publish ${focus} for Darjeeling Region.`
      );
    }
    if (atcStaged?.keep.length) {
      for (const k of atcStaged.keep) {
        lines.push(`${k.period} · ${formatAtcBasis(k.format)} ← ${k.filename}`);
      }
    }
    for (const f of ['IA', 'IB'] as const) {
      if (!byFmt[f].length) continue;
      const overlap = byFmt[f].filter((m) => existingByFormat[f].includes(m));
      const fresh = byFmt[f].filter((m) => !existingByFormat[f].includes(m));
      const n = uploadRows.filter((r) => {
        const fmt = String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
        return fmt === f;
      }).length;
      lines.push(`${formatAtcBasis(f)}: ${n} offices · ${byFmt[f].join(', ')}`);
      if (overlap.length) lines.push(`  → Updates existing ${overlap.join(', ')}`);
      if (fresh.length) lines.push(`  → New: ${fresh.join(', ')}`);
    }
    if (atcStaged?.filteredOut) {
      lines.push(`${atcStaged.filteredOut} offices outside Darjeeling Region were skipped.`);
    }
    if (fillHeaderMonths && atcStaged?.headerMonths.length) {
      lines.push(
        `Also fill empty comparison months (${atcStaged.headerMonths.join(', ')}) — months that already have a full circular are left alone.`
      );
    } else if (atcStaged?.headerMonths.length) {
      lines.push(
        `Comparison months in the sheet (${atcStaged.headerMonths.join(', ')}) will not be written.`
      );
    }
    lines.push('Other months already stored will stay unchanged.');
    return lines;
  };

  const rowsToPublish = (existing: Record<string, unknown>[]) => {
    if (!atcStaged) return [];
    const map = new Map(existing.map((r) => [atcRowKey(r), r]));
    if (!fillHeaderMonths) return atcStaged.achievementRows;
    return atcStaged.rows.filter((r) => {
      if (!isHeaderPoint(r)) return true;
      return !isFullAchievement(map.get(atcRowKey(r)));
    });
  };

  const runUpload = async (uploadRows: Record<string, unknown>[], name: string) => {
    setBusy(true);
    setError('');
    try {
      if (isAtc) {
        const res = await api.upload(module, {
          rows: uploadRows,
          filename: name,
          period_label: period,
          fill_header_months: fillHeaderMonths,
        });
        const host = res.cloud?.host ? ` (${res.cloud.host})` : '';
        setMessage(`Published ${res.upserted} AT&C rows${host}`);
      } else {
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
            lastCloud.error ? `Supabase upload failed: ${lastCloud.error}` : 'Supabase upload failed — data kept locally.'
          );
        } else {
          setMessage(`Saved ${total} rows locally`);
        }
      }
      try {
        const b = await api.batches();
        setBatches(b.rows);
      } catch {
        /* session may have dropped after a long sync; upload itself already finished */
      }
      setRows([]);
      setFilename('');
      setAtcStaged(null);
      setPendingRows(null);
      setConfirmDiff([]);
      setConfirmOpen(false);
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Upload failed');
      const status = (err as Error & { status?: number }).status;
      if (status === 401) {
        setError('Session expired — log in again, then retry upload.');
      } else {
        setError(err.message || 'Upload failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const actionLabel = isAtc
    ? atcStaged?.keep.length
      ? atcStaged.keep.length > 1
        ? `Publish ${atcStaged.keep.length} circulars`
        : `Publish ${atcStaged.periodLabel}`
      : 'Publish'
    : storeMode === 'supabase'
      ? 'Upload to Supabase'
      : 'Save locally';
  const busyLabel = storeMode === 'supabase' ? 'Uploading…' : 'Saving…';
  const confirmActionLabel = actionLabel;

  const requestPublish = async () => {
    if (isAtc) {
      if (!atcStaged) return;
      setBusy(true);
      setError('');
      try {
        const needIA = atcStaged.counts.IA > 0;
        const needIB = atcStaged.counts.IB > 0;
        const [ia, ib] = await Promise.all([
          needIA ? api.atcQuery('format=IA') : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
          needIB ? api.atcQuery('format=IB') : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
        ]);
        const existing = [...(ia.rows || []), ...(ib.rows || [])];
        const combined = rowsToPublish(existing);
        if (!combined.length) {
          setError('Nothing to publish — choose a workbook first.');
          return;
        }
        const months = new Set(combined.map((r) => String(r.period_label || '')).filter(Boolean));
        const existingScoped = existing.filter((r) => months.has(String(r.period_label || '')));
        const diff = buildAtcDiff(combined, existingScoped);
        setPendingRows(combined);
        setPendingFilename(atcStaged.filename);
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
                setAtcStaged(null);
                setNscParseId('');
                setNscPreview(null);
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
            <button type="button" className="btn secondary" onClick={() => openGuide()}>
              Do &amp; Don’t
            </button>
          </div>
        </div>

        {!allowed && <p className="error">No upload permission for this database.</p>}

        {isAtc && allowed && (
          <div className="upload-atc">
            <p className="muted upload-atc-one">
              One dump zone — drop Excl. Bulk and Incl. Bulk together. The app sorts them.
            </p>
            <AtcDrop
              staged={atcStaged}
              busy={busy}
              onFiles={onAtcFiles}
              onClear={() => {
                setAtcStaged(null);
                setMessage('');
                setError('');
              }}
            />
            {atcStaged && (
              <>
                <div className="table-wrap upload-atc-keep">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Basis</th>
                        <th>From file</th>
                        <th>Offices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {atcStaged.keep.map((k) => (
                        <tr key={`${k.period}|${k.format}`}>
                          <td>{k.period}</td>
                          <td>{formatAtcBasis(k.format)}</td>
                          <td>{k.filename}</td>
                          <td>
                            {k.offices}
                            {k.warning ? <span className="muted"> · {k.warning}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {atcStaged.skip.filter((s) => !atcStaged.files.includes(s.filename)).length > 0 && (
                  <div className="upload-atc-skip">
                    <strong>Ignored</strong>
                    <ul>
                      {atcStaged.skip
                        .filter((s) => !atcStaged.files.includes(s.filename))
                        .map((s) => (
                          <li key={s.filename}>
                            <span>{s.filename}</span>
                            <span className="muted"> — {s.reason}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {atcStaged?.headerMonths.length ? (
              <label className="upload-atc-opt">
                <input
                  type="checkbox"
                  checked={fillHeaderMonths}
                  onChange={(e) => setFillHeaderMonths(e.target.checked)}
                />
                <span>
                  Also fill empty comparison months ({atcStaged.headerMonths.join(', ')}) — will not replace a month that
                  already has a full circular
                </span>
              </label>
            ) : null}
            <div className="upload-actions">
              <button type="button" className="btn" disabled={busy || !atcStaged} onClick={requestPublish}>
                {busy ? busyLabel : actionLabel}
              </button>
            </div>
          </div>
        )}

        {isNsc && allowed && (
          <div className="upload-nsc">
            <label className="upload-file-label">
              <span>Report date (as on)</span>
              <input type="date" value={nscReportDate} onChange={(e) => setNscReportDate(e.target.value)} />
            </label>
            <label className="upload-file-label">
              <span>Pending NSC file</span>
              <input
                type="file"
                accept=".xlsx,.xls,.xlsb,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onNscFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button type="button" className="btn" disabled={!nscParseId || busy} onClick={commitNsc}>
              {busy ? busyLabel : actionLabel}
            </button>
            {nscPreview && (
              <div className="nsc-preview muted">
                <p>
                  {nscPreview.filename} · {nscPreview.total.toLocaleString('en-IN')} rows · {nscPreview.ccc_count} CCCs
                  {nscPreview.three_phase
                    ? ` · 3-phase ${nscPreview.three_phase.toLocaleString('en-IN')}`
                    : ''}
                  {nscPreview.remapped ? ' · geography remapped to DRO' : ''}
                </p>
                <p>
                  {nscPreview.by_division.map((d) => `${d.key} ${d.count.toLocaleString('en-IN')}`).join(' · ')}
                </p>
              </div>
            )}
          </div>
        )}

        {!isAtc && !isNsc && allowed && (
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
              <h3>
                {isAtc
                  ? atcStaged?.periodLabel
                    ? `Review ${atcStaged.periodLabel} before publish`
                    : 'Review AT&C before publish'
                  : storeMode === 'supabase'
                    ? 'Review changes before upload'
                    : 'Review changes before save'}
              </h3>
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
                        <th>Basis</th>
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
                          <td>{r.format === 'IB' ? 'Incl.' : 'Excl.'}</td>
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

function AtcDrop({
  staged,
  busy,
  onFiles,
  onClear,
}: {
  staged: StagedAtc | null;
  busy: boolean;
  onFiles: (files: File[]) => void;
  onClear: () => void;
}) {
  return (
    <label
      className={`upload-slot upload-slot-wide ${staged ? 'has-file' : ''}${busy ? ' is-busy' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (busy) return;
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
    >
      <div className="upload-slot-top">
        <strong>{staged?.periodLabel ? `Publish ${staged.periodLabel}` : 'One drop — all AT&C files'}</strong>
        <span className="upload-slot-tag">Shift-select many files</span>
      </div>
      {staged ? (
        <div className="upload-slot-file">
          <span className="upload-slot-name">{staged.filename}</span>
          <span className="muted">
            {staged.keep.length} circular{staged.keep.length === 1 ? '' : 's'} kept
            {staged.skip.filter((s) => !staged.files.includes(s.filename)).length
              ? ` · ${staged.skip.filter((s) => !staged.files.includes(s.filename)).length} ignored`
              : ''}
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
        <span className="upload-slot-hint">
          Drop many Excel files, or browse and Shift-click a range — mixed months and extras are sorted automatically
        </span>
      )}
      <input
        type="file"
        accept=".xlsx,.xls"
        multiple
        disabled={busy}
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </label>
  );
}
