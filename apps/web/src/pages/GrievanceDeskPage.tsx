import { useEffect, useMemo, useState } from 'react';
import { api, canEdit, type Office, type User } from '../api';
import { useAuth } from '../auth';

type Filter = 'open' | 'closed';
type CaseType = 'billing' | 'technical' | 'legal' | 'metering' | 'supply' | 'other';

type Followup = { at: string; by: string; remark: string };

type CaseRow = {
  id: number;
  complaint_id: string;
  type: string;
  complainant_type: 'consumer' | 'non_consumer';
  consumer_id: string;
  complainant_name: string;
  office_name: string;
  office_code: string;
  target: string;
  delay_days: number;
  last_followup: string;
  followup_gap_days: number | null;
  owner: string;
  followup_users: string[];
  status: string;
  lodged_on: string;
  description: string;
  timeline: Followup[];
};

const TYPES: { id: CaseType; label: string }[] = [
  { id: 'billing', label: 'Billing' },
  { id: 'technical', label: 'Technical' },
  { id: 'legal', label: 'Legal' },
  { id: 'metering', label: 'Metering' },
  { id: 'supply', label: 'Supply' },
  { id: 'other', label: 'Other' },
];
const TYPE_IDS = new Set(TYPES.map((t) => t.id));
const PRIORITIES = new Set(['high', 'normal', 'low']);

const SLA_DAYS: Record<CaseType, number> = {
  supply: 2,
  billing: 7,
  technical: 15,
  metering: 15,
  legal: 30,
  other: 15,
};

const QUEUES: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];

function isDone(status: string) {
  return status === 'resolved' || status === 'closed';
}

function statusLabel(status: string) {
  if (status === 'open') return 'Open';
  if (status === 'resolved') return 'Resolved';
  if (status === 'closed') return 'Closed';
  return status;
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDay(iso: string) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
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

function maskName(v: string) {
  return v.replace(/[^\p{L} .'-]/gu, '').replace(/\s+/g, ' ').slice(0, 60);
}

function maskConsumerId(v: string) {
  return v.replace(/\D/g, '').slice(0, 11);
}

function maskPhone(v: string) {
  let d = v.replace(/\D/g, '');
  if (d.startsWith('91') && d.length > 10) d = d.slice(-10);
  return d.slice(0, 10);
}

function showPhone(d: string) {
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)} ${d.slice(5)}`;
}

function maskText(v: string, max = 240) {
  return v.replace(/[<>]/g, '').replace(/[^\p{L}\p{N} .,'\-/():]/gu, '').replace(/\s+/g, ' ').slice(0, max);
}

function isIsoDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(new Date(`${v}T00:00:00`).getTime());
}

function formErrors(form: ReturnType<typeof emptyForm>, officeCodes: Set<string>) {
  const err: Partial<Record<keyof typeof form, boolean>> = {};
  if (maskName(form.complainant_name).trim().length < 3) err.complainant_name = true;
  if (form.complainant_type === 'consumer' && !/^\d{11}$/.test(form.consumer_id)) err.consumer_id = true;
  if (form.complainant_phone && !/^[6-9]\d{9}$/.test(form.complainant_phone)) err.complainant_phone = true;
  if (!officeCodes.has(form.office_code)) err.office_code = true;
  if (!isIsoDate(form.lodged_on) || form.lodged_on > todayIso()) err.lodged_on = true;
  if (!isIsoDate(form.target_resolve_on) || form.target_resolve_on < form.lodged_on) err.target_resolve_on = true;
  if (maskText(form.short_description).trim().length < 8) err.short_description = true;
  if (!TYPE_IDS.has(form.type)) err.type = true;
  if (!PRIORITIES.has(form.priority)) err.priority = true;
  if (!form.followup_users.length) err.followup_users = true;
  return err;
}

function emptyForm(officeCode: string) {
  const lodged = todayIso();
  return {
    type: 'billing' as CaseType,
    priority: 'normal',
    complainant_type: 'consumer' as 'consumer' | 'non_consumer',
    complainant_name: '',
    consumer_id: '',
    complainant_phone: '',
    office_code: officeCode,
    lodged_on: lodged,
    target_resolve_on: addDays(lodged, SLA_DAYS.billing),
    short_description: '',
    followup_users: [] as string[],
  };
}

function mapRow(raw: Record<string, unknown>): CaseRow {
  const type = String(raw.category || raw.type || 'other');
  const status = String(raw.status || 'open').toLowerCase();
  const lodged = String(raw.lodged_on || '').slice(0, 10);
  const target = String(raw.target_resolve_on || '').slice(0, 10);
  const today = todayIso();
  let delay = 0;
  if (status !== 'resolved' && status !== 'closed') {
    delay = target ? daysBetween(target, today) : Number(raw.aging_days || 0);
  }
  const followups = Array.isArray(raw.followups) ? (raw.followups as Followup[]) : [];
  const last = followups[0];
  const lastOn = String(raw.last_followup_on || last?.at || '').slice(0, 10);
  const consumerId = String(raw.consumer_id || '');
  const complainantType =
    raw.complainant_type === 'non_consumer' || !consumerId ? 'non_consumer' : 'consumer';
  return {
    id: Number(raw.id || 0),
    complaint_id: String(raw.complaint_id || (String(raw.docket_no || '').startsWith('CG/') ? raw.docket_no : '')),
    type,
    complainant_type: complainantType,
    consumer_id: consumerId,
    complainant_name: String(raw.consumer_name || raw.complainant_name || ''),
    office_name: String(raw.office_name || raw.ccc_name || raw.ccc_code || raw.office_code || ''),
    office_code: String(raw.office_code || raw.ccc_code || ''),
    target,
    delay_days: delay,
    last_followup: last ? `${fmtDay(last.at)} · ${last.by}` : lastOn ? fmtDay(lastOn) : '—',
    followup_gap_days: lastOn && !isDone(status) ? daysBetween(lastOn, today) : lastOn ? 0 : null,
    owner: String(raw.created_by || raw.assigned_username || ''),
    followup_users: Array.isArray(raw.followup_users)
      ? raw.followup_users.map((u) => String(u)).filter(Boolean)
      : String(raw.assigned_username || '')
        ? [String(raw.assigned_username)]
        : [],
    status,
    lodged_on: lodged,
    description: String(raw.remarks || raw.short_description || '').split('\n||DRO||\n')[0],
    timeline: followups,
  };
}

function delayLabel(d: CaseRow) {
  if (d.status === 'resolved') return 'Resolved';
  if (d.status === 'closed') return 'Closed';
  if (d.delay_days > 0) return `+${d.delay_days}d`;
  if (d.delay_days === 0) return 'Due';
  return `${-d.delay_days}d`;
}

function delayPhrase(d: CaseRow) {
  if (d.status === 'resolved') return 'Resolved';
  if (d.status === 'closed') return 'Closed';
  if (d.delay_days > 0) return `${d.delay_days} day${d.delay_days === 1 ? '' : 's'} overdue`;
  if (d.delay_days === 0) return 'Due today';
  return `${-d.delay_days} day${d.delay_days === -1 ? '' : 's'} left`;
}

function delayClass(d: CaseRow) {
  if (d.status === 'resolved' || d.status === 'closed') return 'ok';
  if (d.delay_days > 7) return 'danger';
  if (d.delay_days >= 0) return 'warn';
  return 'ok';
}

function typeLabel(t: string) {
  return TYPES.find((x) => x.id === t)?.label || t;
}

function staffName(username: string, staff: User[] = []) {
  const map: Record<string, string> = {
    region: 'Region',
    stown: 'Town',
    hakim: 'Hakimpara',
  };
  for (const u of staff) {
    const short = String(u.name || u.username).split(' ')[0];
    if (short) map[u.username] = short;
  }
  return map[username] || username;
}

function canLogFollowup(user: { username?: string } | null, row: CaseRow, isAdmin: boolean) {
  if (isDone(row.status)) return false;
  if (isAdmin) return true;
  return row.followup_users.includes(String(user?.username || ''));
}

function canCloseCase(user: User | null, row: CaseRow, isAdmin: boolean) {
  if (!user || isDone(row.status)) return false;
  if (isAdmin || canEdit(user, 'grievance')) return true;
  return row.followup_users.includes(String(user.username || ''));
}

function matchesQuery(row: CaseRow, q: string) {
  if (!q) return true;
  const hay = [row.complaint_id, row.complainant_name, row.consumer_id, row.office_name, row.description, typeLabel(row.type)]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function GrievanceDeskPage() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const canAdd = isAdmin;
  const [staff, setStaff] = useState<User[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | CaseType>('all');
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [open, setOpen] = useState<CaseRow | null>(null);
  const [mobileRecord, setMobileRecord] = useState(false);
  const [remark, setRemark] = useState('');
  const [offices, setOffices] = useState<Office[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => emptyForm(String(user?.ccc_code || user?.division_code || '')));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);

  const officeOptions = useMemo(
    () => offices.filter((o) => o.office_type === 'ccc' || o.office_type === 'division'),
    [offices]
  );
  const officeCodes = useMemo(() => new Set(officeOptions.map((o) => o.code)), [officeOptions]);
  const errors = formErrors(form, officeCodes);

  useEffect(() => {
    api
      .grievances()
      .then((r) => {
        const list = (r.rows || [])
          .map(mapRow)
          .filter((c) => /^CG\/\d{4}\/\d{4}$/i.test(c.complaint_id) && !/^Complainant\s+\d+$/i.test(c.complainant_name))
          .sort((a, b) => b.delay_days - a.delay_days);
        setCases(list);
        setOpen((prev) => list.find((c) => c.id === prev?.id) || list[0] || null);
      })
      .catch((e) => setError(e.message || 'Failed to load'));
    api
      .offices()
      .then((r) => setOffices(r.offices || []))
      .catch(() => undefined);
    if (String(user?.role || '').toLowerCase() === 'admin') {
      api
        .users()
        .then((r) =>
          setStaff((r.users || []).filter((u) => String(u.role || '').toLowerCase() !== 'admin'))
        )
        .catch(() => undefined);
    }
  }, [user]);

  useEffect(() => {
    setForm((f) => ({ ...f, target_resolve_on: addDays(f.lodged_on, SLA_DAYS[f.type]) }));
  }, [form.type, form.lodged_on]);

  const counts = useMemo(
    () => ({
      overdue: cases.filter((d) => d.delay_days > 0 && !isDone(d.status)).length,
      open: cases.filter((d) => !isDone(d.status)).length,
      closed: cases.filter((d) => isDone(d.status)).length,
    }),
    [cases]
  );

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      cases
        .filter((d) => (filter === 'closed' ? isDone(d.status) : !isDone(d.status)))
        .filter((d) => typeFilter === 'all' || d.type === typeFilter)
        .filter((d) => matchesQuery(d, q))
        .sort((a, b) => b.delay_days - a.delay_days),
    [cases, filter, typeFilter, q]
  );

  useEffect(() => {
    setOpen((prev) => {
      if (!rows.length) return null;
      return rows.find((r) => r.id === prev?.id) || rows[0];
    });
  }, [rows]);

  const startAdd = () => {
    setAdding(true);
    setError('');
    setTried(false);
    setForm(emptyForm(String(user?.ccc_code || user?.division_code || officeOptions[0]?.code || '')));
  };

  const saveCase = async (again: boolean) => {
    setTried(true);
    if (Object.keys(formErrors(form, officeCodes)).length) return;
    setBusy(true);
    setError('');
    try {
      const office = officeOptions.find((o) => o.code === form.office_code);
      const res = await api.createGrievance({
        type: form.type,
        priority: form.priority,
        complainant_type: form.complainant_type,
        complainant_name: form.complainant_name,
        consumer_id: form.consumer_id,
        complainant_phone: form.complainant_phone,
        office_code: form.office_code,
        division_code: office?.division_code || office?.code,
        lodged_on: form.lodged_on,
        target_resolve_on: form.target_resolve_on,
        short_description: form.short_description,
        followup_users: form.followup_users,
      });
      const mapped = mapRow(res.row);
      setCases((prev) => [mapped, ...prev]);
      setOpen(mapped);
      setMobileRecord(true);
      if (again) setForm(emptyForm(form.office_code));
      else setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveFollowup = async () => {
    const note = maskText(remark).trim();
    if (!open || note.length < 3) return;
    setBusy(true);
    try {
      const res = await api.patchGrievance(String(open.id), { followup: note });
      const mapped = mapRow(res.row);
      setCases((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
      setOpen(mapped);
      setRemark('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Follow-up failed');
    } finally {
      setBusy(false);
    }
  };

  const closeCase = async (status: 'resolved' | 'closed') => {
    if (!open) return;
    const note = maskText(remark).trim();
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = { status };
      if (note.length >= 3) body.followup = note;
      const res = await api.patchGrievance(String(open.id), body);
      const mapped = mapRow(res.row);
      setCases((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
      setOpen(mapped);
      setRemark('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status');
    } finally {
      setBusy(false);
    }
  };

  const saveAssignees = async (row: CaseRow, username: string, currentlyOn: boolean) => {
    const next = currentlyOn
      ? row.followup_users.filter((x) => x !== username)
      : [...row.followup_users, username];
    if (!next.length) {
      setError('Pick at least one follow-up user');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.patchGrievance(String(row.id), { followup_users: next });
      const mapped = mapRow(res.row);
      setCases((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
      setOpen(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update users');
    } finally {
      setBusy(false);
    }
  };

  const selectCase = (row: CaseRow) => {
    setOpen(row);
    setRemark('');
    setError('');
    setMobileRecord(true);
  };

  const staleFollowup =
    open && !isDone(open.status) && (open.followup_gap_days == null || open.followup_gap_days > 3);

  return (
    <div className={`crm-desk${mobileRecord && open ? ' show-record' : ''}`}>
      <header className="crm-toolbar">
        <div className="crm-title">
          <h2>Cases</h2>
          <span className="muted">
            {counts.open} open
            {counts.overdue ? ` · ${counts.overdue} overdue` : ''}
          </span>
        </div>
        <div className="crm-tools">
          <input
            className="crm-search"
            value={query}
            placeholder="Search name, ID, office"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search cases"
          />
          <select
            className="crm-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | CaseType)}
            aria-label="Filter by type"
          >
            <option value="all">All types</option>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {canAdd && (
            <button type="button" className="btn" onClick={startAdd}>
              New case
            </button>
          )}
        </div>
      </header>

      {error && !adding && <p className="error crm-banner">{error}</p>}

      <div className="crm-split">
        <section className="crm-list" aria-label="Case list">
          <nav className="crm-queues" aria-label="Case queues">
            {QUEUES.map((qItem) => (
              <button
                key={qItem.id}
                type="button"
                className={`crm-queue ${filter === qItem.id ? 'on' : ''}`}
                onClick={() => setFilter(qItem.id)}
              >
                {qItem.label}
                <b>{counts[qItem.id]}</b>
              </button>
            ))}
          </nav>
          {rows.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`crm-item ${delayClass(d)}${open?.id === d.id ? ' is-selected' : ''}`}
              onClick={() => selectCase(d)}
            >
              <span className="crm-item-body">
                <span className="crm-item-top">
                  <strong>{d.complainant_name || '—'}</strong>
                  <span className="crm-delay">{delayLabel(d)}</span>
                </span>
                <span className="crm-item-mid">
                  <span className="crm-ref">{d.complaint_id}</span>
                  <span aria-hidden> · </span>
                  {typeLabel(d.type)}
                  <span aria-hidden> · </span>
                  {d.office_name.replace(/\s+CCC$/i, '')}
                </span>
              </span>
            </button>
          ))}
          {!rows.length && <p className="crm-empty">No cases in this queue.</p>}
        </section>

        <section className="crm-record" aria-label="Case record">
          {open ? (
            <>
              <div className="crm-record-head">
                <button type="button" className="crm-back" onClick={() => setMobileRecord(false)}>
                  Queue
                </button>
                <div>
                  <p className="crm-id">{open.complaint_id}</p>
                  <h3>{open.complainant_name || '—'}</h3>
                </div>
                <span className={`badge ${delayClass(open)}`}>{delayPhrase(open)}</span>
              </div>

              <dl className="crm-fields">
                <div>
                  <dt>Status</dt>
                  <dd className="cap">{statusLabel(open.status)}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{typeLabel(open.type)}</dd>
                </div>
                <div>
                  <dt>Office</dt>
                  <dd>{open.office_name}</dd>
                </div>
                <div>
                  <dt>Consumer</dt>
                  <dd>
                    {open.complainant_type === 'consumer' && open.consumer_id
                      ? open.consumer_id
                      : 'Non-consumer'}
                  </dd>
                </div>
                <div>
                  <dt>Lodged</dt>
                  <dd>{fmtDay(open.lodged_on)}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>{fmtDay(open.target)}</dd>
                </div>
              </dl>

              {canCloseCase(user, open, isAdmin) && (
                <div className="crm-close-actions">
                  <button type="button" className="btn" disabled={busy} onClick={() => void closeCase('resolved')}>
                    Mark resolved
                  </button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => void closeCase('closed')}>
                    Close case
                  </button>
                </div>
              )}

              <section className="crm-card">
                <h4>Issue</h4>
                <div className="crm-card-body">
                  <p>{open.description || '—'}</p>
                </div>
              </section>

              <section className="crm-card">
                <h4>Assigned</h4>
                <div className="crm-card-body">
                  {isAdmin && staff.length > 0 ? (
                    <div className="griev-users">
                      {staff.map((u) => {
                        const on = open.followup_users.includes(u.username);
                        return (
                          <label key={u.username} className={`griev-user ${on ? 'on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy}
                              onChange={() => void saveAssignees(open, u.username, on)}
                            />
                            {u.name || u.username}
                          </label>
                        );
                      })}
                    </div>
                  ) : open.followup_users.length ? (
                    <div className="griev-users">
                      {open.followup_users.map((u) => (
                        <span key={u} className="griev-user on">
                          {staffName(u, staff)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted tight">No one assigned</p>
                  )}
                </div>
              </section>

              <section className="crm-card crm-activity">
                <h4>Follow-up</h4>
                <div className="crm-card-body">
                  {staleFollowup && <p className="crm-stale">Follow-up overdue — last log {open.last_followup}</p>}
                  {open.timeline.length > 0 ? (
                    <ol className="crm-timeline">
                      {[...open.timeline].reverse().map((t, i) => (
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
                  ) : (
                    <p className="muted tight">No follow-up logged yet.</p>
                  )}
                </div>
                {isDone(open.status) ? (
                  <div className="crm-card-foot">
                    <p className="muted tight">
                      This case is {statusLabel(open.status).toLowerCase()}. Follow-up is locked.
                    </p>
                  </div>
                ) : canLogFollowup(user, open, isAdmin) ? (
                  <div className="crm-card-foot crm-composer">
                    <textarea
                      rows={2}
                      maxLength={240}
                      value={remark}
                      placeholder="Add a follow-up note"
                      onChange={(e) => setRemark(maskText(e.target.value))}
                    />
                    <button type="button" className="btn" disabled={!remark.trim() || busy} onClick={() => void saveFollowup()}>
                      Log note
                    </button>
                  </div>
                ) : (
                  <div className="crm-card-foot">
                    <p className="muted tight">You are not assigned to log follow-up on this case.</p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <p className="crm-empty">Select a case from the queue.</p>
          )}
        </section>
      </div>

      {adding && (
        <div className="crm-modal-back" role="presentation" onClick={() => setAdding(false)}>
          <form
            className="crm-modal"
            role="dialog"
            aria-labelledby="crm-new-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void saveCase(true);
            }}
          >
            <div className="crm-modal-head">
              <h3 id="crm-new-title">New case</h3>
              <button type="button" className="btn secondary" onClick={() => setAdding(false)}>
                Close
              </button>
            </div>
            <div className="griev-step">
              <label className="field">
                <span>Type</span>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CaseType })}>
                  {TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Priority</span>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="field">
                <span>By</span>
                <select
                  value={form.complainant_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      complainant_type: e.target.value as 'consumer' | 'non_consumer',
                      consumer_id: e.target.value === 'non_consumer' ? '' : form.consumer_id,
                    })
                  }
                >
                  <option value="consumer">Consumer</option>
                  <option value="non_consumer">Non-consumer</option>
                </select>
              </label>
              <label className={`field ${tried && errors.complainant_name ? 'bad' : ''}`}>
                <span>Name</span>
                <input
                  value={form.complainant_name}
                  autoComplete="name"
                  maxLength={60}
                  onChange={(e) => setForm({ ...form, complainant_name: maskName(e.target.value) })}
                />
              </label>
              {form.complainant_type === 'consumer' && (
                <label className={`field ${tried && errors.consumer_id ? 'bad' : ''}`}>
                  <span>Consumer ID</span>
                  <input
                    value={form.consumer_id}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={11}
                    onChange={(e) => setForm({ ...form, consumer_id: maskConsumerId(e.target.value) })}
                  />
                </label>
              )}
              <label className={`field ${tried && errors.complainant_phone ? 'bad' : ''}`}>
                <span>Phone</span>
                <input
                  value={showPhone(form.complainant_phone)}
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={11}
                  onChange={(e) => setForm({ ...form, complainant_phone: maskPhone(e.target.value) })}
                />
              </label>
              <label className={`field ${tried && errors.office_code ? 'bad' : ''}`}>
                <span>Office</span>
                <select value={form.office_code} onChange={(e) => setForm({ ...form, office_code: e.target.value })}>
                  <option value="">—</option>
                  {officeOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`field ${tried && errors.lodged_on ? 'bad' : ''}`}>
                <span>Lodged</span>
                <input
                  type="date"
                  min="2020-01-01"
                  max={todayIso()}
                  value={form.lodged_on}
                  onChange={(e) => setForm({ ...form, lodged_on: e.target.value })}
                />
              </label>
              <label className={`field ${tried && errors.target_resolve_on ? 'bad' : ''}`}>
                <span>Target</span>
                <input
                  type="date"
                  min={form.lodged_on || todayIso()}
                  max={addDays(form.lodged_on || todayIso(), 90)}
                  value={form.target_resolve_on}
                  onChange={(e) => setForm({ ...form, target_resolve_on: e.target.value })}
                />
              </label>
              <label className={`field griev-desc ${tried && errors.short_description ? 'bad' : ''}`}>
                <span>Description</span>
                <textarea
                  rows={3}
                  maxLength={240}
                  value={form.short_description}
                  onChange={(e) => setForm({ ...form, short_description: maskText(e.target.value) })}
                />
              </label>
              <label className={`field griev-desc ${tried && errors.followup_users ? 'bad' : ''}`}>
                <span>Follow-up users</span>
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
            </div>
            {error && <p className="error">{error}</p>}
            <div className="griev-step-actions">
              <button type="button" className="btn secondary" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="button" className="btn secondary" disabled={busy} onClick={() => void saveCase(false)}>
                Save
              </button>
              <button type="submit" className="btn" disabled={busy}>
                {busy ? 'Saving…' : 'Save & next'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
