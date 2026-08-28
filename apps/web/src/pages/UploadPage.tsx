import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api, AUTH_MODULES, canUploadModule } from '../api';
import { useAuth } from '../auth';
import {
  buildCoverage,
  collapseIncoming,
  coverageCaption,
  filterAgainstStored,
  isDedicatedIbFilename,
  periodSortKey,
  pointSource,
  stripOrigin,
  type CoverageCell,
} from '../lib/atcMerge';

type StagedAtcFile = {
  filename: string;
  mtime: number;
  rows: Record<string, unknown>[];
  formats: string[];
  primary: { IA: string[]; IB: string[] };
  extra: { IA: string[]; IB: string[] };
  skippedSheets: string[];
  error?: string;
  filteredOut?: number;
};

type Guide = { title: string; dos: string[]; donts: string[] };

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

const GUIDE: Record<string, Guide> = {
  atc: {
    title: 'AT&C upload — Do & Don’t',
    dos: [
      'Drop any mix of Format-IA (CCC / Excl. Bulk) and Format-IB (Division / Incl. Bulk) files — one or many.',
      'Each file’s UPTO month is the real snapshot. YoY / March columns only fill months you have never uploaded.',
      'Re-drop a revised May’26 file to fix May’26 only. Other stored months stay.',
      'Statewide sheets are OK — only Zone 34 / Region 341 offices are kept.',
    ],
    donts: [
      'Don’t expect months missing from the dropped files to change.',
      'Don’t upload SAP/BO dumps (0ANALYSIS…) — use the Ph-1 workbooks.',
      'Don’t upload password-protected or scanned PDFs.',
    ],
  },
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
  source: 'achievement' | 'header_month';
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
          source: pointSource(neu),
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
        source: pointSource(neu),
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
    (m) =>
      m.id !== 'grievance' &&
      m.id !== 'field_notes' &&
      m.id !== 'powermap' &&
      canUploadModule(user, m.id)
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
  const [diffFilter, setDiffFilter] = useState<'change' | 'new' | 'fills' | 'all'>('change');
  const [pendingRows, setPendingRows] = useState<Record<string, unknown>[] | null>(null);
  const [pendingFilename, setPendingFilename] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedAtcFile[]>([]);
  const [existingAtc, setExistingAtc] = useState<Record<string, unknown>[]>([]);
  const [coverage, setCoverage] = useState<CoverageCell[]>([]);
  const [skippedDupes, setSkippedDupes] = useState(0);
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
        setExistingAtc([...(ia.rows || []), ...(ib.rows || [])]);
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

  const onAtcFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    setError('');
    setMessage('');
    setBusy(true);
    const added: StagedAtcFile[] = [];
    const errors: string[] = [];
    try {
      for (const file of incoming) {
        const already = stagedFiles.some((s) => s.filename === file.name) || added.some((s) => s.filename === file.name);
        if (already) continue;
        try {
          const base64 = await fileToBase64(file);
          const parsed = await api.atcParse({ base64, filename: file.name });
          const iaCount = parsed.counts?.IA || 0;
          const ibCount = parsed.counts?.IB || 0;
          const hybrid = iaCount > 0 && ibCount > 0;
          const dedicatedIb = isDedicatedIbFilename(file.name);
          const tagged = (parsed.rows || []).map((r) => ({
            ...r,
            _filename: file.name,
            _mtime: file.lastModified,
            _embedded: hybrid && !dedicatedIb && String(r.source_format || '').toUpperCase() === 'IB',
          }));
          added.push({
            filename: file.name,
            mtime: file.lastModified,
            rows: tagged,
            formats: parsed.formats || [
              ...(iaCount ? ['IA'] : []),
              ...(ibCount ? ['IB'] : []),
            ],
            primary: parsed.primary_months || { IA: [], IB: [] },
            extra: parsed.extra_months || { IA: [], IB: [] },
            skippedSheets: parsed.skipped_sheets || [],
            error: parsed.ok === false || parsed.error ? parsed.error || 'No Format-IA/IB sheet found' : undefined,
            filteredOut: parsed.filtered_out,
          });
          if (parsed.period_label) setPeriod(parsed.period_label);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to parse';
          added.push({
            filename: file.name,
            mtime: file.lastModified,
            rows: [],
            formats: [],
            primary: { IA: [], IB: [] },
            extra: { IA: [], IB: [] },
            skippedSheets: [],
            error: msg,
          });
          errors.push(`${file.name}: ${msg}`);
        }
      }
      setStagedFiles((prev) => [...prev, ...added]);
      const okFiles = added.filter((f) => !f.error);
      const failFiles = added.filter((f) => f.error);
      const okMsg = okFiles.length
        ? `Parsed ${okFiles.length} file${okFiles.length === 1 ? '' : 's'}`
        : '';
      const failMsg = failFiles.length
        ? `${failFiles.length} file${failFiles.length === 1 ? '' : 's'} failed`
        : '';
      setMessage([okMsg, failMsg].filter(Boolean).join(' · '));
      if (errors.length && !okFiles.length) setError(errors[0]);
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

  const buildConfirmLines = (cells: CoverageCell[], skipped: number, fileErrors: number) => {
    return [coverageCaption(cells, skipped, fileErrors), 'Months not in these files stay unchanged.'];
  };

  const prepareIncoming = () => {
    const tagged = stagedFiles.flatMap((f) => (f.error ? [] : f.rows));
    const collapsed = collapseIncoming(tagged);
    const against = filterAgainstStored(collapsed.rows, existingAtc);
    const cells = buildCoverage(against.rows, existingAtc, against.skippedHeader);
    return { collapsed, against, cells };
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
          period_label: isAtc
            ? [
                ...new Set(
                  uploadRows
                    .filter((r) => pointSource(r) === 'achievement')
                    .map((r) => String(r.period_label || ''))
                    .filter(Boolean)
                ),
              ]
                .sort((a, b) => periodSortKey(a).localeCompare(periodSortKey(b)))
                .join(', ')
                .slice(0, 220) || period
            : period,
        });
        total += res.upserted;
        lastCloud = res.cloud;
      }
      if (isAtc && coverage.length) {
        const failN = stagedFiles.filter((f) => f.error).length;
        const dest =
          lastCloud?.persisted && (lastCloud.host || storeMode === 'supabase')
            ? `Uploaded to Supabase${lastCloud.host ? ` (${lastCloud.host})` : ''}`
            : 'Saved locally';
        setMessage(`${dest}. ${coverageCaption(coverage, skippedDupes, failN)} ${total} rows written.`);
        if (storeMode === 'supabase' && lastCloud && !lastCloud.persisted) {
          setError(
            lastCloud.error
              ? `Supabase upload failed: ${lastCloud.error}`
              : 'Supabase upload failed — data kept locally. Run 005_atc_expand.sql if this is AT&C.'
          );
        }
      } else if (lastCloud?.persisted && (lastCloud.host || storeMode === 'supabase')) {
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
      setStagedFiles([]);
      setPendingRows(null);
      setConfirmDiff([]);
      setCoverage([]);
      setSkippedDupes(0);
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
      const okFiles = stagedFiles.filter((f) => !f.error && f.rows.length);
      if (!okFiles.length) return;
      const name = stagedFiles.map((f) => f.filename).join(' + ');
      setBusy(true);
      setError('');
      try {
        const { collapsed, against, cells } = prepareIncoming();
        const publishRows = against.rows.map(stripOrigin);
        if (!publishRows.length) {
          setError('Nothing to write — comparison columns would not overwrite stored full months.');
          return;
        }
        const diff = buildAtcDiff(publishRows, existingAtc);
        setPendingRows(publishRows);
        setPendingFilename(name);
        setCoverage(cells);
        setSkippedDupes(collapsed.skipped.length);
        setConfirmLines(buildConfirmLines(cells, collapsed.skipped.length, stagedFiles.filter((f) => f.error).length));
        setConfirmDiff(diff.rows);
        setDiffSummary({
          newOffices: diff.newOffices,
          changedOffices: diff.changedOffices,
          unchangedOffices: diff.unchangedOffices,
        });
        const hasAchChange = diff.rows.some((r) => r.kind === 'change' && r.source === 'achievement');
        const hasAchNew = diff.rows.some((r) => r.kind === 'new' && r.source === 'achievement');
        setDiffFilter(hasAchChange ? 'change' : hasAchNew ? 'new' : 'fills');
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
    if (diffFilter === 'fills') return confirmDiff.filter((r) => r.source === 'header_month');
    return confirmDiff.filter((r) => r.kind === diffFilter && r.source === 'achievement');
  }, [confirmDiff, diffFilter]);

  const clearStagedFile = (filename: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.filename !== filename));
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
                setStagedFiles([]);
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
            <AtcDropTray busy={busy} hasFiles={stagedFiles.length > 0} onFiles={onAtcFiles} />
            {stagedFiles.length > 0 && (
              <ul className="upload-file-list">
                {stagedFiles.map((f) => (
                  <li key={f.filename} className={f.error ? 'is-error' : ''}>
                    <div className="upload-file-meta">
                      <strong>{f.filename}</strong>
                      <span className="muted">
                        {f.error
                          ? f.error
                          : `${f.formats.join('+') || '—'} · ${(f.primary.IA[0] || f.primary.IB[0] || '—')}${
                              f.rows.length ? ` · ${f.rows.length} rows` : ''
                            }`}
                      </span>
                    </div>
                    <button type="button" className="linkish" onClick={() => clearStagedFile(f.filename)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="upload-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || !stagedFiles.some((f) => !f.error && f.rows.length)}
                onClick={requestPublish}
              >
                {busy ? busyLabel : actionLabel}
              </button>
              {stagedFiles.length > 0 && (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => {
                    setStagedFiles([]);
                    setMessage('');
                    setError('');
                  }}
                >
                  Clear all
                </button>
              )}
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
                <th>Months</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {batches.slice(0, 12).map((b) => (
                <tr key={String(b.id)}>
                  <td>{String(b.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                  <td>{String(b.module)}</td>
                  <td>{String(b.filename || '—')}</td>
                  <td>{String(b.period_label || b.notes || '—')}</td>
                  <td>{String(b.row_count)}</td>
                </tr>
              ))}
              {!batches.length && (
                <tr>
                  <td colSpan={5} className="muted">
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
                <CoverageCalendar cells={coverage} />
                <div className="upload-diff-summary">
                  <span>{diffSummary.changedOffices} offices with changes</span>
                  <span>{diffSummary.newOffices} new</span>
                  <span>{diffSummary.unchangedOffices} unchanged</span>
                  <span>
                    {confirmDiff.filter((r) => r.kind === 'change' && r.source === 'achievement').length}{' '}
                    field mismatches
                  </span>
                </div>
                <div className="upload-diff-filters">
                  {(
                    [
                      ['change', 'Mismatch'],
                      ['new', 'New'],
                      ['fills', 'Comparison fills'],
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
                              ? 'No mismatches on full months — values match stored data.'
                              : diffFilter === 'fills'
                                ? 'No comparison-column fills in this batch.'
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

function AtcDropTray({
  busy,
  hasFiles,
  onFiles,
}: {
  busy: boolean;
  hasFiles: boolean;
  onFiles: (files: FileList | File[]) => void;
}) {
  return (
    <label className={`upload-slot upload-tray ${hasFiles ? 'has-file' : ''}`}>
      <div className="upload-slot-top">
        <strong>AT&amp;C workbooks</strong>
        <span className="upload-slot-tag">IA + IB · any months</span>
      </div>
      <span className="upload-slot-hint">
        {busy ? 'Parsing…' : 'Drop one or many Excel files, or click to browse'}
      </span>
      <input
        type="file"
        accept=".xlsx,.xls,.xlsb"
        multiple
        disabled={busy}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function CoverageCalendar({ cells }: { cells: CoverageCell[] }) {
  if (!cells.length) return null;
  const formats: Array<'IA' | 'IB'> = ['IA', 'IB'];
  return (
    <div className="upload-coverage">
      <div className="upload-coverage-legend">
        <span className="upload-cov upload-cov-new">New full</span>
        <span className="upload-cov upload-cov-replace">Replace full</span>
        <span className="upload-cov upload-cov-fill">Fill only</span>
        <span className="upload-cov upload-cov-skip">Won’t overwrite</span>
      </div>
      {formats.map((fmt) => {
        const row = cells.filter((c) => c.format === fmt);
        if (!row.length) return null;
        return (
          <div key={fmt} className="upload-coverage-row">
            <div className="upload-coverage-fmt">{fmt === 'IA' ? 'With CCC' : 'Without CCC'}</div>
            <div className="upload-coverage-grid">
              {row.map((c) => (
                <span
                  key={`${c.format}|${c.period}`}
                  className={`upload-cov upload-cov-${c.action}`}
                  title={`${c.period} ${c.format}: ${c.action} (stored ${c.stored}, incoming ${c.incoming})`}
                >
                  {String(c.period).replace("'", '')}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
