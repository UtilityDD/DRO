import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type Office,
  type Substation,
  type TechWork,
  type TechWorkCategory,
  type TechWorkPo,
  type TechWorkStaff,
} from '../api';
import { useAuth } from '../auth';

type Queue = 'planned' | 'in_progress' | 'on_hold' | 'completed';
type KpiFocus = 'all' | 'not_started' | Queue;

const QUEUES: { id: Queue; label: string }[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'completed', label: 'Completed' },
];

const MATERIAL: { id: string; label: string }[] = [
  { id: 'not_issued', label: 'Not issued' },
  { id: 'partial', label: 'Partial' },
  { id: 'issued', label: 'Issued' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDay(iso: string) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtWhen(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return fmtDay(iso);
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  if (iso.length <= 10 || /T00:00:00/.test(iso)) return day;
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}

function maskText(v: string, max = 400) {
  return v.replace(/[<>]/g, '').replace(/\s+/g, ' ').slice(0, max);
}

function statusLabel(status: string) {
  return QUEUES.find((q) => q.id === status)?.label || status;
}

function materialLabel(v: string) {
  return MATERIAL.find((m) => m.id === v)?.label || v || '—';
}

function paramLabel(n: number | null | undefined, unit: string) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const s = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return unit ? `${s} ${unit}` : s;
}

function fmtRs(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function fmtCompactRs(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '₹0';
  const abs = Math.abs(Number(n));
  const sign = Number(n) < 0 ? '-' : '';
  const fmt = (v: number) =>
    v.toLocaleString('en-IN', { maximumFractionDigits: v >= 10 ? 1 : 2 }).replace(/\.0$/, '');
  if (abs >= 1e7) return `${sign}₹${fmt(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${fmt(abs / 1e5)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

function isNotStarted(row: TechWork) {
  if (row.status === 'completed') return false;
  return (row.work_progress || 0) === 0;
}

function moneyOf(v: number | null | undefined) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function matchesFocus(row: TechWork, focus: KpiFocus) {
  if (focus === 'all') return true;
  if (focus === 'not_started') return isNotStarted(row);
  return row.status === focus;
}

function rollup(list: TechWork[]) {
  let notStarted = 0;
  let inProgress = 0;
  let completed = 0;
  let scheme = 0;
  let billed = 0;
  for (const w of list) {
    if (w.status === 'completed') completed += 1;
    else if (w.status === 'in_progress') inProgress += 1;
    if (isNotStarted(w)) notStarted += 1;
    scheme += moneyOf(w.scheme_value);
    billed += moneyOf(w.billing_progress);
  }
  const billedPctVal = scheme > 0 ? Math.round((billed / scheme) * 1000) / 10 : null;
  return {
    count: list.length,
    total: list.length,
    notStarted,
    inProgress,
    completed,
    scheme,
    billed,
    unbilled: Math.max(0, scheme - billed),
    billedPct: billedPctVal,
  };
}

function billedPct(scheme: number | null | undefined, billed: number | null | undefined) {
  const s = Number(scheme);
  const b = Number(billed);
  if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(b)) return null;
  return Math.round((b / s) * 1000) / 10;
}

function staffName(username: string, staff: TechWorkStaff[] = []) {
  const u = staff.find((s) => s.username === username);
  return u?.name || username;
}

function emptyPo(): TechWorkPo {
  return { po_no: '', po_date: '', agency_name: '' };
}

function emptyForm(divisionCode: string, categoryId: number | null, unit: string) {
  return {
    category_id: categoryId,
    division_code: divisionCode,
    related_ss_name: '',
    description: '',
    existing_parameter: '',
    proposed_parameter: '',
    parameter_unit: unit,
    proposal_enote_no: '',
    proposal_enote_date: '',
    taa_no: '',
    taa_date: '',
    scheme_value: '',
    billing_progress: '',
    major_material: '',
    pos: [emptyPo()],
    work_start_date: '',
    material_issue_status: 'not_issued',
    work_progress: '0',
    status: 'planned' as Queue,
    remarks: '',
    followup_users: [] as string[],
  };
}

function formFromWork(row: TechWork) {
  return {
    category_id: row.category_id,
    division_code: row.division_code,
    related_ss_name: row.related_ss_name || '',
    description: row.description || row.title || '',
    existing_parameter: row.existing_parameter == null ? '' : String(row.existing_parameter),
    proposed_parameter: row.proposed_parameter == null ? '' : String(row.proposed_parameter),
    parameter_unit: row.parameter_unit || '',
    proposal_enote_no: row.proposal_enote_no || '',
    proposal_enote_date: row.proposal_enote_date || '',
    taa_no: row.taa_no || '',
    taa_date: row.taa_date || '',
    scheme_value: row.scheme_value == null ? '' : String(row.scheme_value),
    billing_progress: row.billing_progress == null ? '' : String(row.billing_progress),
    major_material: row.major_material || '',
    pos: row.pos?.length ? row.pos.map((p) => ({ ...p })) : [emptyPo()],
    work_start_date: row.work_start_date || '',
    material_issue_status: row.material_issue_status || 'not_issued',
    work_progress: String(row.work_progress || 0),
    status: (row.status as Queue) || 'planned',
    remarks: row.remarks || '',
    followup_users: [...(row.followup_users || [])],
  };
}

function formErrors(form: ReturnType<typeof emptyForm>) {
  const err: Partial<Record<string, boolean>> = {};
  if (!form.category_id) err.category_id = true;
  if (!form.division_code) err.division_code = true;
  if (maskText(form.description).trim().length < 8) err.description = true;
  return err;
}

function bodyFromForm(form: ReturnType<typeof emptyForm>) {
  return {
    category_id: form.category_id,
    division_code: form.division_code,
    related_ss_name: form.related_ss_name,
    description: form.description,
    existing_parameter: form.existing_parameter === '' ? null : Number(form.existing_parameter),
    proposed_parameter: form.proposed_parameter === '' ? null : Number(form.proposed_parameter),
    parameter_unit: form.parameter_unit,
    proposal_enote_no: form.proposal_enote_no,
    proposal_enote_date: form.proposal_enote_date,
    taa_no: form.taa_no,
    taa_date: form.taa_date,
    scheme_value: form.scheme_value === '' ? null : Number(form.scheme_value),
    billing_progress: form.billing_progress === '' ? null : Number(form.billing_progress),
    major_material: form.major_material,
    pos: form.pos,
    work_start_date: form.work_start_date,
    material_issue_status: form.material_issue_status,
    work_progress: Number(form.work_progress) || 0,
    status: form.status,
    remarks: form.remarks,
    followup_users: form.followup_users,
  };
}

function urgencyClass(row: TechWork) {
  if (row.status === 'completed') return 'ok';
  if (row.status === 'on_hold') return 'warn';
  if (row.status === 'in_progress' && row.work_progress < 20 && row.work_start_date) return 'warn';
  return '';
}

export function TechWorksDeskPage() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const [works, setWorks] = useState<TechWork[]>([]);
  const [categories, setCategories] = useState<TechWorkCategory[]>([]);
  const [staff, setStaff] = useState<TechWorkStaff[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [substations, setSubstations] = useState<Substation[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [canAssign, setCanAssign] = useState(false);
  const [canManageCats, setCanManageCats] = useState(false);
  const [authorUsers, setAuthorUsers] = useState<string[]>([]);
  const [focus, setFocus] = useState<KpiFocus>('all');
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | number>('all');
  const [open, setOpen] = useState<TechWork | null>(null);
  const [mobileRecord, setMobileRecord] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remark, setRemark] = useState('');
  const [exec, setExec] = useState({
    material_issue_status: 'not_issued',
    work_progress: '0',
    billing_progress: '',
    status: 'planned',
    remarks: '',
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [managingCats, setManagingCats] = useState(false);
  const [tried, setTried] = useState(false);
  const [form, setForm] = useState(() => emptyForm('', null, ''));
  const [newCat, setNewCat] = useState({ name: '', parameter_unit: 'MVA' });

  const divisions = useMemo(
    () => offices.filter((o) => o.office_type === 'division'),
    [offices]
  );
  const activeCats = useMemo(() => categories.filter((c) => c.active !== false), [categories]);
  const ssForDiv = useMemo(
    () => substations.filter((s) => !form.division_code || String(s.division_code) === form.division_code),
    [substations, form.division_code]
  );

  const load = () =>
    api
      .techWorks()
      .then((r) => {
        setWorks(r.rows || []);
        setCategories(r.categories || []);
        setStaff(r.staff || []);
        setCanCreate(Boolean(r.can_create));
        setCanAssign(Boolean(r.can_assign));
        setCanManageCats(Boolean(r.can_manage_categories));
        setAuthorUsers(r.author_users || []);
        setOpen((prev) => {
          const list = r.rows || [];
          return list.find((w) => w.id === prev?.id) || null;
        });
      })
      .catch((e) => setError(e.message || 'Failed to load'));

  useEffect(() => {
    load();
    api.offices().then((r) => setOffices(r.offices || [])).catch(() => undefined);
    api.substations().then((r) => setSubstations(r.rows || [])).catch(() => undefined);
  }, []);

  const kpis = useMemo(() => rollup(works), [works]);

  const heads = useMemo(() => {
    const focused = works.filter((w) => matchesFocus(w, focus));
    const byCat = new Map<number, TechWork[]>();
    for (const w of focused) {
      const id = Number(w.category_id) || 0;
      const list = byCat.get(id) || [];
      list.push(w);
      byCat.set(id, list);
    }
    const rows = [
      { id: 'all' as const, name: 'All heads', unit: '', ...rollup(focused) },
      ...activeCats.map((c) => ({
        id: c.id as number | 'all',
        name: c.name,
        unit: c.parameter_unit || '',
        ...rollup(byCat.get(c.id) || []),
      })),
    ];
    const uncat = byCat.get(0) || [];
    if (uncat.length) {
      rows.push({ id: 0, name: 'Uncategorised', unit: '', ...rollup(uncat) });
    }
    return rows;
  }, [works, focus, activeCats]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      works
        .filter((w) => matchesFocus(w, focus))
        .filter((w) => catFilter === 'all' || Number(w.category_id) === catFilter)
        .filter((w) => {
          if (!q) return true;
          const hay = [
            w.work_id,
            w.description,
            w.title,
            w.category_name,
            w.division_name,
            w.related_ss_name,
            w.taa_no,
            w.proposal_enote_no,
            ...(w.pos || []).map((p) => `${p.po_no} ${p.agency_name}`),
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        }),
    [works, focus, catFilter, q]
  );

  useEffect(() => {
    setOpen((prev) => {
      if (!prev) return null;
      return rows.find((r) => r.id === prev.id) || null;
    });
  }, [rows]);

  useEffect(() => {
    if (!open) return;
    setExec({
      material_issue_status: open.material_issue_status || 'not_issued',
      work_progress: String(open.work_progress || 0),
      billing_progress: open.billing_progress == null ? '' : String(open.billing_progress),
      status: open.status || 'planned',
      remarks: open.remarks || '',
    });
    setRemark('');
  }, [open?.id]);

  const applyRow = (mapped: TechWork) => {
    setWorks((prev) => {
      const i = prev.findIndex((w) => w.id === mapped.id);
      if (i < 0) return [mapped, ...prev];
      const next = prev.slice();
      next[i] = mapped;
      return next;
    });
    setOpen(mapped);
  };

  const startAdd = () => {
    const cat =
      typeof catFilter === 'number' && catFilter > 0
        ? activeCats.find((c) => c.id === catFilter) || activeCats[0]
        : activeCats[0];
    setForm(
      emptyForm(
        String(user?.division_code || divisions[0]?.code || ''),
        cat?.id || null,
        cat?.parameter_unit || ''
      )
    );
    setTried(false);
    setError('');
    setAdding(true);
    setEditing(false);
  };

  const startEdit = () => {
    if (!open) return;
    setForm(formFromWork(open));
    setTried(false);
    setError('');
    setEditing(true);
    setAdding(false);
  };

  const pickCategory = (id: number) => {
    const cat = activeCats.find((c) => c.id === id);
    setForm((f) => ({ ...f, category_id: id, parameter_unit: cat?.parameter_unit || f.parameter_unit }));
  };

  const saveWork = async () => {
    setTried(true);
    if (Object.keys(formErrors(form)).length) return;
    setBusy(true);
    setError('');
    try {
      const body = bodyFromForm(form);
      const res = editing && open ? await api.patchTech(open.work_id, body) : await api.createTechWork(body);
      applyRow(res.row);
      setFocus('all');
      if (res.row.category_id) setCatFilter(Number(res.row.category_id));
      setAdding(false);
      setEditing(false);
      setMobileRecord(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveExec = async () => {
    if (!open) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.patchTech(open.work_id, {
        material_issue_status: exec.material_issue_status,
        work_progress: Number(exec.work_progress) || 0,
        billing_progress: exec.billing_progress === '' ? null : Number(exec.billing_progress),
        status: exec.status,
        remarks: exec.remarks,
      });
      applyRow(res.row);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const saveFollowup = async () => {
    const note = maskText(remark).trim();
    if (!open || note.length < 3) return;
    setBusy(true);
    try {
      const res = await api.patchTech(open.work_id, { followup: note });
      applyRow(res.row);
      setRemark('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Follow-up failed');
    } finally {
      setBusy(false);
    }
  };

  const saveAssignees = async (username: string, currentlyOn: boolean) => {
    if (!open) return;
    const next = currentlyOn
      ? open.followup_users.filter((x) => x !== username)
      : [...open.followup_users, username];
    setBusy(true);
    setError('');
    try {
      const res = await api.patchTech(open.work_id, { followup_users: next });
      applyRow(res.row);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update users');
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async () => {
    const name = maskText(newCat.name, 80).trim();
    if (name.length < 3) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.createTechCategory({ name, parameter_unit: newCat.parameter_unit });
      setCategories((prev) => [...prev, res.row].sort((a, b) => a.sort_order - b.sort_order));
      setNewCat({ name: '', parameter_unit: 'MVA' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add category');
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = async (cat: TechWorkCategory) => {
    setBusy(true);
    try {
      const res = await api.patchTechCategory(cat.id, { active: cat.active === false });
      setCategories((prev) => prev.map((c) => (c.id === res.row.id ? res.row : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update category');
    } finally {
      setBusy(false);
    }
  };

  const saveAuthors = async (username: string, currentlyOn: boolean) => {
    const next = currentlyOn ? authorUsers.filter((x) => x !== username) : [...authorUsers, username];
    setBusy(true);
    setError('');
    try {
      const res = await api.patchTechSettings({ author_users: next });
      setAuthorUsers(res.author_users || next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update authorised users');
    } finally {
      setBusy(false);
    }
  };

  const errors = formErrors(form);
  const unit = form.parameter_unit || activeCats.find((c) => c.id === form.category_id)?.parameter_unit || '';
  const stale =
    open &&
    open.status !== 'completed' &&
    (!open.followups?.length ||
      (open.followups[0]?.at && Date.now() - Date.parse(open.followups[0].at) > 7 * 86400000));

  return (
    <div className={`crm-desk tw-desk pw-desk${mobileRecord ? ' show-record' : ''}`}>
      <header className="crm-toolbar">
        <div className="crm-title">
          <h2>Priority Works</h2>
        </div>
        <div className="crm-tools">
          <input
            className="crm-search"
            value={query}
            placeholder="Search"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search works"
          />
          {canCreate && (
            <button type="button" className="btn present-hide" onClick={startAdd}>
              New scheme
            </button>
          )}
          {canManageCats && (
            <button type="button" className="btn secondary present-hide" onClick={() => setManagingCats(true)}>
              Heads
            </button>
          )}
        </div>
      </header>

      <div className="tw-kpis" aria-label="Priority works summary">
        <button
          type="button"
          className={`nsc-kpi k1${focus === 'all' ? ' on' : ''}`}
          onClick={() => setFocus('all')}
        >
          <strong>{kpis.total}</strong>
          <span>Total</span>
        </button>
        <button
          type="button"
          className={`nsc-kpi k2${focus === 'not_started' ? ' on' : ''}`}
          onClick={() => setFocus('not_started')}
        >
          <strong>{kpis.notStarted}</strong>
          <span>Not started</span>
        </button>
        <button
          type="button"
          className={`nsc-kpi k3${focus === 'in_progress' ? ' on' : ''}`}
          onClick={() => setFocus('in_progress')}
        >
          <strong>{kpis.inProgress}</strong>
          <span>In progress</span>
        </button>
        <button
          type="button"
          className={`nsc-kpi k4${focus === 'completed' ? ' on' : ''}`}
          onClick={() => setFocus('completed')}
        >
          <strong>{kpis.completed}</strong>
          <span>Completed</span>
        </button>
        <div className="nsc-kpi k5" title={fmtRs(kpis.scheme)}>
          <strong>{fmtCompactRs(kpis.scheme)}</strong>
          <span>Scheme value</span>
        </div>
        <div className="nsc-kpi k6" title={`${fmtRs(kpis.billed)} billed · ${fmtRs(kpis.unbilled)} unbilled`}>
          <strong>
            {fmtCompactRs(kpis.billed)}
            {kpis.billedPct != null ? <em>{kpis.billedPct}%</em> : null}
          </strong>
          <span>Billed</span>
        </div>
      </div>

      {error && !adding && !editing && !managingCats && <p className="error crm-banner">{error}</p>}

      <div className="crm-split">
        <section className="crm-list pw-heads" aria-label="Head summary">
          {heads.map((h) => (
            <button
              key={String(h.id)}
              type="button"
              className={`pw-head${catFilter === h.id ? ' on' : ''}`}
              onClick={() => {
                setCatFilter(h.id);
                setOpen(null);
                setMobileRecord(true);
              }}
            >
              <strong>{h.name}</strong>
              <b className="pw-head-count">{h.count}</b>
              <span className="pw-head-meta">{fmtCompactRs(h.scheme)}</span>
            </button>
          ))}
        </section>

        <section className="crm-record pw-right" aria-label="Schemes">
          <button type="button" className="crm-back" onClick={() => setMobileRecord(false)}>
            Heads
          </button>
          <div className="pw-scheme-list">
            {rows.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`pw-scheme ${urgencyClass(d)}${open?.id === d.id ? ' is-selected' : ''}`}
                onClick={() => {
                  setOpen(d);
                  setError('');
                  setMobileRecord(true);
                }}
              >
                <span className="pw-scheme-main">
                  <strong>{d.description || d.title || d.work_id}</strong>
                  <span>
                    {(d.division_name || d.division_code || '').replace(/\s+Division$/i, '')}
                    {d.related_ss_name ? ` · ${d.related_ss_name}` : ''}
                    {d.taa_no ? ` · ${d.taa_no}` : ''}
                  </span>
                </span>
                <span className="pw-scheme-side">
                  <b>{d.work_progress || 0}%</b>
                  <span>{fmtCompactRs(d.scheme_value)}</span>
                </span>
              </button>
            ))}
            {!rows.length && <p className="crm-empty">No schemes</p>}
          </div>

          {open ? (
            <div className="pw-sheet">
              <div className="crm-record-head">
                <div>
                  <p className="crm-id">{open.work_id}</p>
                  <h3>{open.description || open.title}</h3>
                </div>
                <span className={`badge ${open.status}`}>{statusLabel(open.status)}</span>
              </div>

              <div className="tw-mini-bar pw-sheet-bar" aria-hidden>
                <span style={{ width: `${Math.max(0, Math.min(100, open.work_progress || 0))}%` }} />
              </div>

              <dl className="crm-fields">
                <div>
                  <dt>Head</dt>
                  <dd>{open.category_name || '—'}</dd>
                </div>
                <div>
                  <dt>Division</dt>
                  <dd>{open.division_name || open.division_code || '—'}</dd>
                </div>
                <div>
                  <dt>Related SS</dt>
                  <dd>{open.related_ss_name || '—'}</dd>
                </div>
                <div>
                  <dt>Parameter</dt>
                  <dd>
                    {paramLabel(open.existing_parameter, open.parameter_unit)}
                    {' → '}
                    {paramLabel(open.proposed_parameter, open.parameter_unit)}
                  </dd>
                </div>
                <div>
                  <dt>E-Note</dt>
                  <dd>
                    {open.proposal_enote_no || '—'}
                    {open.proposal_enote_date ? ` · ${fmtDay(open.proposal_enote_date)}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>TAA</dt>
                  <dd>
                    {open.taa_no || '—'}
                    {open.taa_date ? ` · ${fmtDay(open.taa_date)}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Scheme value</dt>
                  <dd>{fmtRs(open.scheme_value)}</dd>
                </div>
                <div>
                  <dt>Billed</dt>
                  <dd>
                    {fmtRs(open.billing_progress)}
                    {billedPct(open.scheme_value, open.billing_progress) != null
                      ? ` · ${billedPct(open.scheme_value, open.billing_progress)}%`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt>Start</dt>
                  <dd>{fmtDay(open.work_start_date)}</dd>
                </div>
                <div>
                  <dt>Material</dt>
                  <dd>{materialLabel(open.material_issue_status)}</dd>
                </div>
                <div>
                  <dt>Progress</dt>
                  <dd>{open.work_progress || 0}%</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{statusLabel(open.status)}</dd>
                </div>
              </dl>

              {open.can_plan && (
                <div className="crm-close-actions">
                  <button type="button" className="btn secondary" onClick={startEdit}>
                    Edit
                  </button>
                </div>
              )}

              {open.major_material ? (
                <section className="crm-card">
                  <h4>Major material</h4>
                  <div className="crm-card-body">
                    <p>{open.major_material}</p>
                  </div>
                </section>
              ) : null}

              {open.pos?.length ? (
                <section className="crm-card">
                  <h4>POs</h4>
                  <div className="crm-card-body">
                    <table className="tw-po-table">
                      <thead>
                        <tr>
                          <th>PO No.</th>
                          <th>Date</th>
                          <th>Agency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {open.pos.map((p, i) => (
                          <tr key={`${p.po_no}-${i}`}>
                            <td>{p.po_no || '—'}</td>
                            <td>{fmtDay(p.po_date)}</td>
                            <td>{p.agency_name || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {(canAssign || open.followup_users.length > 0) && (
                <section className="crm-card">
                  <h4>Update access</h4>
                  <div className="crm-card-body">
                    {canAssign && staff.length > 0 ? (
                      <div className="griev-users">
                        {staff.map((u) => {
                          const on = open.followup_users.includes(u.username);
                          return (
                            <label key={u.username} className={`griev-user ${on ? 'on' : ''}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={busy}
                                onChange={() => void saveAssignees(u.username, on)}
                              />
                              {u.name || u.username}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="griev-users">
                        {open.followup_users.map((u) => (
                          <span key={u} className="griev-user on">
                            {staffName(u, staff)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {open.can_update ? (
                <section className="crm-card">
                  <h4>Progress</h4>
                  <div className="crm-card-body tw-exec">
                    <label className="field">
                      <span>Material</span>
                      <select
                        value={exec.material_issue_status}
                        onChange={(e) => setExec({ ...exec, material_issue_status: e.target.value })}
                      >
                        {MATERIAL.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>%</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={exec.work_progress}
                        onChange={(e) => setExec({ ...exec, work_progress: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Status</span>
                      <select value={exec.status} onChange={(e) => setExec({ ...exec, status: e.target.value })}>
                        {QUEUES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Billed (Rs.)</span>
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={exec.billing_progress}
                        onChange={(e) => setExec({ ...exec, billing_progress: e.target.value })}
                      />
                    </label>
                    <label className="field tw-span">
                      <span>Remarks</span>
                      <textarea
                        rows={2}
                        maxLength={800}
                        value={exec.remarks}
                        onChange={(e) => setExec({ ...exec, remarks: e.target.value.replace(/[<>]/g, '') })}
                      />
                    </label>
                    <button type="button" className="btn" disabled={busy} onClick={() => void saveExec()}>
                      Save
                    </button>
                  </div>
                </section>
              ) : open.remarks ? (
                <section className="crm-card">
                  <h4>Remarks</h4>
                  <div className="crm-card-body">
                    <p>{open.remarks}</p>
                  </div>
                </section>
              ) : null}

              <section className="crm-card crm-activity">
                <h4>Follow-up</h4>
                <div className="crm-card-body">
                  {stale && <p className="crm-stale">Last log {open.followups?.[0] ? fmtWhen(open.followups[0].at) : '—'}</p>}
                  {open.followups?.length ? (
                    <ol className="crm-timeline">
                      {[...open.followups].reverse().map((t, i) => (
                        <li key={`${t.at}-${i}`}>
                          <span className="crm-tl-rail" aria-hidden>
                            <span className="crm-tl-dot" />
                          </span>
                          <div className="crm-tl-body">
                            <span className="crm-time">
                              {fmtWhen(t.at)} · {staffName(t.by, staff)}
                            </span>
                            <p>{t.remark}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
                {open.can_update ? (
                  <div className="crm-card-foot crm-composer">
                    <textarea
                      rows={2}
                      maxLength={400}
                      value={remark}
                      placeholder="Follow-up note"
                      onChange={(e) => setRemark(maskText(e.target.value))}
                    />
                    <button type="button" className="btn" disabled={!remark.trim() || busy} onClick={() => void saveFollowup()}>
                      Log
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}
        </section>
      </div>

      {(adding || editing) && (
        <div className="crm-modal-back" role="presentation" onClick={() => { setAdding(false); setEditing(false); }}>
          <form
            className="crm-modal tw-modal"
            role="dialog"
            aria-labelledby="tw-form-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void saveWork();
            }}
          >
            <div className="crm-modal-head">
              <h3 id="tw-form-title">{editing ? 'Edit scheme' : 'New scheme'}</h3>
              <button type="button" className="btn secondary" onClick={() => { setAdding(false); setEditing(false); }}>
                Close
              </button>
            </div>
            <div className="griev-step">
              <label className={`field ${tried && errors.category_id ? 'bad' : ''}`}>
                <span>Head / category</span>
                <select
                  value={form.category_id || ''}
                  onChange={(e) => pickCategory(Number(e.target.value))}
                >
                  <option value="">—</option>
                  {activeCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`field ${tried && errors.division_code ? 'bad' : ''}`}>
                <span>Division</span>
                <select
                  value={form.division_code}
                  onChange={(e) => setForm({ ...form, division_code: e.target.value, related_ss_name: '' })}
                >
                  <option value="">—</option>
                  {divisions.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Related SS</span>
                <select
                  value={ssForDiv.some((s) => s.name === form.related_ss_name) ? form.related_ss_name : form.related_ss_name ? '__custom__' : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__custom__') setForm({ ...form, related_ss_name: '' });
                    else setForm({ ...form, related_ss_name: v });
                  }}
                >
                  <option value="">—</option>
                  {ssForDiv.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                  <option value="__custom__">Other / proposed SS</option>
                </select>
              </label>
              {(!ssForDiv.some((s) => s.name === form.related_ss_name)) && (
                <label className="field">
                  <span>SS name</span>
                  <input
                    value={form.related_ss_name}
                    maxLength={80}
                    onChange={(e) => setForm({ ...form, related_ss_name: e.target.value })}
                  />
                </label>
              )}
              <label className={`field griev-desc ${tried && errors.description ? 'bad' : ''}`}>
                <span>Brief description of work</span>
                <textarea
                  rows={2}
                  maxLength={400}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: maskText(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Existing ({unit || 'param'})</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.existing_parameter}
                  onChange={(e) => setForm({ ...form, existing_parameter: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Proposed ({unit || 'param'})</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.proposed_parameter}
                  onChange={(e) => setForm({ ...form, proposed_parameter: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Proposal E-Note No.</span>
                <input
                  value={form.proposal_enote_no}
                  maxLength={40}
                  onChange={(e) => setForm({ ...form, proposal_enote_no: e.target.value })}
                />
              </label>
              <label className="field">
                <span>E-Note date</span>
                <input
                  type="date"
                  max={todayIso()}
                  value={form.proposal_enote_date}
                  onChange={(e) => setForm({ ...form, proposal_enote_date: e.target.value })}
                />
              </label>
              <label className="field">
                <span>TAA No.</span>
                <input value={form.taa_no} maxLength={40} onChange={(e) => setForm({ ...form, taa_no: e.target.value })} />
              </label>
              <label className="field">
                <span>TAA date</span>
                <input type="date" value={form.taa_date} onChange={(e) => setForm({ ...form, taa_date: e.target.value })} />
              </label>
              <label className="field">
                <span>Value of scheme (Rs.)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={form.scheme_value}
                  onChange={(e) => setForm({ ...form, scheme_value: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Billing progress (Rs.)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={form.billing_progress}
                  onChange={(e) => setForm({ ...form, billing_progress: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Work start date</span>
                <input
                  type="date"
                  value={form.work_start_date}
                  onChange={(e) => setForm({ ...form, work_start_date: e.target.value })}
                />
              </label>
              <label className="field griev-desc">
                <span>Major material required</span>
                <textarea
                  rows={2}
                  maxLength={800}
                  value={form.major_material}
                  onChange={(e) => setForm({ ...form, major_material: e.target.value.replace(/[<>]/g, '') })}
                />
              </label>
              <div className="field griev-desc">
                <span>POs</span>
                <div className="tw-po-edit">
                  {form.pos.map((p, i) => (
                    <div key={i} className="tw-po-row">
                      <input
                        placeholder="PO No."
                        value={p.po_no}
                        onChange={(e) => {
                          const pos = form.pos.slice();
                          pos[i] = { ...p, po_no: e.target.value };
                          setForm({ ...form, pos });
                        }}
                      />
                      <input
                        type="date"
                        value={p.po_date}
                        onChange={(e) => {
                          const pos = form.pos.slice();
                          pos[i] = { ...p, po_date: e.target.value };
                          setForm({ ...form, pos });
                        }}
                      />
                      <input
                        placeholder="Agency name"
                        value={p.agency_name}
                        onChange={(e) => {
                          const pos = form.pos.slice();
                          pos[i] = { ...p, agency_name: e.target.value };
                          setForm({ ...form, pos });
                        }}
                      />
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setForm({ ...form, pos: form.pos.filter((_, j) => j !== i).length ? form.pos.filter((_, j) => j !== i) : [emptyPo()] })}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn secondary" onClick={() => setForm({ ...form, pos: [...form.pos, emptyPo()] })}>
                    Add PO
                  </button>
                </div>
              </div>
              {canAssign && (
                <label className="field griev-desc">
                  <span>Users authorised to update</span>
                  <div className="griev-users">
                    {staff.map((u) => {
                      const on = form.followup_users.includes(u.username);
                      return (
                        <label key={u.username} className={`griev-user ${on ? 'on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setForm({
                                ...form,
                                followup_users: on
                                  ? form.followup_users.filter((x) => x !== u.username)
                                  : [...form.followup_users, u.username],
                              })
                            }
                          />
                          {u.name || u.username}
                        </label>
                      );
                    })}
                    {!staff.length && <span className="muted">No staff accounts to assign</span>}
                  </div>
                </label>
              )}
            </div>
            {error && <p className="error">{error}</p>}
            <div className="griev-step-actions">
              <button type="button" className="btn secondary" onClick={() => { setAdding(false); setEditing(false); }}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={busy}>
                {busy ? 'Saving…' : 'Save scheme'}
              </button>
            </div>
          </form>
        </div>
      )}

      {managingCats && (
        <div className="crm-modal-back" role="presentation" onClick={() => setManagingCats(false)}>
          <div className="crm-modal" role="dialog" aria-labelledby="tw-cat-title" onClick={(e) => e.stopPropagation()}>
            <div className="crm-modal-head">
              <h3 id="tw-cat-title">Heads &amp; access</h3>
              <button type="button" className="btn secondary" onClick={() => setManagingCats(false)}>
                Close
              </button>
            </div>
            <ul className="tw-cat-list">
              {categories.map((c) => (
                <li key={c.id} className={c.active === false ? 'off' : ''}>
                  <div>
                    <strong>{c.name}</strong>
                    <span className="muted">{c.parameter_unit || 'no unit'}</span>
                  </div>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => void toggleCategory(c)}>
                    {c.active === false ? 'Activate' : 'Deactivate'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="tw-cat-add">
              <input
                placeholder="New head, e.g. New 33/11kV SS"
                value={newCat.name}
                onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
              />
              <select
                value={newCat.parameter_unit}
                onChange={(e) => setNewCat({ ...newCat, parameter_unit: e.target.value })}
              >
                <option value="MVA">MVA (SS)</option>
                <option value="CKT KM">CKT KM (line)</option>
                <option value="">Other</option>
              </select>
              <button type="button" className="btn" disabled={busy || newCat.name.trim().length < 3} onClick={() => void addCategory()}>
                Add
              </button>
            </div>
            {isAdmin && (
              <div className="tw-authors">
                <h4>Who may add schemes</h4>
                <div className="griev-users">
                  {staff.map((u) => {
                    const on = authorUsers.includes(u.username);
                    return (
                      <label key={u.username} className={`griev-user ${on ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy}
                          onChange={() => void saveAuthors(u.username, on)}
                        />
                        {u.name || u.username}
                      </label>
                    );
                  })}
                  {!staff.length && <span className="muted">No staff accounts to authorize</span>}
                </div>
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
