import { FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  api,
  AUTH_MODULES,
  emptyPermissions,
  type Permissions,
  type User,
} from '../api';
import { useAuth } from '../auth';

type FormState = {
  username: string;
  pin: string;
  name: string;
  role: string;
  division_code: string;
  ccc_code: string;
  permissions: Permissions;
};

function blankForm(): FormState {
  return {
    username: '',
    pin: '0000',
    name: '',
    role: 'ccc',
    division_code: '',
    ccc_code: '',
    permissions: emptyPermissions(),
  };
}

function PermMatrix({
  value,
  onChange,
  disabled,
}: {
  value: Permissions;
  onChange: (next: Permissions) => void;
  disabled?: boolean;
}) {
  const toggle = (mod: string, action: 'view' | 'upload' | 'edit') => {
    if (disabled) return;
    const next = structuredClone(value);
    if (!next[mod]) next[mod] = { view: false, upload: false, edit: false };
    next[mod][action] = !next[mod][action];
    if ((action === 'upload' || action === 'edit') && next[mod][action]) {
      next[mod].view = true;
    }
    if (action === 'view' && !next[mod].view) {
      next[mod].upload = false;
      next[mod].edit = false;
    }
    onChange(next);
  };

  return (
    <div className="perm-matrix-wrap">
      <table className="perm-matrix">
        <thead>
          <tr>
            <th>Database / Module</th>
            <th>View</th>
            <th>Upload</th>
            <th>Edit</th>
          </tr>
        </thead>
        <tbody>
          {AUTH_MODULES.map((m) => (
            <tr key={m.id}>
              <td>{m.label}</td>
              {(['view', 'upload', 'edit'] as const).map((action) => (
                <td key={action}>
                  <label className="perm-check">
                    <input
                      type="checkbox"
                      disabled={disabled || (m.id === 'field_notes' && action === 'upload')}
                      checked={Boolean(value[m.id]?.[action])}
                      onChange={() => toggle(m.id, action)}
                    />
                    <span className="sr-only">
                      {action} {m.id}
                    </span>
                  </label>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function summarizePerms(p?: Permissions) {
  if (!p) return '—';
  const parts: string[] = [];
  for (const m of AUTH_MODULES) {
    const f = p[m.id];
    if (!f) continue;
    const flags = [
      f.view ? 'V' : '',
      f.upload ? 'U' : '',
      f.edit ? 'E' : '',
    ]
      .filter(Boolean)
      .join('');
    if (flags) parts.push(`${m.id}:${flags}`);
  }
  return parts.join(' · ') || 'none';
}

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<FormState>(blankForm());
  const [editing, setEditing] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = async () => {
    const [u, a] = await Promise.all([api.users(), api.activity()]);
    setUsers(u.users);
    setLogs(a.rows);
  };

  useEffect(() => {
    if (user?.role === 'admin') {
      refresh().catch((e) => setError(e.message));
    }
  }, [user]);

  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  const startEdit = (u: User) => {
    setEditing(u.username);
    setForm({
      username: u.username,
      pin: '',
      name: u.name,
      role: u.role,
      division_code: u.division_code || '',
      ccc_code: u.ccc_code || '',
      permissions: u.permissions ? structuredClone(u.permissions) : emptyPermissions(),
    });
    setMessage(`Editing ${u.username}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(blankForm());
    setMessage('');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      if (editing) {
        const body: Partial<User> & { pin?: string; permissions?: Permissions } = {
          name: form.name,
          role: form.role,
          division_code: form.division_code,
          ccc_code: form.ccc_code,
          permissions: form.role === 'admin' ? emptyPermissions() : form.permissions,
        };
        if (form.pin.trim()) body.pin = form.pin.trim();
        await api.updateUser(editing, body);
        setMessage(`Updated ${editing}`);
      } else {
        await api.createUser({
          username: form.username,
          pin: form.pin,
          name: form.name,
          role: form.role,
          division_code: form.division_code,
          ccc_code: form.ccc_code,
          permissions: form.permissions,
        });
        setMessage(`Created ${form.username}`);
      }
      cancelEdit();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  return (
    <div className="stack">
      <div className="panel present-hide">
        <h2>{editing ? `Edit user · ${editing}` : 'Create user & authorization'}</h2>
        <p className="muted tight">
          Grant <strong>View</strong>, <strong>Upload</strong>, and <strong>Edit</strong> per database. Office scope still
          limits which CCC/Division rows they see.
        </p>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            {!editing && (
              <label>
                Username
                <input
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>
            )}
            <label>
              {editing ? 'New PIN (optional)' : 'PIN'}
              <input
                required={!editing}
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value })}
                placeholder={editing ? 'Leave blank to keep' : ''}
              />
            </label>
            <label>
              Name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Role
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="admin">admin (full access)</option>
                <option value="region">region</option>
                <option value="division">division</option>
                <option value="ccc">ccc</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
            <label>
              Division code
              <input
                value={form.division_code}
                onChange={(e) => setForm({ ...form, division_code: e.target.value })}
                placeholder="3412"
              />
            </label>
            <label>
              CCC code
              <input
                value={form.ccc_code}
                onChange={(e) => setForm({ ...form, ccc_code: e.target.value })}
                placeholder="3412502"
              />
            </label>
          </div>

          {form.role !== 'admin' ? (
            <>
              <h3 className="perm-heading">Module authorization</h3>
              <PermMatrix
                value={form.permissions}
                onChange={(permissions) => setForm({ ...form, permissions })}
              />
            </>
          ) : (
            <p className="muted">Admin role always has View + Upload + Edit on every database.</p>
          )}

          {error && <p className="error">{error}</p>}
          {message && <p className="muted">{message}</p>}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <button className="btn" type="submit">
              {editing ? 'Save authorization' : 'Create user'}
            </button>
            {editing && (
              <button type="button" className="btn secondary" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Users database</h2>
        <div className="table-wrap desktop-only">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Role</th>
                <th>Division</th>
                <th>CCC</th>
                <th>Grants (V/U/E)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td>{u.name}</td>
                  <td>{u.role}</td>
                  <td>{u.division_code || '—'}</td>
                  <td>{u.ccc_code || '—'}</td>
                  <td className="perm-summary">{u.role === 'admin' ? 'ALL' : summarizePerms(u.permissions)}</td>
                  <td>
                    <div className="present-hide" style={{ display: 'flex', gap: '0.35rem' }}>
                      <button type="button" className="btn secondary" onClick={() => startEdit(u)}>
                        Edit
                      </button>
                      {u.username !== 'admin' && (
                        <button
                          type="button"
                          className="btn danger"
                          onClick={async () => {
                            await api.deleteUser(u.username);
                            await refresh();
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mobile-cards mobile-only">
          {users.map((u) => (
            <article className="data-card" key={u.username}>
              <div className="data-card-top">
                <div>
                  <div className="data-card-title">{u.name}</div>
                  <div className="data-card-sub">
                    {u.username} · {u.role}
                  </div>
                </div>
              </div>
              <div className="data-card-grid">
                <div>
                  <span className="meta-label">Division</span>
                  <span>{u.division_code || '—'}</span>
                </div>
                <div>
                  <span className="meta-label">CCC</span>
                  <span>{u.ccc_code || '—'}</span>
                </div>
              </div>
              <p className="muted" style={{ fontSize: '0.75rem', margin: '0.55rem 0 0' }}>
                {u.role === 'admin' ? 'ALL permissions' : summarizePerms(u.permissions)}
              </p>
              <div className="data-card-actions present-hide" style={{ display: 'flex', gap: '0.45rem' }}>
                <button type="button" className="btn secondary" onClick={() => startEdit(u)}>
                  Edit auth
                </button>
                {u.username !== 'admin' && (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={async () => {
                      await api.deleteUser(u.username);
                      await refresh();
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Activity log</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 40).map((l) => (
                <tr key={String(l.id)}>
                  <td>{String(l.created_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td>{String(l.username)}</td>
                  <td>{String(l.action)}</td>
                  <td>{String(l.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
