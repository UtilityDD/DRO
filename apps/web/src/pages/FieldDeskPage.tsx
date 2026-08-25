import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  canEdit,
  type FieldNote,
  type FieldNoteCounts,
  type FieldSite,
  type FieldStaff,
} from '../api';
import { useAuth } from '../auth';

type Pane = 'items' | 'sites';
type StatusFilter = 'open' | 'waiting' | 'done' | 'all';
type Kind = 'work' | 'assignment' | 'note';

const KINDS: { id: Kind; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'note', label: 'Note' },
];

const EMPTY_COUNTS: FieldNoteCounts = { open: 0, overdue: 0, today: 0, waiting: 0, done: 0, total: 0 };

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortSite(name: string) {
  return name.replace(/\s+CCC$/i, '').replace(/^Siliguri\s+/i, '').trim();
}

function isDone(status: string) {
  return status === 'done';
}

function isOverdue(row: FieldNote) {
  if (isDone(row.status) || !row.followup_at) return false;
  return Date.parse(row.followup_at) < Date.now();
}

function isDueToday(row: FieldNote) {
  if (isDone(row.status) || !row.followup_at) return false;
  const t = Date.parse(row.followup_at);
  if (!Number.isFinite(t)) return false;
  const a = new Date();
  a.setHours(0, 0, 0, 0);
  const b = new Date();
  b.setHours(23, 59, 59, 999);
  return t >= a.getTime() && t <= b.getTime();
}

function kindLabel(kind: string) {
  return KINDS.find((k) => k.id === kind)?.label || kind;
}

function siteKindLabel(site: { site_type: string; office_type?: string }) {
  if (site.site_type === 'custom') return 'Custom';
  if (site.site_type === 'ss') return 'Substation';
  if (site.office_type === 'division') return 'Division';
  return 'CCC';
}

function siteKey(site: { site_type: string; site_code: string }) {
  return `${site.site_type}:${site.site_code}`;
}

function matchesQuery(hay: string[], q: string) {
  if (!q) return true;
  return hay.join(' ').toLowerCase().includes(q);
}

function draftKey(id: number | string) {
  return `dro-field-body-${id}`;
}

function nowLocalInput() {
  return toLocalInput(new Date().toISOString());
}

function namesLine(names: string[] | undefined) {
  return (names || []).join(', ');
}

function emptyForm(site?: { site_type: string; site_code: string; site_name?: string } | null) {
  return {
    site_type: site?.site_type || 'office',
    site_code: site?.site_code || '',
    site_name: site?.site_type === 'custom' ? site?.site_name || '' : '',
    parent_code: '',
    kind: 'work' as Kind,
    title: '',
    body: '',
    priority: 'normal',
    followup_at: '',
    visited_at: nowLocalInput(),
    accompanied: '',
    assigned_to: [] as string[],
  };
}

function urgencyClass(row: FieldNote) {
  if (isDone(row.status)) return 'ok';
  if (isOverdue(row)) return 'danger';
  if (isDueToday(row) || row.priority === 'high') return 'warn';
  return '';
}

function followLabel(row: FieldNote) {
  if (isDone(row.status)) return 'Done';
  if (!row.followup_at) return 'No follow-up';
  if (isOverdue(row)) return `Overdue · ${fmtWhen(row.followup_at)}`;
  if (isDueToday(row)) return `Today · ${fmtWhen(row.followup_at)}`;
  return fmtWhen(row.followup_at);
}

export function FieldDeskPage() {
  const { user } = useAuth();
  const editable = canEdit(user, 'field_notes');
  const [pane, setPane] = useState<Pane>('items');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<FieldNote[]>([]);
  const [sites, setSites] = useState<FieldSite[]>([]);
  const [counts, setCounts] = useState<FieldNoteCounts>(EMPTY_COUNTS);
  const [staff, setStaff] = useState<FieldStaff[]>([]);
  const [open, setOpen] = useState<FieldNote | null>(null);
  const [openSite, setOpenSite] = useState<FieldSite | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'site' | 'item'>('list');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => emptyForm());
  const [draft, setDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [priorityDraft, setPriorityDraft] = useState('normal');
  const [statusDraft, setStatusDraft] = useState('open');
  const [kindDraft, setKindDraft] = useState<Kind>('note');
  const [followDraft, setFollowDraft] = useState('');
  const [visitDraft, setVisitDraft] = useState('');
  const [accompaniedDraft, setAccompaniedDraft] = useState('');
  const [siteNameDraft, setSiteNameDraft] = useState('');
  const [assigneesDraft, setAssigneesDraft] = useState<string[]>([]);
  const [standingDraft, setStandingDraft] = useState('');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);

  const load = useCallback(async () => {
    const [itemsRes, sitesRes] = await Promise.all([api.fieldNotes(), api.fieldNoteSites()]);
    setNotes(itemsRes.rows || []);
    setCounts(itemsRes.counts || EMPTY_COUNTS);
    setStaff(itemsRes.staff || sitesRes.staff || []);
    setSites(sitesRes.sites || []);
    return { items: itemsRes.rows || [], siteRows: sitesRes.sites || [] };
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const saved = sessionStorage.getItem(draftKey(open.id));
    setDraft(saved ?? open.body ?? '');
    setTitleDraft(open.title || '');
    setPriorityDraft(open.priority || 'normal');
    setStatusDraft(open.status || 'open');
    setKindDraft((open.kind as Kind) || 'note');
    setFollowDraft(toLocalInput(open.followup_at));
    setVisitDraft(toLocalInput(open.last_visited_at));
    setAccompaniedDraft(namesLine(open.accompanied));
    setSiteNameDraft(open.site_name || '');
    setAssigneesDraft(open.assigned_to || []);
    setRemark('');
  }, [open?.id]);

  useEffect(() => {
    if (!open) return;
    sessionStorage.setItem(draftKey(open.id), draft);
  }, [open?.id, draft]);

  const q = query.trim().toLowerCase();

  const itemRows = useMemo(() => {
    return notes
      .filter((row) => row.kind !== 'note')
      .filter((row) => {
        if (statusFilter === 'open') return !isDone(row.status) && row.status !== 'waiting';
        if (statusFilter === 'waiting') return row.status === 'waiting';
        if (statusFilter === 'done') return isDone(row.status);
        return true;
      })
      .filter((row) =>
        matchesQuery(
          [row.title, row.body, row.site_name, row.kind, ...(row.assigned_to || []), ...(row.accompanied || [])],
          q
        )
      );
  }, [notes, statusFilter, q]);

  const siteRows = useMemo(
    () =>
      sites.filter((s) =>
        matchesQuery([s.site_name, s.office_name || '', siteKindLabel(s), s.site_code], q)
      ),
    [sites, q]
  );

  const siteItems = useMemo(() => {
    if (!openSite) return [];
    const key = siteKey(openSite);
    return notes.filter((n) => siteKey(n) === key);
  }, [notes, openSite]);

  const applyRow = (row: FieldNote) => {
    setNotes((prev) => {
      const i = prev.findIndex((n) => n.id === row.id);
      if (i < 0) return [row, ...prev];
      const next = [...prev];
      next[i] = row;
      return next;
    });
    setOpen((prev) => (prev && prev.id === row.id ? row : prev));
  };

  const selectItem = (row: FieldNote) => {
    setOpen(row);
    setMobileView('item');
    setError('');
  };

  const selectSite = (site: FieldSite) => {
    setOpenSite(site);
    setStandingDraft(site.standing_body || '');
    setMobileView('site');
    setError('');
  };

  const backToList = () => {
    setMobileView('list');
    if (pane === 'items') setOpenSite(null);
  };

  const startAdd = (site?: FieldSite | null) => {
    setAdding(true);
    setTried(false);
    setError('');
    const next = emptyForm(site);
    if (!next.site_code) {
      const first = sites[0];
      if (first) {
        next.site_type = first.site_type;
        next.site_code = first.site_code;
      }
    }
    const stored = sessionStorage.getItem(draftKey('new'));
    if (stored) next.body = stored;
    setForm(next);
  };

  const saveNew = async () => {
    setTried(true);
    if (!form.site_code && form.site_type !== 'custom') return;
    if (form.site_type === 'custom' && form.site_name.trim().length < 2) return;
    if (form.kind !== 'note' && form.title.trim().length < 2) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.createFieldNote({
        site_type: form.site_type,
        site_code: form.site_code,
        site_name: form.site_name.trim(),
        parent_code: form.parent_code || undefined,
        kind: form.kind,
        title: form.title.trim(),
        body: form.body.trim(),
        priority: form.priority,
        followup_at: fromLocalInput(form.followup_at),
        visited_at: fromLocalInput(form.visited_at),
        accompanied: form.accompanied,
        assigned_to: form.assigned_to,
      });
      sessionStorage.removeItem(draftKey('new'));
      setAdding(false);
      applyRow(res.row);
      setOpen(res.row);
      setMobileView('item');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async (extra: Record<string, unknown> = {}) => {
    if (!open) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.patchFieldNote(open.id, {
        title: titleDraft.trim(),
        body: draft,
        priority: priorityDraft,
        status: statusDraft,
        kind: kindDraft,
        followup_at: fromLocalInput(followDraft),
        last_visited_at: fromLocalInput(visitDraft),
        accompanied: accompaniedDraft,
        site_name: open.site_type === 'custom' ? siteNameDraft.trim() : undefined,
        assigned_to: assigneesDraft,
        ...extra,
      });
      sessionStorage.removeItem(draftKey(open.id));
      applyRow(res.row);
      setOpen(res.row);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const saveStanding = async () => {
    if (!openSite) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.createFieldNote({
        site_type: openSite.site_type,
        site_code: openSite.site_code,
        kind: 'note',
        standing: true,
        title: 'Site notes',
        body: standingDraft,
      });
      applyRow(res.row);
      await load().then(({ siteRows: nextSites }) => {
        const fresh = nextSites.find((s) => siteKey(s) === siteKey(openSite));
        if (fresh) {
          setOpenSite(fresh);
          setStandingDraft(fresh.standing_body || standingDraft);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save notes');
    } finally {
      setBusy(false);
    }
  };

  const visitNow = async (target: FieldNote | FieldSite) => {
    setBusy(true);
    setError('');
    try {
      if ('id' in target) {
        const res = await api.visitFieldNote({
          id: target.id,
          visited_at: fromLocalInput(visitDraft) || new Date().toISOString(),
          accompanied: accompaniedDraft,
        });
        applyRow(res.row);
      } else {
        await api.visitFieldNote({
          site_type: target.site_type,
          site_code: target.site_code,
          site_name: target.site_name,
          visited_at: new Date().toISOString(),
        });
        await load().then(({ siteRows: nextSites }) => {
          const fresh = nextSites.find((s) => siteKey(s) === siteKey(target));
          if (fresh) setOpenSite(fresh);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Visit failed');
    } finally {
      setBusy(false);
    }
  };

  const addFollowup = async () => {
    const note = remark.trim();
    if (!open || note.length < 2) return;
    await saveItem({ followup: note });
    setRemark('');
  };

  const dirtyItem =
    open &&
    (draft !== (open.body || '') ||
      titleDraft !== (open.title || '') ||
      priorityDraft !== (open.priority || 'normal') ||
      statusDraft !== (open.status || 'open') ||
      kindDraft !== open.kind ||
      followDraft !== toLocalInput(open.followup_at) ||
      visitDraft !== toLocalInput(open.last_visited_at) ||
      accompaniedDraft !== namesLine(open.accompanied) ||
      (open.site_type === 'custom' && siteNameDraft !== (open.site_name || '')) ||
      assigneesDraft.join(',') !== (open.assigned_to || []).join(','));

  const showRecord = mobileView !== 'list';
  const officeSites = sites.filter((s) => s.site_type === 'office' && s.office_type === 'division');
  const cccSites = sites.filter((s) => s.site_type === 'office' && s.office_type !== 'division');
  const ssSites = sites.filter((s) => s.site_type === 'ss');
  const customSites = sites.filter((s) => s.site_type === 'custom');

  return (
    <div className={`crm-desk field-desk${showRecord ? ' show-record' : ''}`}>
      <header className="crm-toolbar">
        <div className="crm-title">
          <h2>Field Desk</h2>
          <span className="muted">
            {counts.open} open
            {counts.overdue ? ` · ${counts.overdue} overdue` : ''}
            {counts.today ? ` · ${counts.today} today` : ''}
          </span>
        </div>
        <div className="crm-tools field-tools">
          <div className="field-tabs" role="tablist" aria-label="Field views">
            <button type="button" className={pane === 'items' ? 'on' : ''} onClick={() => { setPane('items'); backToList(); }}>
              Items
            </button>
            <button type="button" className={pane === 'sites' ? 'on' : ''} onClick={() => { setPane('sites'); setMobileView('list'); }}>
              Sites
            </button>
          </div>
          <input
            className="crm-search"
            value={query}
            placeholder={pane === 'sites' ? 'Search office, SS or custom site' : 'Search notes, site, people'}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search field desk"
          />
          {editable && (
            <button type="button" className="btn field-new-btn" onClick={() => startAdd(openSite)}>
              New
            </button>
          )}
        </div>
      </header>

      {error && !adding && <p className="error crm-banner">{error}</p>}

      <div className="crm-split">
        <section className="crm-list" aria-label={pane === 'sites' ? 'Sites' : 'Field items'}>
          {pane === 'items' && (
            <nav className="crm-queues" aria-label="Item queues">
              {([
                ['open', 'Open', notes.filter((n) => n.kind !== 'note' && !isDone(n.status) && n.status !== 'waiting').length],
                ['waiting', 'Waiting', notes.filter((n) => n.kind !== 'note' && n.status === 'waiting').length],
                ['done', 'Done', notes.filter((n) => n.kind !== 'note' && isDone(n.status)).length],
                ['all', 'All', notes.filter((n) => n.kind !== 'note').length],
              ] as const).map(([id, label, n]) => (
                <button
                  key={id}
                  type="button"
                  className={`crm-queue ${statusFilter === id ? 'on' : ''}`}
                  onClick={() => setStatusFilter(id)}
                >
                  {label}
                  <b>{Math.max(n, 0)}</b>
                </button>
              ))}
            </nav>
          )}

          {pane === 'items'
            ? itemRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`crm-item ${urgencyClass(row)}${open?.id === row.id ? ' is-selected' : ''}`}
                  onClick={() => selectItem(row)}
                >
                  <span className="crm-item-body">
                    <span className="crm-item-top">
                      <strong>{row.title || 'Untitled'}</strong>
                      <span className={`field-chip pri-${row.priority}`}>{row.priority}</span>
                    </span>
                    <span className="crm-item-mid">
                      {kindLabel(row.kind)}
                      <span aria-hidden> · </span>
                      {shortSite(row.site_name)}
                      {row.site_type === 'ss' ? ' SS' : row.site_type === 'custom' ? ' · custom' : ''}
                      {row.last_visited_at ? ` · visited ${fmtWhen(row.last_visited_at)}` : ''}
                      {(row.accompanied || []).length ? ` · with ${row.accompanied.slice(0, 3).join(', ')}` : ''}
                    </span>
                    <span className={`crm-delay ${isOverdue(row) ? '' : ''}`}>{followLabel(row)}</span>
                  </span>
                </button>
              ))
            : siteRows.map((site) => (
                <button
                  key={siteKey(site)}
                  type="button"
                  className={`crm-item ${site.overdue_count ? 'danger' : site.open_count ? 'warn' : ''}${
                    openSite && siteKey(openSite) === siteKey(site) ? ' is-selected' : ''
                  }`}
                  onClick={() => selectSite(site)}
                >
                  <span className="crm-item-body">
                    <span className="crm-item-top">
                      <strong>{shortSite(site.site_name)}</strong>
                      {site.overdue_count ? <span className="crm-delay">{site.overdue_count} overdue</span> : null}
                    </span>
                    <span className="crm-item-mid">
                      {siteKindLabel(site)}
                      <span aria-hidden> · </span>
                      {site.open_count} open
                      {site.last_visited_at ? ` · visited ${fmtWhen(site.last_visited_at)}` : ''}
                      {site.next_followup_at ? ` · next ${fmtWhen(site.next_followup_at)}` : ''}
                    </span>
                  </span>
                </button>
              ))}

          {pane === 'items' && !itemRows.length && <p className="crm-empty">No items in this queue.</p>}
          {pane === 'sites' && !siteRows.length && <p className="crm-empty">No offices, substations, or custom sites match.</p>}
        </section>

        <section className="crm-record field-record" aria-label="Record">
          {mobileView === 'item' && open ? (
            <>
              <div className="crm-record-head">
                <button type="button" className="crm-back" onClick={() => (openSite ? setMobileView('site') : backToList())}>
                  Back
                </button>
                <div>
                  <p className="crm-id">
                    {kindLabel(open.kind)} · {shortSite(open.site_name)}
                    {open.site_type === 'ss' ? ' SS' : open.site_type === 'custom' ? ' · custom' : ''}
                  </p>
                  <h3>{open.title || 'Untitled'}</h3>
                </div>
              </div>

              {isOverdue(open) && <p className="crm-stale">Follow-up overdue — {fmtWhen(open.followup_at)}</p>}

              <div className="field-form">
                {open.site_type === 'custom' && (
                  <label className="field">
                    <span>Site name</span>
                    <input
                      value={siteNameDraft}
                      maxLength={80}
                      disabled={!editable}
                      onChange={(e) => setSiteNameDraft(e.target.value)}
                    />
                  </label>
                )}
                <label className="field">
                  <span>Title</span>
                  <input
                    value={titleDraft}
                    maxLength={120}
                    disabled={!editable}
                    onChange={(e) => setTitleDraft(e.target.value)}
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Kind</span>
                    <select value={kindDraft} disabled={!editable} onChange={(e) => setKindDraft(e.target.value as Kind)}>
                      {KINDS.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Priority</span>
                    <select value={priorityDraft} disabled={!editable} onChange={(e) => setPriorityDraft(e.target.value)}>
                      <option value="high">High</option>
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select value={statusDraft} disabled={!editable} onChange={(e) => setStatusDraft(e.target.value)}>
                      <option value="open">Open</option>
                      <option value="waiting">Waiting</option>
                      <option value="done">Done</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>Notes</span>
                  <textarea
                    rows={7}
                    value={draft}
                    disabled={!editable}
                    placeholder="Works, instructions, what you saw on site…"
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Visit date & time</span>
                  <input
                    type="datetime-local"
                    value={visitDraft}
                    disabled={!editable}
                    onChange={(e) => setVisitDraft(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Persons accompanied</span>
                  <input
                    value={accompaniedDraft}
                    disabled={!editable}
                    placeholder="Names, comma separated"
                    onChange={(e) => setAccompaniedDraft(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Follow-up</span>
                  <input
                    type="datetime-local"
                    value={followDraft}
                    disabled={!editable}
                    onChange={(e) => setFollowDraft(e.target.value)}
                  />
                </label>
                {staff.length > 0 && (
                  <div className="field">
                    <span>Assigned</span>
                    <div className="field-assignees">
                      {staff.map((u) => {
                        const on = assigneesDraft.includes(u.username);
                        return (
                          <button
                            key={u.username}
                            type="button"
                            className={`field-chip toggle ${on ? 'on' : ''}`}
                            disabled={!editable}
                            onClick={() =>
                              setAssigneesDraft((prev) =>
                                on ? prev.filter((x) => x !== u.username) : [...prev, u.username]
                              )
                            }
                          >
                            {u.name.split(' ')[0]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {editable && (
                <div className="field-actions">
                  <button type="button" className="btn" disabled={busy || !dirtyItem} onClick={() => void saveItem()}>
                    Save changes
                  </button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => void visitNow(open)}>
                    Visit now
                  </button>
                </div>
              )}

              {editable && (
                <div className="crm-composer">
                  <textarea
                    rows={2}
                    value={remark}
                    placeholder="Add a follow-up remark (keeps the notes above)"
                    onChange={(e) => setRemark(e.target.value)}
                  />
                  <button type="button" className="btn secondary" disabled={busy || remark.trim().length < 2} onClick={() => void addFollowup()}>
                    Log follow-up
                  </button>
                </div>
              )}

              <ol className="field-timeline">
                {(open.updates || []).slice(0, 20).map((u, i) => (
                  <li key={`${u.at}-${i}`}>
                    <b>{u.kind}</b>
                    <span>{fmtWhen(u.at)} · {u.by}</span>
                    {u.text ? <p>{u.text}</p> : null}
                  </li>
                ))}
                {!open.updates?.length && <p className="muted tight">No history yet.</p>}
              </ol>
            </>
          ) : mobileView === 'site' && openSite ? (
            <>
              <div className="crm-record-head">
                <button type="button" className="crm-back" onClick={backToList}>
                  Back
                </button>
                <div>
                  <p className="crm-id">{siteKindLabel(openSite)}</p>
                  <h3>{shortSite(openSite.site_name)}</h3>
                </div>
              </div>
              <p className="muted tight">
                {openSite.open_count} open
                {openSite.overdue_count ? ` · ${openSite.overdue_count} overdue` : ''}
                {openSite.last_visited_at ? ` · last visit ${fmtWhen(openSite.last_visited_at)}` : ''}
              </p>
              <label className="field">
                <span>Site notes</span>
                <textarea
                  rows={6}
                  value={standingDraft}
                  disabled={!editable}
                  placeholder="Standing notes for this office / SS — you can replace this text later"
                  onChange={(e) => setStandingDraft(e.target.value)}
                />
              </label>
              {editable && (
                <div className="field-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || standingDraft === (openSite.standing_body || '')}
                    onClick={() => void saveStanding()}
                  >
                    Save notes
                  </button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => void visitNow(openSite)}>
                    Visit now
                  </button>
                  <button type="button" className="btn secondary" onClick={() => startAdd(openSite)}>
                    Add item
                  </button>
                </div>
              )}
              <div className="field-site-items">
                {siteItems.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`crm-item ${urgencyClass(row)}`}
                    onClick={() => selectItem(row)}
                  >
                    <span className="crm-item-body">
                      <span className="crm-item-top">
                        <strong>{row.title || 'Untitled'}</strong>
                        <span className={`field-chip pri-${row.priority}`}>{row.priority}</span>
                      </span>
                      <span className="crm-item-mid">
                        {kindLabel(row.kind)} · {followLabel(row)}
                      </span>
                    </span>
                  </button>
                ))}
                {!siteItems.length && <p className="crm-empty">No works or assignments here yet.</p>}
              </div>
            </>
          ) : (
            <p className="crm-empty">
              {pane === 'sites' ? 'Select an office or substation.' : 'Select an item, or add one while you are on site.'}
            </p>
          )}
        </section>
      </div>

      {editable && mobileView === 'list' && (
        <button type="button" className="field-fab" aria-label="New field item" onClick={() => startAdd(openSite)}>
          +
        </button>
      )}

      {adding && (
        <div className="crm-modal-back" role="presentation" onClick={() => setAdding(false)}>
          <form
            className="crm-modal"
            role="dialog"
            aria-labelledby="field-new-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void saveNew();
            }}
          >
            <div className="crm-modal-head">
              <h3 id="field-new-title">New field item</h3>
              <button type="button" className="btn secondary" onClick={() => setAdding(false)}>
                Close
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            <label className={`field ${tried && form.site_type !== 'custom' && !form.site_code ? 'bad' : ''}`}>
              <span>Site</span>
              <select
                value={`${form.site_type}:${form.site_code}`}
                onChange={(e) => {
                  const [site_type, ...rest] = e.target.value.split(':');
                  const site_code = rest.join(':');
                  const found = site_type === 'custom' && site_code ? customSites.find((s) => s.site_code === site_code) : null;
                  setForm({
                    ...form,
                    site_type,
                    site_code,
                    site_name: found?.site_name || (site_type === 'custom' ? form.site_name : ''),
                  });
                }}
              >
                <option value="office:">Pick office or SS</option>
                <option value="custom:">Custom site…</option>
                {customSites.length > 0 && (
                  <optgroup label="Custom sites">
                    {customSites.map((s) => (
                      <option key={siteKey(s)} value={siteKey(s)}>
                        {s.site_name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {officeSites.length > 0 && (
                  <optgroup label="Divisions">
                    {officeSites.map((s) => (
                      <option key={siteKey(s)} value={siteKey(s)}>
                        {s.site_name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {cccSites.length > 0 && (
                  <optgroup label="CCC">
                    {cccSites.map((s) => (
                      <option key={siteKey(s)} value={siteKey(s)}>
                        {shortSite(s.site_name)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {ssSites.length > 0 && (
                  <optgroup label="Substations">
                    {ssSites.map((s) => (
                      <option key={siteKey(s)} value={siteKey(s)}>
                        {s.site_name} SS
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {form.site_type === 'custom' && (
              <>
                <label className={`field ${tried && form.site_name.trim().length < 2 ? 'bad' : ''}`}>
                  <span>Site name</span>
                  <input
                    value={form.site_name}
                    maxLength={80}
                    placeholder="Village, feeder, mill, camp…"
                    onChange={(e) => setForm({ ...form, site_name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Under office (optional)</span>
                  <select
                    value={form.parent_code}
                    onChange={(e) => setForm({ ...form, parent_code: e.target.value })}
                  >
                    <option value="">None</option>
                    {cccSites.map((s) => (
                      <option key={s.site_code} value={s.site_code}>
                        {shortSite(s.site_name)} CCC
                      </option>
                    ))}
                    {officeSites.map((s) => (
                      <option key={s.site_code} value={s.site_code}>
                        {s.site_name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="field-row">
              <label className="field">
                <span>Kind</span>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
                  {KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
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
            </div>
            <label className={`field ${tried && form.kind !== 'note' && form.title.trim().length < 2 ? 'bad' : ''}`}>
              <span>Title</span>
              <input
                value={form.title}
                maxLength={120}
                placeholder="What needs doing"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea
                rows={5}
                value={form.body}
                placeholder="Assignment, observation, next step…"
                onChange={(e) => {
                  setForm({ ...form, body: e.target.value });
                  sessionStorage.setItem(draftKey('new'), e.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>Visit date & time</span>
              <input
                type="datetime-local"
                value={form.visited_at}
                onChange={(e) => setForm({ ...form, visited_at: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Persons accompanied</span>
              <input
                value={form.accompanied}
                placeholder="Names, comma separated"
                onChange={(e) => setForm({ ...form, accompanied: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Follow-up</span>
              <input
                type="datetime-local"
                value={form.followup_at}
                onChange={(e) => setForm({ ...form, followup_at: e.target.value })}
              />
            </label>
            {staff.length > 0 && (
              <div className="field">
                <span>Assign</span>
                <div className="field-assignees">
                  {staff.map((u) => {
                    const on = form.assigned_to.includes(u.username);
                    return (
                      <button
                        key={u.username}
                        type="button"
                        className={`field-chip toggle ${on ? 'on' : ''}`}
                        onClick={() =>
                          setForm({
                            ...form,
                            assigned_to: on
                              ? form.assigned_to.filter((x) => x !== u.username)
                              : [...form.assigned_to, u.username],
                          })
                        }
                      >
                        {u.name.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <button type="submit" className="btn" disabled={busy}>
              Save item
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
