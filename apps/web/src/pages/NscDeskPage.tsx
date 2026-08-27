import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, canUploadModule } from '../api';
import { useAuth } from '../auth';
import {
  CUM_COLORS,
  NSC_CUMULATIVE,
  NSC_SLABS,
  SLAB_COLORS,
  buildWithheldTimeline,
  customCutFill,
  encodeCutsParam,
  fmtDay,
  fmtInt,
  loadCustomDelayCuts,
  monthOfIso,
  yearOfIso,
  makeCustomCut,
  mergeDelayCuts,
  saveCustomDelayCuts,
  type DelayCut,
  type DelayOp,
  type NscClock,
  type NscQueue,
  type NscRow,
  poleLabel,
  procedureLabel,
} from '../lib/nsc';
import { NSC_NO_AGENCY, buildNscDesk, nscEventOn, overlayNscOffices, type NscChartRow, type NscDeskQuery } from '../lib/nscDesk';
import { nscCacheBindUser, nscCacheGetQueue, nscQueueMemGet } from '../lib/nscCache';
import {
  nscFollowupsAdd,
  nscFollowupsBindUser,
  nscFollowupsIndex,
  nscFollowupsList,
  nscFollowupsPrune,
  nscFollowupsRemove,
  type NscFollowup,
  type NscFollowupMeta,
} from '../lib/nscFollowups';
import { ensureNscQueue, prefetchNscQueue, warmNscStamp, type NscQueueSnap } from '../lib/nscQueue';
import { usePageHeading } from '../lib/pageHeading';
import {
  countClasses,
  countPoles,
  countProcs,
  facetRows,
  stackOffices,
  summarizeBy,
  summarizeOffices,
  summarizeRanges,
  sumFooter,
  type NscSumRow,
  type OfficeGrain,
} from '../lib/nscOverview';

const PAGE = 80;
// chart heights cap themselves against the viewport so a desk keeps to one screen
const CHART_H = 'min(320px, 32vh)';
// withheld leads with its timeline, so the office chart there gives height back to it
const HELD_CHART_H = 'min(250px, 25vh)';
const DELAY_H = 'min(230px, 26vh)';
const TIMELINE_H = 'min(310px, 34vh)';
const DIV_PALETTE = ['#1565c0', '#039be5', '#00838f', '#7c4dff', '#ef6c00', '#c62828'];
const TOOLTIP_STYLE = {
  background: '#ffffff',
  border: '1px solid rgba(30,64,120,0.12)',
  borderRadius: 12,
  color: '#1e293b',
};

type NscDesk = Awaited<ReturnType<typeof api.nscDesk>>;
type DeskView = 'overview' | 'table';
type TableGrain = 'division' | 'ccc' | 'age' | 'class' | 'work' | 'agency' | 'time' | 'reason' | 'followups' | 'cases';
type DelayBand = 'exclusive' | 'cumulative';
type TimelineGrain = 'month' | 'year';
type TimelineSeries = 'office' | 'total';

function qsOf(p: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

function rowDays(row: { quotation_age_days: number | null; processing_days: number | null }, clock: NscClock) {
  return clock === 'processing' ? row.processing_days : row.quotation_age_days;
}

function workKind(row: { pole_count: number | null }) {
  if (row.pole_count == null) return 'unknown';
  return Number(row.pole_count) > 0 ? 'pole' : 'non_pole';
}

function ageTone(days: number | null) {
  if (days == null) return '';
  if (days >= 365) return 'nsc-age-year';
  if (days >= 180) return 'nsc-age-critical';
  if (days >= 31) return 'nsc-age-hot';
  return '';
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function timePhrase(key: string) {
  if (!key) return '';
  if (key.length === 4) return key;
  const month = Number(key.slice(5, 7));
  const year = key.slice(0, 4);
  if (month >= 1 && month <= 12) return `${MONTH_NAMES[month - 1]} ${year}`;
  return key;
}

const TABLE_GRAINS_PENDING: { id: TableGrain; label: string }[] = [
  { id: 'division', label: 'Division' },
  { id: 'ccc', label: 'CCC' },
  { id: 'age', label: 'Age' },
  { id: 'class', label: 'Class' },
  { id: 'work', label: 'Work' },
  { id: 'agency', label: 'Agency' },
  { id: 'cases', label: 'Cases' },
  { id: 'followups', label: 'My follow-up' },
];

const TABLE_GRAINS_HELD: { id: TableGrain; label: string }[] = [
  { id: 'division', label: 'Division' },
  { id: 'ccc', label: 'CCC' },
  { id: 'time', label: 'Year' },
  { id: 'class', label: 'Class' },
  { id: 'work', label: 'Work' },
  { id: 'agency', label: 'Agency' },
  { id: 'reason', label: 'Reason' },
  { id: 'cases', label: 'Cases' },
  { id: 'followups', label: 'My follow-up' },
];

const AGENCY_NONE_LABEL = 'WO not issued';

function hasAgency(name?: string | null) {
  return Boolean(String(name || '').trim());
}

function AgencyCell({ name }: { name?: string | null }) {
  if (hasAgency(name)) return <>{String(name).trim()}</>;
  return <span className="nsc-agency-none">{AGENCY_NONE_LABEL}</span>;
}

type SortDir = 'asc' | 'desc';
type Sort<K extends string> = { key: K; dir: SortDir } | null;

/** Cycles a column through its first direction, the opposite, then back to the natural order. */
function nextSort<K extends string>(current: Sort<K>, key: K, first: SortDir): Sort<K> {
  if (!current || current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
  return null;
}

function SortTh<K extends string>({
  label,
  col,
  sort,
  onSort,
  num,
  first = 'desc',
}: {
  label: string;
  col: K;
  sort: Sort<K>;
  onSort: (key: K, first: SortDir) => void;
  num?: boolean;
  first?: SortDir;
}) {
  const on = sort?.key === col;
  return (
    <th className={num ? 'num' : undefined} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`nsc-sort${on ? ' on' : ''}`} onClick={() => onSort(col, first)}>
        {label}
        <i aria-hidden="true">{on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</i>
      </button>
    </th>
  );
}

type SumSortKey = 'label' | 'count' | 'non_pole' | 'pole' | 'industrial' | 'proc_b' | 'hot' | 'avg_days';

type CaseSortKey =
  | 'app'
  | 'division'
  | 'ccc'
  | 'class'
  | 'work'
  | 'age'
  | 'collected'
  | 'agency'
  | 'withheld'
  | 'reason';

function NscSumTable({
  label,
  rows,
  total,
  selected,
  pending,
  keepEmpty,
  showTotal = true,
  customKeys,
  warnKey,
  onPick,
}: {
  label: string;
  rows: NscSumRow[];
  total: number;
  selected?: string;
  pending?: boolean;
  keepEmpty?: boolean;
  showTotal?: boolean;
  customKeys?: Set<string>;
  warnKey?: string;
  onPick: (row: NscSumRow) => void;
}) {
  const [sort, setSort] = useState<Sort<SumSortKey>>(null);
  const foot = sumFooter(customKeys ? rows.filter((r) => !customKeys.has(r.key)) : rows, total);
  const show = useMemo(() => {
    const base = keepEmpty ? rows : rows.filter((r) => r.count > 0);
    if (!sort) return base;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sort.key === 'label') return a.label.localeCompare(b.label) * dir;
      const av = sort.key === 'avg_days' ? a.avg_days ?? -1 : a[sort.key];
      const bv = sort.key === 'avg_days' ? b.avg_days ?? -1 : b[sort.key];
      return (Number(av) - Number(bv)) * dir;
    });
  }, [rows, keepEmpty, sort]);
  const onSort = (key: SumSortKey, first: SortDir) => setSort((prev) => nextSort(prev, key, first));
  const cols = pending ? 10 : 9;
  return (
    <div className="table-wrap nsc-table-wrap">
      <table className="nsc-detail nsc-summary">
        <thead>
          <tr>
            <th className="num nsc-sl">#</th>
            <SortTh label={label} col="label" sort={sort} onSort={onSort} first="asc" />
            <SortTh label="Cases" col="count" sort={sort} onSort={onSort} num />
            <th className="num">%</th>
            <SortTh label="Non-pole" col="non_pole" sort={sort} onSort={onSort} num />
            <SortTh label="Pole" col="pole" sort={sort} onSort={onSort} num />
            <SortTh label="Ind" col="industrial" sort={sort} onSort={onSort} num />
            <SortTh label="Proc-B" col="proc_b" sort={sort} onSort={onSort} num />
            {pending ? <SortTh label=">30d" col="hot" sort={sort} onSort={onSort} num /> : null}
            <SortTh label="Avg d" col="avg_days" sort={sort} onSort={onSort} num />
          </tr>
        </thead>
        <tbody>
          {show.map((r, i) => (
            <tr
              key={r.key}
              className={selected === r.key ? 'on' : ''}
              onClick={() => onPick(r)}
            >
              <td className="num nsc-sl">{i + 1}</td>
              <td className={warnKey && r.key === warnKey ? 'nsc-agency-none' : undefined}>
                {r.label}
                {customKeys?.has(r.key) ? <span className="nsc-sum-tag">custom</span> : null}
              </td>
              <td className="num">{fmtInt(r.count)}</td>
              <td className="num">{r.pct}%</td>
              <td className="num">{fmtInt(r.non_pole)}</td>
              <td className="num">{fmtInt(r.pole)}</td>
              <td className="num">{fmtInt(r.industrial)}</td>
              <td className="num">{fmtInt(r.proc_b)}</td>
              {pending ? <td className="num">{fmtInt(r.hot)}</td> : null}
              <td className="num">{r.avg_days ?? '—'}</td>
            </tr>
          ))}
          {!show.length && (
            <tr>
              <td colSpan={cols} className="muted">
                None in this filter
              </td>
            </tr>
          )}
        </tbody>
        {showTotal && show.length > 1 ? (
          <tfoot>
            <tr>
              <td className="num nsc-sl" />
              <td>Total</td>
              <td className="num">{fmtInt(foot.count)}</td>
              <td className="num">100%</td>
              <td className="num">{fmtInt(foot.non_pole)}</td>
              <td className="num">{fmtInt(foot.pole)}</td>
              <td className="num">{fmtInt(foot.industrial)}</td>
              <td className="num">{fmtInt(foot.proc_b)}</td>
              {pending ? <td className="num">{fmtInt(foot.hot)}</td> : null}
              <td className="num">{foot.avg_days ?? '—'}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function useBoxWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return { ref: setNode, width };
}

/** Two-column overview + one-screen desk. Phone/stacked layouts keep document scroll. */
function useWideOverview(minWidth = 1100) {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(`(min-width: ${minWidth}px)`).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [minWidth]);
  return wide;
}

function usePresentMode() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = document.querySelector('.app-shell');
    if (!el) return;
    const read = () => setOn(el.getAttribute('data-present') === 'on');
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['data-present'] });
    return () => mo.disconnect();
  }, []);
  return on;
}

function chartFont(width: number, present: boolean) {
  if (!width) return present ? 15 : 11;
  if (present) return Math.round(Math.min(21, Math.max(14, width / 46)));
  return Math.round(Math.min(15, Math.max(10, width / 62)));
}

function maxDigitsOf(values: number[]) {
  let max = 1;
  for (const v of values) max = Math.max(max, fmtInt(Math.round(v || 0)).length);
  return max;
}

/** Squeeze an office name into `max` characters: initials first, then a clean truncation. */
function shortName(name: string, max: number) {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const words = clean.split(' ').filter(Boolean);
  if (words.length > 1) {
    const initials = words.map((w) => w[0]).join('').toUpperCase();
    if (initials.length >= 2 && initials.length <= max) return initials;
  }
  return clean.slice(0, max);
}

/** Reserve room for the widest tick label so present-mode fonts are never clipped. */
function axisWidth(font: number, values: number[]) {
  const top = values.reduce((m, v) => Math.max(m, Math.round(v || 0)), 0);
  const chars = maxDigitsOf([top, top * 1.15]);
  return Math.max(40, Math.round(chars * font * 0.66) + 16);
}

type ValueLabels = {
  show: boolean;
  rotate: boolean;
  font: number;
  top: number;
  offset: number;
};

function planLabels(width: number, values: number[], present: boolean): ValueLabels {
  const font = chartFont(width, present);
  const count = values.length;
  const digits = maxDigitsOf(values);
  const text = digits * font * 0.62;
  const off = { show: false, rotate: false, font, top: 8, offset: 6 };
  if (!width || !count) return off;
  const slot = width / count;
  if (slot >= text + 10) return { show: true, rotate: false, font, top: font + 12, offset: 6 };
  if (slot >= font + 3) return { show: true, rotate: true, font, top: text + 16, offset: text / 2 + 6 };
  return off;
}

function labelProps(plan: ValueLabels) {
  return {
    position: 'top' as const,
    fill: '#334155',
    fontSize: plan.font,
    fontWeight: 600,
    offset: plan.offset,
    angle: plan.rotate ? -90 : 0,
    formatter: (v: unknown) => {
      const n = Number(v ?? 0);
      return n ? fmtInt(n) : '';
    },
  };
}

function NscSkeleton() {
  return (
    <div className="nsc-skel" aria-busy="true" aria-live="polite">
      <div className="nsc-skel-kpis">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="nsc-skel-kpi nsc-skel-pulse" />
        ))}
      </div>
      <div className="nsc-skel-pills">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="nsc-skel-pill nsc-skel-pulse" />
        ))}
      </div>
      <div className="nsc-skel-chart nsc-skel-pulse" />
    </div>
  );
}

function CaseField({ label, value }: { label: string; value: ReactNode }) {
  const empty = value == null || value === '' || value === '—';
  return (
    <div className={`nsc-case-field${empty ? ' empty' : ''}`}>
      <span>{label}</span>
      <strong>{empty ? '—' : value}</strong>
    </div>
  );
}

function fmtSeen(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return fmtDay(iso.slice(0, 10));
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtRelative(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return fmtSeen(iso);
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtSeen(iso);
}

function NscCaseSheet({
  row,
  clock,
  onClose,
  onNotesChange,
}: {
  row: NscChartRow;
  clock: NscClock;
  onClose: () => void;
  onNotesChange?: () => void;
}) {
  const age = rowDays(row, clock);
  const work = workKind(row);
  const held = String(row.status).toLowerCase() === 'withheld';
  const title = row.consumer_name?.trim() || row.application_no || 'Consumer';
  const appNo = String(row.application_no || '').trim();
  const [notes, setNotes] = useState<NscFollowup[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const timelineSteps = useMemo(
    () =>
      [
        { label: 'First in DRO', date: row.first_seen_on },
        { label: 'Applied', date: row.created_on || null },
        { label: 'Quotation', date: row.quotation_issue_on },
        { label: 'Collected', date: row.collected_on },
        ...(held ? [{ label: 'Withheld', date: row.withheld_on }] : []),
      ].filter((s) => s.date),
    [row, held],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    draftRef.current?.focus();
  }, [appNo]);

  useEffect(() => {
    let live = true;
    nscFollowupsList(appNo).then((items) => {
      if (live) setNotes(items);
    });
    return () => {
      live = false;
    };
  }, [appNo]);

  const addNote = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      const next = await nscFollowupsAdd(appNo, draft);
      setNotes(next);
      setDraft('');
      onNotesChange?.();
      draftRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (id: string) => {
    const next = await nscFollowupsRemove(appNo, id);
    setNotes(next);
    onNotesChange?.();
  };

  const onDraftKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void addNote();
    }
  };

  return (
    <div className="nsc-case-back" role="presentation" onClick={onClose}>
      <div
        className={`nsc-case-sheet${held ? ' held' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nsc-case-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={`nsc-case-hero${held ? ' held' : ''}`}>
          <div className="nsc-case-hero-text">
            <p className="nsc-case-kicker">{held ? 'Withheld NSC' : 'Pending NSC'}</p>
            <h3 id="nsc-case-title">{title}</h3>
            <div className="nsc-case-chips">
              {appNo ? <span className="nsc-case-chip">{appNo}</span> : null}
              {row.consumer_class ? <span className="nsc-case-chip">{row.consumer_class}</span> : null}
              {age != null ? (
                <span className={`nsc-case-chip nsc-case-chip-age ${ageTone(age)}`}>{fmtInt(age)} days</span>
              ) : null}
              {row.consumer_id ? <span className="nsc-case-chip muted">ID {row.consumer_id}</span> : null}
            </div>
          </div>
          <div className="nsc-case-hero-actions">
            {row.phone ? (
              <a className="nsc-case-call" href={`tel:${row.phone}`} onClick={(e) => e.stopPropagation()}>
                Call {row.phone}
              </a>
            ) : null}
            <button type="button" className="nsc-case-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className="nsc-case-body">
          <aside className="nsc-case-aside nsc-case-followups">
            <div className="nsc-case-fu-head">
              <div>
                <h4>My follow-up</h4>
                <p className="nsc-case-local-hint">Saved on this device · cleared when case leaves queue</p>
              </div>
              {notes.length ? <em className="nsc-fu-badge">{notes.length}</em> : null}
            </div>

            <div className="nsc-case-follow-composer">
              <textarea
                ref={draftRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onDraftKey}
                rows={4}
                placeholder="What did you check? Who did you speak to? What is the next step?"
                aria-label="Follow-up note"
              />
              <div className="nsc-case-follow-actions">
                <span className="nsc-case-fu-hint">Ctrl+Enter to save</span>
                <button type="button" className="btn nsc-case-fu-btn" disabled={!draft.trim() || saving} onClick={addNote}>
                  {saving ? 'Saving…' : 'Log follow-up'}
                </button>
              </div>
            </div>

            {notes.length ? (
              <ol className="nsc-case-follow-timeline" aria-label="Follow-up history">
                {[...notes].reverse().map((n, i) => (
                  <li key={n.id} className={i === 0 ? 'latest' : ''}>
                    <div className="nsc-case-fu-dot" aria-hidden />
                    <div className="nsc-case-fu-card">
                      <div className="nsc-case-fu-meta">
                        <time dateTime={n.at} title={fmtSeen(n.at)}>
                          {fmtRelative(n.at)}
                        </time>
                        {i === 0 ? <span className="nsc-case-fu-latest">Latest</span> : null}
                      </div>
                      <p>{n.text}</p>
                      <button
                        type="button"
                        className="nsc-case-follow-del"
                        aria-label="Delete note"
                        onClick={() => removeNote(n.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="nsc-case-fu-empty">
                <p>No follow-ups logged yet.</p>
                <p className="muted">Use the box above to record calls, site visits, or next actions.</p>
              </div>
            )}
          </aside>

          <div className="nsc-case-main">
            <div className="nsc-case-stats">
              <div className={`nsc-case-stat${age != null ? ` ${ageTone(age)}` : ''}`}>
                <span>Age</span>
                <strong>{age != null ? `${fmtInt(age)}d` : '—'}</strong>
                <small>{clock === 'processing' ? 'Processing' : 'Quotation'}</small>
              </div>
              <div className="nsc-case-stat">
                <span>Work</span>
                <strong>{poleLabel(work, row.pole_count)}</strong>
                <small>{procedureLabel(row.procedure, row.applicant_type) || '—'}</small>
              </div>
              <div className="nsc-case-stat">
                <span>Office</span>
                <strong>{row.ccc_name || row.ccc_code || '—'}</strong>
                <small>{row.division_name || row.division_code || '—'}</small>
              </div>
              <div className="nsc-case-stat">
                <span>Agency</span>
                <strong className={hasAgency(row.agency_name) ? undefined : 'nsc-agency-none'}>
                  {hasAgency(row.agency_name) ? row.agency_name : AGENCY_NONE_LABEL}
                </strong>
                <small>{row.wo_no ? `WO ${row.wo_no}` : 'No work order'}</small>
              </div>
            </div>

            {timelineSteps.length ? (
              <div className="nsc-case-milestones" aria-label="Case timeline">
                {timelineSteps.map((s, i) => (
                  <div key={s.label} className="nsc-case-milestone">
                    {i > 0 ? <span className="nsc-case-mile-line" aria-hidden /> : null}
                    <span className="nsc-case-mile-dot" aria-hidden />
                    <span className="nsc-case-mile-label">{s.label}</span>
                    <time dateTime={String(s.date)}>{fmtDay(String(s.date))}</time>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="nsc-case-panels">
              <section className="nsc-case-panel">
                <h4>Consumer</h4>
                <div className="nsc-case-grid">
                  <CaseField label="Name" value={row.consumer_name} />
                  <CaseField label="Phone" value={row.phone} />
                  <CaseField label="Class" value={row.consumer_class} />
                  <CaseField label="Applicant" value={row.applicant_type} />
                </div>
              </section>

              <section className="nsc-case-panel">
                <h4>Connection</h4>
                <div className="nsc-case-grid">
                  <CaseField label="SAP / stage" value={row.sap_status || row.stage} />
                  <CaseField label="Procedure" value={procedureLabel(row.procedure, row.applicant_type)} />
                  <CaseField label="Report date" value={fmtDay(row.report_date)} />
                  <CaseField label="First in DRO" value={fmtSeen(row.first_seen_on)} />
                </div>
              </section>
            </div>

            {held && row.withheld_reason?.trim() ? (
              <div className="nsc-case-alert held">
                <strong>Withheld reason</strong>
                <p>{row.withheld_reason.trim()}</p>
                {row.withheld_on ? <time dateTime={row.withheld_on}>{fmtDay(row.withheld_on)}</time> : null}
              </div>
            ) : null}

            {row.remarks?.trim() ? (
              <div className="nsc-case-alert">
                <strong>File remarks</strong>
                <p>{row.remarks.trim()}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NscDeskPage() {
  const { user } = useAuth();
  const canUpload = canUploadModule(user, 'nsc');
  const present = usePresentMode();
  const role = String(user?.role || '').toLowerCase();
  const canPickAllOffices = role === 'admin' || role === 'region';
  const lockedDiv = !canPickAllOffices ? String(user?.division_code || '').trim() : '';
  const lockedCcc = !canPickAllOffices ? String(user?.ccc_code || '').trim() : '';
  const [queueSnap, setQueueSnap] = useState<NscQueueSnap | null>(() => nscQueueMemGet('pending'));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => !nscQueueMemGet('pending'));
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [queue, setQueue] = useState<NscQueue>('pending');
  const clock: NscClock = 'quotation';
  const [view, setView] = useState<DeskView>('overview');
  const [tableGrain, setTableGrain] = useState<TableGrain>(lockedCcc ? 'ccc' : 'division');
  const [officeGrain, setOfficeGrain] = useState<OfficeGrain>(lockedCcc ? 'ccc' : 'division');
  const [officeSlabs, setOfficeSlabs] = useState(false);
  const [division, setDivision] = useState(lockedDiv);
  const [ccc, setCcc] = useState(lockedCcc);
  const [klass, setKlass] = useState('');
  const [pole, setPole] = useState('');
  const [poleMin, setPoleMin] = useState<number | ''>('');
  const [poleMax, setPoleMax] = useState<number | ''>('');
  const [procedure, setProcedure] = useState('');
  const [agency, setAgency] = useState('');
  const [slab, setSlab] = useState('');
  const [band, setBand] = useState<DelayBand>('exclusive');
  const [cumId, setCumId] = useState('');
  const [delayMin, setDelayMin] = useState<number | ''>('');
  const [delayMax, setDelayMax] = useState<number | ''>('');
  const [customOp, setCustomOp] = useState<DelayOp>('gt');
  const [customA, setCustomA] = useState(45);
  const [customB, setCustomB] = useState(90);
  const [customCuts, setCustomCuts] = useState<DelayCut[]>([]);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [caseSort, setCaseSort] = useState<Sort<CaseSortKey>>(null);
  const [caseRow, setCaseRow] = useState<NscChartRow | null>(null);
  const [followupIndex, setFollowupIndex] = useState<Map<string, NscFollowupMeta>>(() => new Map());
  const [followupTick, setFollowupTick] = useState(0);
  const [timeKey, setTimeKey] = useState('');
  const [reasonPick, setReasonPick] = useState('');
  const [tlGrain, setTlGrain] = useState<TimelineGrain>('year');
  const [tlSeries, setTlSeries] = useState<TimelineSeries>('office');
  const [tlRunning, setTlRunning] = useState(true);
  const deskReq = useRef(0);
  const cutStoreKey = `dro.nsc.delayCuts.${user?.username || 'local'}`;

  useEffect(() => {
    setCustomCuts(loadCustomDelayCuts(cutStoreKey));
  }, [cutStoreKey]);

  useEffect(() => {
    nscCacheBindUser(user?.username);
    nscFollowupsBindUser(user?.username);
  }, [user?.username]);

  useEffect(() => {
    let live = true;
    nscFollowupsIndex().then((idx) => {
      if (live) setFollowupIndex(idx);
    });
    return () => {
      live = false;
    };
  }, [user?.username, queueSnap?.stamp, followupTick]);

  // Drop local follow-ups only once both queues are known, so we do not wipe the other queue's notes
  useEffect(() => {
    if (!queueSnap) return;
    const pending = queue === 'pending' ? queueSnap : nscQueueMemGet('pending');
    const withheld = queue === 'withheld' ? queueSnap : nscQueueMemGet('withheld');
    if (!pending || !withheld) return;
    const alive = new Set<string>();
    for (const r of [...(pending.rows || []), ...(withheld.rows || [])]) {
      if (r.application_no) alive.add(String(r.application_no));
    }
    nscFollowupsPrune(alive).then(() => setFollowupTick((t) => t + 1));
  }, [queueSnap, queue]);

  // Keep division / CCC users locked to their office assignment
  useEffect(() => {
    if (lockedDiv && division !== lockedDiv) setDivision(lockedDiv);
    if (lockedCcc) {
      if (ccc !== lockedCcc) setCcc(lockedCcc);
      if (officeGrain !== 'ccc') setOfficeGrain('ccc');
    } else if (lockedDiv && officeGrain === 'division') {
      setOfficeGrain('ccc');
    }
  }, [lockedDiv, lockedCcc, division, ccc, officeGrain]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const delayFilter = !slab && (delayMin !== '' || delayMax !== '');
  const cutsParam = encodeCutsParam(customCuts);
  const deskQuery = useMemo<NscDeskQuery>(
    () => ({
      queue,
      clock,
      division,
      ccc,
      class: klass,
      pole,
      pole_min: poleMin,
      pole_max: poleMax,
      procedure,
      agency,
      slab: delayFilter ? '' : slab,
      delay_min: delayFilter ? delayMin : '',
      delay_max: delayFilter ? delayMax : '',
      cuts: cutsParam,
      time: timeKey,
      q: qDebounced,
    }),
    [queue, clock, division, ccc, klass, pole, poleMin, poleMax, procedure, agency, slab, delayFilter, delayMin, delayMax, cutsParam, timeKey, qDebounced]
  );
  const filterQs = useMemo(() => qsOf(deskQuery as Record<string, string | number | undefined>), [deskQuery]);

  const desk = useMemo<NscDesk | null>(() => {
    if (!queueSnap) return null;
    const built = buildNscDesk(queueSnap.rows, deskQuery);
    built.pending = queueSnap.pending;
    built.withheld = queueSnap.withheld;
    built.report_date = queueSnap.report_date || built.report_date;
    return overlayNscOffices(built, queueSnap, division);
  }, [queueSnap, deskQuery, division]);

  useEffect(() => {
    setPage(0);
  }, [filterQs, reasonPick, tableGrain]);

  useEffect(() => {
    if (tableGrain !== 'cases' && tableGrain !== 'followups') setCaseRow(null);
  }, [tableGrain, queue]);

  useEffect(() => {
    if (queue !== 'withheld') {
      setTimeKey('');
      setReasonPick('');
      if (tableGrain === 'time' || tableGrain === 'reason') setTableGrain(lockedCcc ? 'ccc' : 'division');
    }
    if (view !== 'overview' && view !== 'table') setView('overview');
  }, [queue, view, tableGrain]);

  const selectQueue = (next: NscQueue) => {
    if (next === queue) {
      setView('overview');
      return;
    }
    setQueue(next);
    setView('overview');
    setTimeKey('');
    if (next === 'withheld') {
      setSlab('');
      setCumId('');
      setDelayMin('');
      setDelayMax('');
      setTlGrain('year');
    }
  };

  const showHeldYears = () => {
    setTimeKey('');
    setTlGrain('year');
  };

  const selectHeldYear = (y: string) => {
    if (!y) {
      showHeldYears();
      return;
    }
    if (timeKey.slice(0, 4) === y && tlGrain === 'month' && timeKey.length === 4) {
      showHeldYears();
      return;
    }
    setTimeKey(y);
    setTlGrain('month');
  };

  const loadDesk = async (force = false) => {
    const id = ++deskReq.current;
    await warmNscStamp();
    const cached = nscQueueMemGet(queue) || (await nscCacheGetQueue(queue));
    if (id !== deskReq.current) return;
    if (!force && cached) {
      setQueueSnap(cached);
      setLoading(false);
      setSyncing(false);
    } else if (cached) {
      setQueueSnap(cached);
      setLoading(false);
      setSyncing(true);
    } else {
      setQueueSnap(null);
      setLoading(true);
    }
    setError('');
    try {
      const snap = await ensureNscQueue(queue, {
        force,
        onUpdate: (next) => {
          if (id !== deskReq.current) return;
          setQueueSnap(next);
        },
      });
      if (id !== deskReq.current) return;
      setQueueSnap(snap);
      prefetchNscQueue(queue === 'pending' ? 'withheld' : 'pending');
    } catch (e) {
      if (id !== deskReq.current) return;
      if (!cached) setError(e instanceof Error ? e.message : 'Failed to load NSC');
    } finally {
      if (id === deskReq.current) {
        setLoading(false);
        setSyncing(false);
      }
    }
  };

  useEffect(() => {
    loadDesk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const sourceRows = queueSnap?.rows || [];
  const divisions = desk?.divisions || [];
  const cccs = desk?.cccs || [];
  const classOpts = desk?.classes || [];
  const timelineYears = desk?.years || [];
  const reasons = desk?.reasons || [];

  const kpiBase = useMemo(
    () =>
      facetRows(sourceRows, deskQuery, {
        pole: '',
        pole_min: '',
        pole_max: '',
        class: '',
        procedure: '',
      }),
    [sourceRows, deskQuery]
  );
  const classFacet = useMemo(() => facetRows(sourceRows, deskQuery, { class: '' }), [sourceRows, deskQuery]);
  const poleFacet = useMemo(
    () => facetRows(sourceRows, deskQuery, { pole: '', pole_min: '', pole_max: '' }),
    [sourceRows, deskQuery]
  );
  const kpiClasses = useMemo(() => countClasses(kpiBase), [kpiBase]);
  const kpiPoles = useMemo(() => countPoles(kpiBase), [kpiBase]);
  const procCounts = useMemo(() => countProcs(kpiBase), [kpiBase]);
  const mixTotal = kpiBase.length;
  const tableRows = useMemo(() => {
    let rows = facetRows(sourceRows, deskQuery);
    if (reasonPick) {
      rows =
        reasonPick === 'Not recorded'
          ? rows.filter((r) => !String(r.withheld_reason || '').trim())
          : rows.filter((r) => String(r.withheld_reason || '').trim() === reasonPick);
    }
    if (tableGrain === 'followups') {
      rows = rows.filter((r) => followupIndex.has(String(r.application_no || '').trim()));
      rows = [...rows].sort((a, b) => {
        const la = followupIndex.get(String(a.application_no || '').trim())?.latest || '';
        const lb = followupIndex.get(String(b.application_no || '').trim())?.latest || '';
        return lb.localeCompare(la);
      });
    }
    return rows;
  }, [sourceRows, deskQuery, reasonPick, tableGrain, followupIndex]);
  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE));
  const sortedCases = useMemo(() => {
    if (tableGrain === 'followups' && !caseSort) return tableRows;
    if (!caseSort) return tableRows;
    const dir = caseSort.dir === 'asc' ? 1 : -1;
    const text = (r: NscChartRow) => {
      switch (caseSort.key) {
        case 'app':
          return r.application_no || '';
        case 'division':
          return r.division_name || r.division_code || '';
        case 'ccc':
          return r.ccc_name || r.ccc_code || '';
        case 'class':
          return r.consumer_class || '';
        case 'agency':
          return hasAgency(r.agency_name) ? String(r.agency_name).trim() : AGENCY_NONE_LABEL;
        case 'reason':
          return r.withheld_reason || '';
        case 'collected':
          return r.collected_on || '';
        case 'withheld':
          return r.withheld_on || '';
        default:
          return null;
      }
    };
    const num = (r: NscChartRow) => {
      if (caseSort.key === 'age') return rowDays(r, clock) ?? -1;
      if (caseSort.key === 'work') return r.pole_count == null ? -1 : Number(r.pole_count);
      return null;
    };
    return [...tableRows].sort((a, b) => {
      const an = num(a);
      if (an != null) return (an - (num(b) as number)) * dir;
      return String(text(a)).localeCompare(String(text(b))) * dir;
    });
  }, [tableRows, caseSort, clock, tableGrain]);
  const tablePage = sortedCases.slice(page * PAGE, page * PAGE + PAGE);
  const showCaseTable = tableGrain === 'cases' || tableGrain === 'followups';
  const tableCols = queue === 'withheld' ? (showCaseTable && tableGrain === 'followups' ? 13 : 12) : tableGrain === 'followups' ? 11 : 10;
  const classRows = useMemo(() => countClasses(classFacet), [classFacet]);
  const poleCounts = useMemo(() => countPoles(poleFacet), [poleFacet]);
  // every known class keeps its row (at zero) so filters never reflow the panel
  const classMix = useMemo(() => {
    const counts = new Map(classRows.map((r) => [r.name, r.count]));
    const names = [...classOpts];
    for (const r of classRows) if (!names.includes(r.name)) names.push(r.name);
    return names.map((name) => ({ name, count: counts.get(name) || 0 }));
  }, [classRows, classOpts]);
  const poleMix = useMemo(() => {
    const rows = [
      { id: 'non_pole', name: 'Non-pole', count: poleCounts.non_pole, fill: '#059669' },
      { id: 'pole', name: 'Pole', count: poleCounts.pole, fill: '#ea580c' },
    ];
    if (kpiPoles.unknown || poleCounts.unknown) {
      rows.push({ id: 'unknown', name: 'Not recorded', count: poleCounts.unknown, fill: '#94a3b8' });
    }
    return rows;
  }, [poleCounts, kpiPoles.unknown]);
  const officeFacet = useMemo(
    () =>
      facetRows(sourceRows, deskQuery, officeGrain === 'division' ? { division: '', ccc: '' } : { ccc: '' }),
    [sourceRows, deskQuery, officeGrain]
  );

  const officeStacks = useMemo(() => stackOffices(officeFacet, officeGrain, clock), [officeFacet, officeGrain, clock]);

  const timelineSource = useMemo(
    () => facetRows(sourceRows, deskQuery, { time: '' }),
    [sourceRows, deskQuery]
  );
  const ageFacet = useMemo(
    () => facetRows(sourceRows, deskQuery, { slab: '', delay_min: '', delay_max: '' }),
    [sourceRows, deskQuery]
  );
  const divisionFacet = useMemo(
    () => facetRows(sourceRows, deskQuery, { division: '', ccc: '' }),
    [sourceRows, deskQuery]
  );
  const cccFacet = useMemo(
    () => facetRows(sourceRows, deskQuery, { ccc: '' }),
    [sourceRows, deskQuery]
  );
  const reasonFacet = useMemo(() => facetRows(sourceRows, deskQuery), [sourceRows, deskQuery]);
  const agencyFacet = useMemo(() => facetRows(sourceRows, deskQuery, { agency: '' }), [sourceRows, deskQuery]);
  const agencySum = useMemo(
    () =>
      summarizeBy(agencyFacet, clock, (r) => {
        const name = String(r.agency_name || '').trim();
        return name ? { key: name, label: name } : { key: NSC_NO_AGENCY, label: AGENCY_NONE_LABEL };
      }),
    [agencyFacet, clock]
  );
  const divisionSum = useMemo(() => summarizeOffices(divisionFacet, 'division', clock), [divisionFacet, clock]);
  const cccSum = useMemo(() => summarizeOffices(cccFacet, 'ccc', clock), [cccFacet, clock]);
  const bandCuts = useMemo(
    () => customCuts.filter((c) => (band === 'exclusive' ? c.op === 'bt' : c.op !== 'bt')),
    [customCuts, band]
  );
  const cutOp: DelayOp = band === 'exclusive' ? 'bt' : customOp === 'bt' ? 'gt' : customOp;
  const customIds = useMemo(() => new Set(customCuts.map((c) => c.id)), [customCuts]);
  const ageRanges = useMemo(
    () => mergeDelayCuts(customCuts, band === 'exclusive').map((r) => ({ id: r.id, label: r.label, cut: r.cut })),
    [customCuts, band]
  );
  const ageSum = useMemo(() => summarizeRanges(ageFacet, clock, ageRanges), [ageFacet, clock, ageRanges]);
  const classSum = useMemo(
    () =>
      summarizeBy(classFacet, clock, (r) => {
        const name = r.consumer_class || 'Others';
        return { key: name, label: name };
      }),
    [classFacet, clock]
  );
  const workSum = useMemo(
    () =>
      summarizeBy(poleFacet, clock, (r) => {
        const kind = r.pole_count == null ? 'unknown' : Number(r.pole_count) > 0 ? 'pole' : 'non_pole';
        const label = kind === 'pole' ? 'Pole' : kind === 'non_pole' ? 'Non-pole' : 'Not recorded';
        return { key: kind, label };
      }),
    [poleFacet, clock]
  );
  const timeSum = useMemo(() => {
    const year = timeKey.length >= 4 ? timeKey.slice(0, 4) : '';
    const showMonths = timeKey.length === 4 || timeKey.length === 7;
    const src = year
      ? timelineSource.filter((r) => yearOfIso(nscEventOn(r)) === year)
      : timelineSource;
    return summarizeBy(src, clock, (r) => {
      const iso = nscEventOn(r);
      if (showMonths) {
        const key = monthOfIso(iso) || 'unknown';
        return { key, label: timePhrase(key) || 'Unknown' };
      }
      const key = yearOfIso(iso) || 'unknown';
      return { key, label: key === 'unknown' ? 'Not recorded' : key };
    }).sort((a, b) => a.key.localeCompare(b.key));
  }, [timelineSource, clock, timeKey]);
  const reasonSum = useMemo(
    () =>
      summarizeBy(reasonFacet, clock, (r) => {
        const name = String(r.withheld_reason || '').trim() || 'Not recorded';
        return { key: name, label: name };
      }),
    [reasonFacet, clock]
  );
  const heldTimeline = useMemo(() => {
    if (queue !== 'withheld') return { points: [] as ReturnType<typeof buildWithheldTimeline>, divisions: [] as string[] };
    const divs = [...new Set(timelineSource.map((r) => r.division_name || r.division_code).filter(Boolean))];
    const yearZoom = tlGrain === 'month' && timeKey.length >= 4 ? timeKey.slice(0, 4) : '';
    const stack = tlSeries === 'office';
    const points = buildWithheldTimeline(timelineSource as unknown as NscRow[], {
      grain: tlGrain,
      year: yearZoom,
      divisions: stack ? divs : [],
    });
    return { points, divisions: stack ? divs : [] };
  }, [queue, timelineSource, tlGrain, tlSeries, timeKey]);
  const timeline = heldTimeline.points;
  const timelineDivisions = heldTimeline.divisions;
  const tlStack = tlSeries === 'office' && timelineDivisions.length > 0;

  const slabOrder = new Map<string, number>(NSC_SLABS.map((s, i) => [s.id, i]));
  const bySlab = (desk?.by_slab || [])
    .filter((s) => s.id !== 'unknown')
    .sort((a, b) => (slabOrder.get(a.id) ?? 99) - (slabOrder.get(b.id) ?? 99))
    .map((s) => ({ ...s, fill: SLAB_COLORS[String(s.id)] || '#94a3b8' }));
  const countById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of bySlab) m.set(s.id, s.count);
    for (const s of desk?.by_cumulative || []) m.set(s.id, s.count);
    return m;
  }, [bySlab, desk?.by_cumulative]);
  const rangeRows = mergeDelayCuts(customCuts, band === 'exclusive');
  const mixRows = rangeRows.map((row) => {
    const fill = row.cut
      ? row.custom
        ? customCutFill(row.cut)
        : CUM_COLORS[row.id] || '#64748b'
      : SLAB_COLORS[row.id] || '#94a3b8';
    return {
      id: row.id,
      name: row.label,
      count: countById.get(row.id) || 0,
      fill,
      custom: row.custom,
      cut: row.cut,
    };
  });

  const switchBand = (next: DelayBand) => {
    setBand(next);
    setCustomOp((prev) => (next === 'exclusive' ? 'bt' : prev === 'bt' ? 'gt' : prev));
    setSlab('');
    setCumId('');
    setDelayMin('');
    setDelayMax('');
  };

  const applyCut = (cut: DelayCut) => {
    const same = cumId === cut.id;
    setSlab('');
    if (same) {
      setCumId('');
      setDelayMin('');
      setDelayMax('');
      return;
    }
    setCumId(cut.id);
    if (cut.op === 'le') {
      setDelayMin(0);
      setDelayMax(cut.days);
    } else if (cut.op === 'gt') {
      setDelayMin(cut.days + 1);
      setDelayMax('');
    } else {
      setDelayMin(cut.days);
      setDelayMax(cut.daysMax ?? cut.days);
    }
  };

  const persistCuts = (next: DelayCut[]) => {
    setCustomCuts(next);
    saveCustomDelayCuts(cutStoreKey, next);
  };

  const addCustomRange = () => {
    const cut = makeCustomCut(cutOp, customA, cutOp === 'bt' ? customB : undefined);
    if (!cut) return;
    const builtIn = NSC_CUMULATIVE.find((c) => c.op === cut.op && c.days === cut.days && cut.op !== 'bt');
    if (builtIn) {
      applyCut(builtIn);
      return;
    }
    const existing = customCuts.find((c) => c.id === cut.id);
    if (existing) {
      applyCut(existing);
      return;
    }
    if (customCuts.length >= 12) return;
    persistCuts([...customCuts, cut]);
    applyCut(cut);
  };

  const removeCustomRange = (id: string) => {
    persistCuts(customCuts.filter((c) => c.id !== id));
    if (cumId === id) {
      setCumId('');
      setDelayMin('');
      setDelayMax('');
    }
  };

  const selectMixRow = (row: (typeof mixRows)[number]) => {
    const on = row.cut ? cumId === row.id : slab === row.id;
    if (on) {
      setSlab('');
      setCumId('');
      setDelayMin('');
      setDelayMax('');
      return;
    }
    if (row.cut) {
      applyCut(row.cut);
      return;
    }
    setCumId('');
    setDelayMin('');
    setDelayMax('');
    setSlab(row.id);
  };

  const delayActive = delayMin !== '' || delayMax !== '' || !!slab;
  const officeSlabsAvailable = queue === 'pending' && band === 'exclusive' && !delayActive;
  const officeStacked = officeSlabsAvailable && officeSlabs;

  const clearMixSlice = () => {
    setPole('');
    setPoleMin('');
    setPoleMax('');
    setProcedure('');
    setKlass('');
  };

  const selectPoleSlice = (id: string) => {
    const onlyThis = pole === id && !klass && !procedure && poleMin === '';
    clearMixSlice();
    if (!onlyThis) {
      setPole(id);
      setPoleMin('');
      setPoleMax('');
    }
    setView('overview');
  };

  const selectClassSlice = (name: string) => {
    const onlyThis = klass === name && !pole && !procedure;
    clearMixSlice();
    if (!onlyThis) setKlass(name);
    setView('overview');
  };

  const selectProcSlice = (id: string) => {
    const onlyThis = procedure === id && !pole && !klass;
    clearMixSlice();
    if (!onlyThis) setProcedure(id);
    setView('overview');
  };

  const drillOffice = (code: string) => {
    if (!code) return;
    if (officeGrain === 'division') {
      if (lockedDiv) return;
      setDivision((prev) => (prev === code ? '' : code));
      setCcc(lockedCcc || '');
      return;
    }
    if (lockedCcc) return;
    setCcc((prev) => (prev === code ? '' : code));
  };

  const officePicked = officeGrain === 'ccc' ? ccc : division;
  const dimBar = (on: boolean, anyOn: boolean) => (!anyOn || on ? 1 : 0.28);

  const delayBox = useBoxWidth<HTMLDivElement>();
  const officeBox = useBoxWidth<HTMLDivElement>();
  const timeBox = useBoxWidth<HTMLDivElement>();
  const wideOverview = useWideOverview(1100);
  // desktop / present: CSS pins the desk to the viewport; charts flex, tables scroll inside
  const fit = present || wideOverview;
  const delayPlan = planLabels(delayBox.width, mixRows.map((r) => r.count), present);
  const officePlan = planLabels(officeBox.width, officeStacks.map((o) => o.total), present);
  const timePlan = planLabels(timeBox.width, timeline.map((p) => Number(p.added || 0)), present);
  const delayFont = delayPlan.font;
  const officeFont = officePlan.font;
  const timeFont = timePlan.font;
  const delayAxisW = axisWidth(delayFont, mixRows.map((r) => r.count));
  const officeAxisW = axisWidth(officeFont, officeStacks.map((o) => o.total));
  const timeAxisW = axisWidth(timeFont, timeline.map((p) => Number(p.added || 0)));
  const timeRunAxisW = axisWidth(timeFont, timeline.map((p) => Number(p.cumulative || 0)));
  const officeTickChars = officeStacks.length && officeBox.width
    ? Math.max(3, Math.floor(officeBox.width / officeStacks.length / (officeFont * 0.62)))
    : 32;

  const onTimelineClick = (state: { activePayload?: { payload?: { key?: string } }[] }) => {
    const key = state?.activePayload?.[0]?.payload?.key;
    if (!key) return;
    if (tlGrain === 'year' || key.length === 4) {
      selectHeldYear(key);
      return;
    }
    setTimeKey((prev) => (prev === key ? key.slice(0, 4) : key));
  };

  const download = async () => {
    setExporting(true);
    setError('');
    try {
      await api.nscExport(filterQs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const industrialCount = kpiClasses.find((c) => c.name.toLowerCase() === 'industrial')?.count || 0;
  const commercialCount = kpiClasses.find((c) => c.name.toLowerCase() === 'commercial')?.count || 0;
  const kpiAllOn = !pole && !procedure && !klass;

  const onCaseSort = (key: CaseSortKey, first: SortDir) => {
    setCaseSort((prev) => nextSort(prev, key, first));
    setPage(0);
  };

  const clearFilters = () => {
    if (!lockedDiv) setDivision('');
    else setDivision(lockedDiv);
    if (!lockedCcc) setCcc('');
    else setCcc(lockedCcc);
    setKlass('');
    setPole('');
    setPoleMin('');
    setPoleMax('');
    setProcedure('');
    setAgency('');
    setSlab('');
    setCumId('');
    setDelayMin('');
    setDelayMax('');
    setTimeKey('');
    setQ('');
    setReasonPick('');
    setOfficeGrain(lockedCcc ? 'ccc' : lockedDiv ? 'ccc' : 'division');
    if (queue === 'withheld') setTlGrain('year');
  };

  const hasFilters = Boolean(
    (!lockedDiv && division) ||
      (!lockedCcc && ccc) ||
      klass ||
      pole ||
      procedure ||
      agency ||
      delayActive ||
      timeKey ||
      qDebounced ||
      reasonPick
  );
  const agencyLabel = agency === NSC_NO_AGENCY ? AGENCY_NONE_LABEL : agency;
  const divName = divisions.find((d) => d.code === division)?.name || division;
  const cccName = cccs.find((c) => c.code === ccc)?.name || ccc;

  const viewTitle = useMemo(() => {
    const words = [queue === 'withheld' ? 'Withheld' : 'Pending'];
    if (klass) words.push(klass);
    if (pole === 'non_pole' || pole === 'pole') words.push(poleLabel(pole));
    if (procedure === 'proc_b' || procedure === 'proc_a') words.push(procedureLabel(procedure));
    words.push('NSC');
    const bits = [words.join(' ')];
    if (division) bits.push(`Div ${divName}`);
    if (ccc) bits.push(`CCC ${cccName}`);
    if (agency) bits.push(`Agency ${agencyLabel}`);
    const when = timePhrase(timeKey);
    if (when) bits.push(when);
    return bits.join(' · ');
  }, [queue, klass, pole, procedure, division, ccc, divName, cccName, agency, agencyLabel, timeKey]);

  usePageHeading(viewTitle);

  const openTable = (grain?: TableGrain) => {
    setView('table');
    if (grain === 'time') {
      // Year table always starts with the year list; drill into months by picking a year
      setTimeKey('');
      setTlGrain('year');
      setTableGrain('time');
      return;
    }
    if (grain) {
      setTableGrain(grain);
      return;
    }
    if (ccc) setTableGrain('cases');
    else if (division) setTableGrain('ccc');
    else setTableGrain('division');
  };

  const pickSummary = (grain: TableGrain, row: NscSumRow) => {
    if (grain === 'division') {
      if (lockedDiv && row.key !== lockedDiv) return;
      setDivision(row.key);
      setCcc(lockedCcc || '');
      setOfficeGrain('ccc');
      setTableGrain('ccc');
      return;
    }
    if (grain === 'ccc') {
      if (lockedCcc && row.key !== lockedCcc) return;
      setCcc(row.key);
      setTableGrain('cases');
      return;
    }
    if (grain === 'age') {
      const range = ageRanges.find((r) => r.id === row.key);
      if (range?.cut) applyCut(range.cut);
      else {
        setCumId('');
        setDelayMin('');
        setDelayMax('');
        setSlab(row.key);
      }
      setTableGrain('cases');
      return;
    }
    if (grain === 'class') {
      setKlass(row.key);
      setTableGrain('cases');
      return;
    }
    if (grain === 'work') {
      setPole(row.key);
      setPoleMin('');
      setPoleMax('');
      setTableGrain('cases');
      return;
    }
    if (grain === 'agency') {
      setAgency((prev) => (prev === row.key ? '' : row.key));
      setTableGrain('cases');
      return;
    }
    if (grain === 'time') {
      if (row.key.length === 4) {
        setTimeKey(row.key);
        setTlGrain('month');
        return;
      }
      setTimeKey(row.key);
      setTableGrain('cases');
      return;
    }
    setReasonPick(row.key);
    setTableGrain('cases');
  };

  const grainTitle =
    tableGrain === 'division'
      ? 'Division'
      : tableGrain === 'ccc'
        ? 'CCC'
        : tableGrain === 'age'
          ? 'Age'
          : tableGrain === 'class'
            ? 'Class'
            : tableGrain === 'work'
              ? 'Work'
              : tableGrain === 'agency'
                ? 'Agency'
                : tableGrain === 'time'
                  ? timeKey.length === 4
                    ? 'Month'
                    : 'Year'
                  : tableGrain === 'reason'
                    ? 'Reason'
                    : tableGrain === 'followups'
                      ? 'My follow-up'
                      : 'Cases';
  const followupAliveCount = useMemo(() => {
    const scoped = facetRows(sourceRows, deskQuery);
    let n = 0;
    for (const r of scoped) {
      if (followupIndex.has(String(r.application_no || '').trim())) n += 1;
    }
    return n;
  }, [sourceRows, deskQuery, followupIndex]);
  const refreshFollowups = () => setFollowupTick((t) => t + 1);
  const summaryRows =
    tableGrain === 'division'
      ? divisionSum
      : tableGrain === 'ccc'
        ? cccSum
        : tableGrain === 'age'
          ? ageSum
          : tableGrain === 'class'
            ? classSum
            : tableGrain === 'work'
              ? workSum
              : tableGrain === 'agency'
                ? agencySum
              : tableGrain === 'time'
                ? timeSum
                : tableGrain === 'reason'
                  ? reasonSum
                  : [];
  const summarySelected =
    tableGrain === 'division'
      ? division
      : tableGrain === 'ccc'
        ? ccc
        : tableGrain === 'age'
          ? cumId || slab
          : tableGrain === 'class'
            ? klass
            : tableGrain === 'work'
              ? pole
              : tableGrain === 'agency'
                ? agency
              : tableGrain === 'time'
                ? timeKey
                : tableGrain === 'reason'
                  ? reasonPick
                  : '';
  const summaryTotal =
    tableGrain === 'division'
      ? divisionFacet.length
      : tableGrain === 'ccc'
        ? cccFacet.length
        : tableGrain === 'age'
          ? ageFacet.length
          : tableGrain === 'class'
            ? classFacet.length
            : tableGrain === 'work'
              ? poleFacet.length
              : tableGrain === 'agency'
                ? agencyFacet.length
              : tableGrain === 'time'
                ? timeSum.reduce((n, r) => n + r.count, 0)
                : tableGrain === 'reason'
                  ? reasonFacet.length
                  : tableRows.length;

  return (
    <div
      className={`stack nsc-desk${fit ? ' nsc-fit' : ''}${queue === 'withheld' ? ' nsc-held' : ''}`}
    >
      <header className="nsc-bar">
        <div className="nsc-bar-actions">
          <div className="nsc-queue" role="tablist" aria-label="NSC queue">
            <button type="button" className={queue === 'pending' ? 'on' : ''} onClick={() => selectQueue('pending')}>
              Pending{queueSnap ? ` ${fmtInt(queueSnap.pending)}` : ''}
            </button>
            <button type="button" className={queue === 'withheld' ? 'on' : ''} onClick={() => selectQueue('withheld')}>
              Withheld{queueSnap ? ` ${fmtInt(queueSnap.withheld)}` : ''}
            </button>
          </div>
          <button type="button" className="nsc-bar-btn" onClick={() => loadDesk(true)} disabled={loading && !desk}>
            Refresh
          </button>
          <button type="button" className="nsc-bar-btn" disabled={!tableRows.length || exporting} onClick={download}>
            {exporting ? '…' : 'Download'}
          </button>
          {canUpload && (
            <a className="nsc-bar-btn nsc-bar-upload present-hide" href="/upload?module=nsc">
              Upload
            </a>
          )}
        </div>
      </header>

      <div className="nsc-filter-card nsc-filter-office">
        <input
          className="nsc-filter-search"
          placeholder="Search application, name or phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search NSC"
        />
        <select
          className={division ? 'nsc-filter-on' : ''}
          value={division}
          disabled={Boolean(lockedDiv)}
          onChange={(e) => {
            const v = e.target.value;
            setDivision(v);
            setCcc(lockedCcc || '');
            setOfficeGrain(v || lockedDiv ? 'ccc' : 'division');
          }}
        >
          {!lockedDiv && <option value="">All divisions</option>}
          {divisions.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          className={ccc ? 'nsc-filter-on' : ''}
          value={ccc}
          disabled={Boolean(lockedCcc)}
          onChange={(e) => setCcc(e.target.value)}
        >
          {!lockedCcc && <option value="">All CCCs</option>}
          {cccs.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <select className={klass ? 'nsc-filter-on' : ''} value={klass} onChange={(e) => setKlass(e.target.value)}>
          <option value="">All classes</option>
          {classOpts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          className={pole ? 'nsc-filter-on' : ''}
          value={pole}
          onChange={(e) => {
            setPole(e.target.value);
            setPoleMin('');
            setPoleMax('');
          }}
        >
          <option value="">All work</option>
          <option value="non_pole">Non-pole</option>
          <option value="pole">Pole</option>
        </select>
        <select className={procedure ? 'nsc-filter-on' : ''} value={procedure} onChange={(e) => setProcedure(e.target.value)}>
          <option value="">All procedures</option>
          <option value="proc_a">Individual</option>
          <option value="proc_b">Proc. B</option>
        </select>
        {queue === 'pending' && (
          <select
            className={slab ? 'nsc-filter-on' : ''}
            value={slab}
            onChange={(e) => {
              setSlab(e.target.value);
              setCumId('');
              setDelayMin('');
              setDelayMax('');
            }}
          >
            <option value="">All ages</option>
            {NSC_SLABS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {queue === 'withheld' && timelineYears.length > 0 && (
          <select
            className={timeKey ? 'nsc-filter-on' : ''}
            value={timeKey.slice(0, 4)}
            onChange={(e) => {
              const y = e.target.value;
              if (!y) setTimeKey('');
              else {
                setTimeKey(y);
                setTlGrain('month');
              }
            }}
          >
            <option value="">All years</option>
            {timelineYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
        {queue === 'withheld' && reasons.length > 0 && (
          <select
            className={reasonPick ? 'nsc-filter-on' : ''}
            value={reasonPick}
            onChange={(e) => setReasonPick(e.target.value)}
          >
            <option value="">All reasons</option>
            {reasons.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        {hasFilters && (
          <button type="button" className="nsc-clear" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && !desk ? (
        <NscSkeleton />
      ) : (
        <>
      <div className="nsc-kpis">
        <button
          type="button"
          className={`nsc-kpi k1 ${kpiAllOn ? 'on' : ''}`}
          aria-pressed={kpiAllOn}
          onClick={() => {
            clearMixSlice();
            setView('overview');
          }}
        >
          <strong>{fmtInt(mixTotal)}</strong>
          <span>{queue === 'withheld' ? 'Withheld' : 'Pending'}</span>
        </button>
        <button
          type="button"
          className={`nsc-kpi k2 ${pole === 'non_pole' && poleMin === '' ? 'on' : ''}`}
          aria-pressed={pole === 'non_pole' && poleMin === ''}
          onClick={() => selectPoleSlice('non_pole')}
        >
          <strong>{fmtInt(kpiPoles.non_pole)}</strong>
          <span>Non-Pole</span>
        </button>
        <button
          type="button"
          className={`nsc-kpi k3 ${pole === 'pole' && poleMin === '' && poleMax === '' ? 'on' : ''}`}
          aria-pressed={pole === 'pole' && poleMin === '' && poleMax === ''}
          onClick={() => selectPoleSlice('pole')}
        >
          <strong>
            {fmtInt(kpiPoles.pole)}
            <em>({fmtInt(kpiPoles.poles_sum)})</em>
          </strong>
          <span>Pole / Reqd. Pole</span>
        </button>
        <button
          type="button"
          className={`nsc-kpi k5 ${klass === 'Industrial' ? 'on' : ''}`}
          aria-pressed={klass === 'Industrial'}
          onClick={() => selectClassSlice('Industrial')}
        >
          <strong>{fmtInt(industrialCount)}</strong>
          <span>Ind</span>
        </button>
        <button
          type="button"
          className={`nsc-kpi k6 ${procedure === 'proc_b' ? 'on' : ''}`}
          aria-pressed={procedure === 'proc_b'}
          onClick={() => selectProcSlice('proc_b')}
        >
          <strong>{fmtInt(procCounts.proc_b)}</strong>
          <span>Proc-B</span>
        </button>
        <button
          type="button"
          className={`nsc-kpi k7 ${klass === 'Commercial' ? 'on' : ''}`}
          aria-pressed={klass === 'Commercial'}
          onClick={() => selectClassSlice('Commercial')}
        >
          <strong>{fmtInt(commercialCount)}</strong>
          <span>Com</span>
        </button>
      </div>
      <div className="nsc-pills" role="tablist" aria-label="NSC view">
        <button type="button" className={view === 'overview' ? 'on' : ''} onClick={() => setView('overview')}>
          Overview
        </button>
        <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => openTable()}>
          Table
        </button>
      </div>

      {view === 'overview' && (
        <div className="stack">
          {queue === 'pending' && (
            <div className="panel nsc-chart-panel">
              <div className="nsc-delay-tools">
                <div className="nsc-queue" role="tablist" aria-label="Delay range type">
                  <button type="button" className={band === 'exclusive' ? 'on' : ''} onClick={() => switchBand('exclusive')}>
                    Slabs
                  </button>
                  <button type="button" className={band === 'cumulative' ? 'on' : ''} onClick={() => switchBand('cumulative')}>
                    Cumulative
                  </button>
                </div>
                <button type="button" className="nsc-bar-btn" onClick={() => openTable('age')}>
                  Table
                </button>
              </div>
              <div ref={delayBox.ref} className="nsc-chart-box" style={{ width: '100%', height: fit ? '100%' : DELAY_H }}>
                <ResponsiveContainer>
                  <BarChart data={mixRows} margin={{ top: delayPlan.top, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                    <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: delayFont }} interval={0} />
                    <YAxis tick={{ fill: '#64748b', fontSize: delayFont }} allowDecimals={false} width={delayAxisW} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmtInt(Number(value ?? 0))} />
                    <Bar dataKey="count" name="Cases" cursor="pointer" radius={[4, 4, 0, 0]}>
                      {mixRows.map((s) => {
                        const on = s.cut ? cumId === s.id : slab === s.id;
                        return (
                          <Cell
                            key={s.id}
                            fill={s.fill}
                            fillOpacity={dimBar(on, delayActive)}
                            cursor="pointer"
                            onClick={() => selectMixRow(s)}
                          />
                        );
                      })}
                      {delayPlan.show ? <LabelList dataKey="count" {...labelProps(delayPlan)} /> : null}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="nsc-custom">
                  <select value={cutOp} onChange={(e) => setCustomOp(e.target.value as DelayOp)} aria-label="Custom range type">
                    {band === 'exclusive' ? (
                      <option value="bt">–</option>
                    ) : (
                      <>
                        <option value="le">≤</option>
                        <option value="gt">&gt;</option>
                      </>
                    )}
                  </select>
                  <input type="number" min={0} value={customA} onChange={(e) => setCustomA(Number(e.target.value))} aria-label="Days" />
                  {cutOp === 'bt' && (
                    <input type="number" min={0} value={customB} onChange={(e) => setCustomB(Number(e.target.value))} aria-label="To days" />
                  )}
                  <span className="muted">days</span>
                  <button type="button" className="btn" onClick={addCustomRange}>
                    Add
                  </button>
                  {bandCuts.map((c) => (
                    <button key={c.id} type="button" className="nsc-chip" onClick={() => removeCustomRange(c.id)}>
                      {c.label} <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
            </div>
          )}

          {queue === 'withheld' && (
            <div className="panel nsc-chart-panel nsc-timeline">
              <div className="nsc-delay-tools">
                <div className="nsc-queue" role="tablist" aria-label="Timeline grain">
                  <button type="button" className={tlGrain === 'month' ? 'on' : ''} onClick={() => setTlGrain('month')}>
                    Month
                  </button>
                  <button type="button" className={tlGrain === 'year' ? 'on' : ''} onClick={showHeldYears}>
                    Year
                  </button>
                </div>
                <div className="nsc-queue" role="tablist" aria-label="Timeline series">
                  <button
                    type="button"
                    className={tlSeries === 'office' ? 'on' : ''}
                    onClick={() => setTlSeries('office')}
                  >
                    Division
                  </button>
                  <button type="button" className={tlSeries === 'total' ? 'on' : ''} onClick={() => setTlSeries('total')}>
                    Total
                  </button>
                </div>
                <div className="nsc-queue" role="tablist" aria-label="Running total">
                  <button type="button" className={tlRunning ? 'on' : ''} onClick={() => setTlRunning((v) => !v)}>
                    Running
                  </button>
                </div>
                {timeKey && (
                  <button type="button" className="nsc-chip" onClick={() => setTimeKey('')}>
                    {timePhrase(timeKey) || timeKey} <span aria-hidden>×</span>
                  </button>
                )}
                {reasons.length > 0 && (
                  <button type="button" className="nsc-bar-btn" onClick={() => openTable('reason')}>
                    Reasons
                  </button>
                )}
                <button type="button" className="nsc-bar-btn" onClick={() => openTable('time')}>
                  Table
                </button>
              </div>
              <div ref={timeBox.ref} className="nsc-office-chart nsc-chart-box" style={{ width: '100%', height: fit ? '100%' : TIMELINE_H }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={timeline} margin={{ top: Math.max(12, timePlan.top), right: 8, left: 0, bottom: 8 }} onClick={onTimelineClick}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#64748b', fontSize: timeFont }}
                      interval={timeline.length > 20 ? Math.ceil(timeline.length / 16) - 1 : 0}
                      minTickGap={8}
                    />
                    <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: timeFont }} allowDecimals={false} width={timeAxisW} tickFormatter={(v) => fmtInt(Number(v))} />
                    {tlRunning ? (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fill: '#64748b', fontSize: timeFont }}
                        allowDecimals={false}
                        width={timeRunAxisW}
                        tickFormatter={(v) => fmtInt(Number(v))}
                      />
                    ) : null}
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [fmtInt(Number(value ?? 0)), String(name)]} />
                    {tlStack ? <Legend wrapperStyle={{ fontSize: timeFont + 1 }} /> : null}
                    {tlStack
                      ? timelineDivisions.map((d, i) => (
                          <Bar key={d} yAxisId="left" dataKey={d} name={d} stackId="held" fill={DIV_PALETTE[i % DIV_PALETTE.length]} cursor="pointer">
                            {timeline.map((p) => (
                              <Cell
                                key={`${d}-${p.key}`}
                                fill={DIV_PALETTE[i % DIV_PALETTE.length]}
                                fillOpacity={dimBar(timeKey === p.key, timeKey.length === 7 || (tlGrain === 'year' && timeKey.length === 4))}
                              />
                            ))}
                            {timePlan.show && i === timelineDivisions.length - 1 ? (
                              <LabelList dataKey="added" {...labelProps(timePlan)} />
                            ) : null}
                          </Bar>
                        ))
                      : (
                          <Bar yAxisId="left" dataKey="added" name="Withheld" fill="#1565c0" cursor="pointer" radius={[4, 4, 0, 0]}>
                            {timeline.map((p) => (
                              <Cell
                                key={p.key}
                                fill={timeKey === p.key ? '#0d47a1' : '#1565c0'}
                                fillOpacity={dimBar(timeKey === p.key, timeKey.length === 7 || (tlGrain === 'year' && timeKey.length === 4))}
                              />
                            ))}
                            {timePlan.show ? <LabelList dataKey="added" {...labelProps(timePlan)} /> : null}
                          </Bar>
                        )}
                    {tlRunning ? (
                      <Line yAxisId="right" type="monotone" dataKey="cumulative" name="Running" stroke="#b91c1c" strokeWidth={2.4} dot={{ r: 2 }} />
                    ) : null}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="nsc-overview">
            <div className="panel nsc-chart-panel nsc-office-panel">
              <div className="panel-head">
                <h2 style={{ marginBottom: 0 }}>{officeGrain === 'ccc' ? 'CCC' : 'Division'}</h2>
                <div className="nsc-chart-tools">
                  <div className="nsc-queue" role="tablist" aria-label="Office grain">
                    {!lockedDiv && (
                      <button
                        type="button"
                        className={officeGrain === 'division' ? 'on' : ''}
                        onClick={() => {
                          setOfficeGrain('division');
                          setCcc(lockedCcc || '');
                        }}
                      >
                        Division
                      </button>
                    )}
                    <button type="button" className={officeGrain === 'ccc' ? 'on' : ''} onClick={() => setOfficeGrain('ccc')}>
                      CCC
                    </button>
                  </div>
                  {officeSlabsAvailable && (
                    <div className="nsc-queue" role="tablist" aria-label="Age slab split">
                      <button type="button" className={officeSlabs ? 'on' : ''} onClick={() => setOfficeSlabs(true)}>
                        Slabs
                      </button>
                      <button type="button" className={officeSlabs ? '' : 'on'} onClick={() => setOfficeSlabs(false)}>
                        Total
                      </button>
                    </div>
                  )}
                  <button type="button" className="nsc-bar-btn" onClick={() => openTable(officeGrain)}>
                    Table
                  </button>
                </div>
              </div>
              <div
                ref={officeBox.ref}
                className="nsc-office-chart nsc-chart-box"
                style={{
                  width: '100%',
                  minWidth: 0,
                  height: fit ? '100%' : queue === 'withheld' ? HELD_CHART_H : CHART_H,
                }}
              >
                {officeStacks.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={officeStacks}
                      margin={{ top: officePlan.top, right: 8, left: 0, bottom: 0 }}
                      onClick={(state) => {
                        const code = String(state?.activePayload?.[0]?.payload?.code || '');
                        if (code) drillOffice(code);
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: '#64748b', fontSize: officeFont }}
                        interval={0}
                        tickFormatter={(v) => shortName(String(v ?? ''), officeTickChars)}
                      />
                      <YAxis tick={{ fill: '#64748b', fontSize: officeFont }} allowDecimals={false} width={officeAxisW} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmtInt(Number(Array.isArray(value) ? value[1] ?? value[0] : value ?? 0))} />
                      {officeStacked ? <Legend wrapperStyle={{ fontSize: officeFont + 1 }} /> : null}
                      {officeStacked
                        ? NSC_SLABS.map((s, i) => (
                            <Bar key={s.id} dataKey={s.id} name={s.label} stackId="a" fill={SLAB_COLORS[s.id]} cursor="pointer">
                              {officeStacks.map((o) => (
                                <Cell
                                  key={`${s.id}-${o.code}`}
                                  fill={SLAB_COLORS[s.id]}
                                  fillOpacity={dimBar(o.code === officePicked, Boolean(officePicked))}
                                />
                              ))}
                              {officePlan.show && i === NSC_SLABS.length - 1 ? (
                                <LabelList dataKey="total" {...labelProps(officePlan)} />
                              ) : null}
                            </Bar>
                          ))
                        : (
                            <Bar
                              key="total"
                              dataKey="total"
                              name="Cases"
                              fill="#2563eb"
                              cursor="pointer"
                              radius={[4, 4, 0, 0]}
                            >
                              {officeStacks.map((o) => (
                                <Cell
                                  key={o.code}
                                  fill="#2563eb"
                                  fillOpacity={dimBar(o.code === officePicked, Boolean(officePicked))}
                                />
                              ))}
                              {officePlan.show ? <LabelList dataKey="total" {...labelProps(officePlan)} /> : null}
                            </Bar>
                          )}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="muted">No office totals in this slice.</p>
                )}
              </div>
              <p className="muted tight">Click an office to filter the other charts. Click it again to clear.</p>
            </div>

            <div className="nsc-overview-side">
              <div className="panel">
                <div className="panel-head">
                  <h2 style={{ marginBottom: 0 }}>Class</h2>
                  <button type="button" className="nsc-bar-btn" onClick={() => openTable('class')}>
                    Table
                  </button>
                </div>
                <div className="nsc-mix">
                  {classMix.map((s) => {
                    const pct = classFacet.length ? Math.round((1000 * s.count) / classFacet.length) / 10 : 0;
                    const empty = !s.count && klass !== s.name;
                    return (
                      <div key={s.name} className={`nsc-mix-row ${klass === s.name ? 'on' : ''} ${empty ? 'zero' : ''}`}>
                        <button
                          type="button"
                          className="nsc-mix-main"
                          disabled={empty}
                          onClick={() => {
                            setKlass((prev) => (prev === s.name ? '' : s.name));
                            setView('overview');
                          }}
                        >
                          <span className="nsc-mix-label">{s.name}</span>
                          <span className="nsc-mix-track">
                            <span className="nsc-mix-fill" style={{ width: `${Math.max(pct, s.count ? 1.5 : 0)}%`, background: '#0e7490' }} />
                          </span>
                          <span className="nsc-mix-count">
                            <b>{fmtInt(s.count)}</b>
                            <em>{pct}%</em>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  {!classMix.length && <p className="muted">None</p>}
                </div>
              </div>
              {queue !== 'withheld' && (
                <div className="panel">
                  <div className="panel-head">
                    <h2 style={{ marginBottom: 0 }}>Pole / Non-pole</h2>
                    <button type="button" className="nsc-bar-btn" onClick={() => openTable('work')}>
                      Table
                    </button>
                  </div>
                  <div className="nsc-mix">
                    {poleMix.map((s) => {
                      const pct = poleFacet.length ? Math.round((1000 * s.count) / poleFacet.length) / 10 : 0;
                      const on = pole === s.id && poleMin === '';
                      const empty = !s.count && !on;
                      return (
                        <div key={s.id} className={`nsc-mix-row ${on ? 'on' : ''} ${empty ? 'zero' : ''}`}>
                          <button
                            type="button"
                            className="nsc-mix-main"
                            disabled={empty}
                            onClick={() => {
                              if (on) {
                                setPole('');
                                setPoleMin('');
                                setPoleMax('');
                              } else {
                                setPole(s.id);
                                setPoleMin('');
                                setPoleMax('');
                              }
                              setView('overview');
                            }}
                          >
                            <span className="nsc-mix-label">{s.name}</span>
                            <span className="nsc-mix-track">
                              <span className="nsc-mix-fill" style={{ width: `${Math.max(pct, s.count ? 1.5 : 0)}%`, background: s.fill }} />
                            </span>
                            <span className="nsc-mix-count">
                              <b>{fmtInt(s.count)}</b>
                              <em>{pct}%</em>
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {view === 'table' && (
        <div className="panel nsc-table-panel">
          <div className="nsc-table-nav">
            <nav className="nsc-crumb" aria-label="Table path">
              <button
                type="button"
                onClick={() => {
                  setDivision(lockedDiv || '');
                  setCcc(lockedCcc || '');
                  setOfficeGrain(lockedCcc || lockedDiv ? 'ccc' : 'division');
                  if (queue === 'withheld') setTimeKey('');
                  setTableGrain(lockedCcc ? 'ccc' : 'division');
                }}
              >
                All
              </button>
              {division ? (
                <>
                  <i>/</i>
                  <button
                    type="button"
                    onClick={() => {
                      setCcc(lockedCcc || '');
                      setOfficeGrain('ccc');
                      setTableGrain(lockedCcc ? 'cases' : 'ccc');
                    }}
                  >
                    Div {divName}
                  </button>
                </>
              ) : null}
              {ccc ? (
                <>
                  <i>/</i>
                  <button type="button" onClick={() => setTableGrain('cases')}>
                    CCC {cccName}
                  </button>
                </>
              ) : null}
              {timeKey ? (
                <>
                  <i>/</i>
                  <button
                    type="button"
                    onClick={() => {
                      if (timeKey.length > 4) {
                        setTimeKey(timeKey.slice(0, 4));
                        setTableGrain('time');
                      } else {
                        setTableGrain('time');
                      }
                    }}
                  >
                    {timePhrase(timeKey)}
                  </button>
                </>
              ) : null}
              {agency ? (
                <>
                  <i>/</i>
                  <button
                    type="button"
                    onClick={() => {
                      setAgency('');
                      setTableGrain('agency');
                    }}
                  >
                    Agency {agencyLabel}
                  </button>
                </>
              ) : null}
              <i>/</i>
              <span>{grainTitle}</span>
            </nav>
            <div className="nsc-table-nav-row">
            <div className="nsc-queue nsc-grain-tabs" role="tablist" aria-label="Table grain">
              {(queue === 'withheld' ? TABLE_GRAINS_HELD : TABLE_GRAINS_PENDING)
                .filter((g) => !(lockedCcc && g.id === 'division'))
                .map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`${tableGrain === g.id ? 'on' : ''}${g.id === 'followups' ? ' nsc-fu-tab' : ''}`}
                  onClick={() => {
                    if (g.id === 'time') {
                      // Year tab shows years; a second click while on months steps back to years
                      if (tableGrain === 'time' && timeKey.length > 4) {
                        setTimeKey(timeKey.slice(0, 4));
                        return;
                      }
                      setTimeKey('');
                      setTlGrain('year');
                      setTableGrain('time');
                      return;
                    }
                    setTableGrain(g.id);
                  }}
                >
                  {g.label}
                  {g.id === 'followups' && followupAliveCount > 0 ? (
                    <em className="nsc-fu-badge">{followupAliveCount}</em>
                  ) : null}
                </button>
              ))}
            </div>
            {tableGrain === 'age' ? (
              <div className="nsc-age-tools">
                <div className="nsc-queue" role="tablist" aria-label="Age range type">
                  <button type="button" className={band === 'exclusive' ? 'on' : ''} onClick={() => switchBand('exclusive')}>
                    Slabs
                  </button>
                  <button type="button" className={band === 'cumulative' ? 'on' : ''} onClick={() => switchBand('cumulative')}>
                    Cumulative
                  </button>
                </div>
                <div className="nsc-custom nsc-custom-inline">
                  <select value={cutOp} onChange={(e) => setCustomOp(e.target.value as DelayOp)} aria-label="Custom range type">
                    {band === 'exclusive' ? (
                      <option value="bt">–</option>
                    ) : (
                      <>
                        <option value="le">≤</option>
                        <option value="gt">&gt;</option>
                      </>
                    )}
                  </select>
                  <input type="number" min={0} value={customA} onChange={(e) => setCustomA(Number(e.target.value))} aria-label="Days" />
                  {cutOp === 'bt' && (
                    <input type="number" min={0} value={customB} onChange={(e) => setCustomB(Number(e.target.value))} aria-label="To days" />
                  )}
                  <span className="muted">days</span>
                  <button type="button" className="btn" onClick={addCustomRange}>
                    Add
                  </button>
                  {bandCuts.map((c) => (
                    <button key={c.id} type="button" className="nsc-chip" onClick={() => removeCustomRange(c.id)}>
                      {c.label} <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {showCaseTable && tableGrain === 'followups' && !tablePage.length ? (
              <p className="muted nsc-fu-empty-hint">Add follow-up notes from any case row — they are saved on this device only.</p>
            ) : null}
            {showCaseTable ? (
              <div className="nsc-pager">
                <span className="muted tight">
                  {fmtInt(tableRows.length)} · {page + 1}/{pageCount}
                </span>
                <button type="button" className="btn secondary" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                  Prev
                </button>
                <button type="button" className="btn secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            ) : null}
            </div>
          </div>
          {!showCaseTable ? (
            <NscSumTable
              label={grainTitle}
              rows={summaryRows}
              total={summaryTotal}
              selected={summarySelected}
              pending={queue === 'pending'}
              keepEmpty={tableGrain === 'age'}
              showTotal={tableGrain !== 'age' || band === 'exclusive'}
              customKeys={tableGrain === 'age' ? customIds : undefined}
              warnKey={tableGrain === 'agency' ? NSC_NO_AGENCY : undefined}
              onPick={(row) => pickSummary(tableGrain, row)}
            />
          ) : (
            <div className="table-wrap nsc-table-wrap">
              <table className="nsc-detail">
                <thead>
                  <tr>
                    <th className="num nsc-sl">#</th>
                    <SortTh label="Application" col="app" sort={caseSort} onSort={onCaseSort} first="asc" />
                    <SortTh label="Division" col="division" sort={caseSort} onSort={onCaseSort} first="asc" />
                    <SortTh label="CCC" col="ccc" sort={caseSort} onSort={onCaseSort} first="asc" />
                    <SortTh label="Class" col="class" sort={caseSort} onSort={onCaseSort} first="asc" />
                    <SortTh label="Work" col="work" sort={caseSort} onSort={onCaseSort} />
                    <th>Procedure</th>
                    <SortTh label="Age" col="age" sort={caseSort} onSort={onCaseSort} />
                    <SortTh label="Collected" col="collected" sort={caseSort} onSort={onCaseSort} />
                    <SortTh label="Agency" col="agency" sort={caseSort} onSort={onCaseSort} first="asc" />
                    {tableGrain === 'followups' && <th>Follow-up</th>}
                    {queue === 'withheld' && <SortTh label="Withheld" col="withheld" sort={caseSort} onSort={onCaseSort} />}
                    {queue === 'withheld' && <SortTh label="Reason" col="reason" sort={caseSort} onSort={onCaseSort} first="asc" />}
                  </tr>
                </thead>
                <tbody>
                  {tablePage.map((r: NscChartRow, i: number) => {
                    const age = rowDays(r, clock);
                    const work = workKind(r);
                    const app = String(r.application_no || '').trim();
                    const fu = followupIndex.get(app);
                    const selected = Boolean(caseRow?.application_no && caseRow.application_no === r.application_no);
                    return (
                      <tr
                        key={r.application_no || `${r.ccc_code}-${r.collected_on}-${i}`}
                        className={`${selected ? 'on' : ''}${fu ? ' nsc-fu-row' : ''}`}
                        onClick={() => setCaseRow(r)}
                      >
                        <td className="num nsc-sl">{page * PAGE + i + 1}</td>
                        <td>
                          <span className="nsc-app-cell">
                            {fu ? <span className="nsc-fu-mark" title={`${fu.count} follow-up note(s)`} aria-hidden /> : null}
                            {r.application_no || '—'}
                          </span>
                        </td>
                        <td>{r.division_name || r.division_code || '—'}</td>
                        <td>{r.ccc_name || r.ccc_code || '—'}</td>
                        <td>{r.consumer_class || '—'}</td>
                        <td>{poleLabel(work, r.pole_count)}</td>
                        <td>{procedureLabel(r.procedure, r.applicant_type)}</td>
                        <td className={ageTone(age)}>{age ?? '—'}</td>
                        <td>{fmtDay(r.collected_on)}</td>
                        <td><AgencyCell name={r.agency_name} /></td>
                        {tableGrain === 'followups' && (
                          <td className="nsc-fu-preview">
                            {fu ? (
                              <>
                                <small>{fmtSeen(fu.latest)}</small>
                                <span>{fu.preview || `${fu.count} note(s)`}</span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                        {queue === 'withheld' && <td>{fmtDay(r.withheld_on)}</td>}
                        {queue === 'withheld' && <td>{r.withheld_reason || '—'}</td>}
                      </tr>
                    );
                  })}
                  {!tablePage.length && (
                    <tr>
                      <td colSpan={tableCols} className="muted">
                        {tableGrain === 'followups' ? 'No local follow-ups in this filter' : 'None in this filter'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {caseRow ? (
        <NscCaseSheet
          row={caseRow}
          clock={clock}
          onClose={() => setCaseRow(null)}
          onNotesChange={refreshFollowups}
        />
      ) : null}
        </>
      )}
    </div>
  );
}
