export type PermFlags = { view: boolean; upload: boolean; edit: boolean };

export type Permissions = Record<string, PermFlags>;

export type User = {
  id: number;
  username: string;
  name: string;
  role: string;
  zone_code?: string;
  region_code?: string;
  division_code?: string;
  ccc_code?: string;
  permissions?: Permissions;
  // legacy mirrors (still returned by API)
  mod_nsc?: boolean;
  mod_disco?: boolean;
  mod_grievance?: boolean;
  mod_tech_works?: boolean;
  mod_spot_billing?: boolean;
  mod_bulk?: boolean;
  upload_nsc?: boolean;
  upload_disco?: boolean;
  upload_grievance?: boolean;
  upload_tech_works?: boolean;
  upload_spot_billing?: boolean;
  upload_consumer_master?: boolean;
  upload_bulk?: boolean;
};

export type AuthModule = {
  id: string;
  label: string;
  uploadKey: string;
  view?: boolean;
  upload?: boolean;
  edit?: boolean;
};

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw newError(data.error || res.statusText, res.status);
  return data as T;
}

function newError(message: string, status: number) {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

export const api = {
  login: (username: string, pin: string) =>
    request<{ ok: boolean; user: User }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, pin }),
    }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  session: () => request<{ user: User | null }>('/api/session'),
  authCatalog: () => request<{ modules: AuthModule[]; permissions: Permissions }>('/api/auth/catalog'),
  pulse: () => request<{ pulse: Record<string, number> }>('/api/pulse'),
  hierarchy: () =>
    request<{
      region: Office;
      divisions: (Office & { cccs: Office[] })[];
    }>('/api/hierarchy'),
  offices: (type?: string) =>
    request<{ offices: Office[] }>(`/api/offices${type ? `?type=${type}` : ''}`),
  nsc: (q = '') =>
    request<{ rows: Record<string, unknown>[]; total: number; can_edit?: boolean; can_upload?: boolean }>(`/api/nsc${q}`),
  nscSummary: () => request<{ byStatus: Record<string, number>; byDivision: DivSum[]; total: number }>('/api/nsc/summary'),
  disco: (q = '') =>
    request<{ rows: Record<string, unknown>[]; total: number; can_edit?: boolean }>(`/api/disco${q}`),
  discoSummary: () =>
    request<{ byDivision: DivSum[]; total: number; totalDue: number; pending: number }>('/api/disco/summary'),
  grievances: (q = '') =>
    request<{ rows: Record<string, unknown>[]; total: number; can_edit?: boolean }>(`/api/grievances${q}`),
  techWorks: (q = '') =>
    request<{ rows: Record<string, unknown>[]; total: number; can_edit?: boolean }>(`/api/tech-works${q}`),
  spotBilling: (q = '') => request<{ rows: Record<string, unknown>[]; total: number }>(`/api/spot-billing${q}`),
  bulk: (q = '') => request<{ rows: Record<string, unknown>[]; total: number; can_edit?: boolean }>(`/api/bulk${q}`),
  consumers: (q = '') =>
    request<{ rows: Record<string, unknown>[]; total: number }>(`/api/consumers?q=${encodeURIComponent(q)}`),
  atc: (period = '') =>
    request<{
      rows: Record<string, unknown>[];
      periods?: string[];
      formats?: string[];
      can_upload?: boolean;
      source?: string;
      host?: string;
    }>(`/api/atc${period ? `?period=${encodeURIComponent(period)}` : ''}`),
  atcQuery: (qs = '') =>
    request<{
      rows: Record<string, unknown>[];
      periods?: string[];
      formats?: string[];
      can_upload?: boolean;
      can_edit?: boolean;
      source?: string;
      host?: string;
    }>(`/api/atc${qs ? `?${qs}` : ''}`),
  atcParse: (body: { base64: string; period_label?: string; filename?: string }) =>
    request<{
      ok: boolean;
      period_label?: string;
      target_fy?: string;
      rows: Record<string, unknown>[];
      filtered_out?: number;
      counts: { IA: number; IB: number };
      error?: string;
    }>('/api/atc/parse', { method: 'POST', body: JSON.stringify(body) }),
  patchAtc: (body: {
    period_label: string;
    source_format: 'IA' | 'IB';
    office_code: string;
    patch: Record<string, number | null>;
  }) =>
    request<{ ok: boolean; row: Record<string, unknown> }>('/api/atc', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  batches: () => request<{ rows: Record<string, unknown>[] }>('/api/batches'),
  activity: () => request<{ rows: Record<string, unknown>[] }>('/api/activity'),
  users: () => request<{ users: User[]; modules: AuthModule[] }>('/api/users'),
  createUser: (body: Partial<User> & { pin?: string; permissions?: Permissions }) =>
    request<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (username: string, body: Partial<User> & { pin?: string; permissions?: Permissions }) =>
    request<{ user: User }>(`/api/users/${username}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteUser: (username: string) =>
    request<{ ok: boolean }>(`/api/users/${username}`, { method: 'DELETE' }),
  upload: (module: string, body: { rows: Record<string, unknown>[]; filename?: string; period_label?: string; notes?: string }) =>
    request<{
      ok: boolean;
      upserted: number;
      batch: Record<string, unknown>;
      store?: string;
      cloud?: { store?: string; persisted?: boolean; host?: string; error?: string; rows?: number };
    }>(`/api/upload/${module}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  health: () =>
    request<{
      ok?: boolean;
      store?: string;
      supabase?: { configured?: boolean; host?: string | null };
    }>('/api/health'),
  patchNsc: (applicationNo: string, body: Record<string, unknown>) =>
    request(`/api/nsc/${encodeURIComponent(applicationNo)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  patchDisco: (id: number | string, body: Record<string, unknown>) =>
    request(`/api/disco/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  patchGrievance: (docketNo: string, body: Record<string, unknown>) =>
    request(`/api/grievances/${encodeURIComponent(docketNo)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  patchTech: (workId: string, body: Record<string, unknown>) =>
    request(`/api/tech-works/${encodeURIComponent(workId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

export type Office = {
  id: number;
  office_type: string;
  code: string;
  name: string;
  parent_code?: string | null;
  region_code?: string | null;
  division_code?: string | null;
  consumer_count?: number;
};

export type DivSum = {
  division_code: string;
  division_name: string;
  pending?: number;
  total?: number;
  avg_delay?: number;
  reconnected?: number;
  total_due?: number;
};

const MODULE_ROUTE: Record<string, string> = {
  '/nsc': 'nsc',
  '/disco': 'disco',
  '/grievances': 'grievance',
  '/tech-works': 'tech_works',
  '/spot-billing': 'spot_billing',
  '/bulk': 'bulk',
  '/consumers': 'consumers',
  '/atc': 'atc',
  '/upload': '__upload__',
};

function isAdminRole(user: User | null): boolean {
  return String(user?.role || '').toLowerCase() === 'admin';
}

export function canView(user: User | null, moduleId: string): boolean {
  if (!user) return false;
  if (isAdminRole(user)) return true;
  const p = user.permissions?.[moduleId];
  return Boolean(p?.view || p?.upload || p?.edit);
}

export function canUploadModule(user: User | null, moduleId: string): boolean {
  if (!user) return false;
  if (isAdminRole(user)) return true;
  return Boolean(user.permissions?.[moduleId]?.upload);
}

export function canEdit(user: User | null, moduleId: string): boolean {
  if (!user) return false;
  if (isAdminRole(user)) return true;
  return Boolean(user.permissions?.[moduleId]?.edit);
}

export function canAccessPath(user: User | null, path: string): boolean {
  if (!user) return false;
  if (isAdminRole(user)) return true;
  if (path === '/' || path === '/hierarchy' || path === '/login') return true;
  if (path === '/upload') {
    return Object.values(user.permissions || {}).some((p) => p.upload);
  }
  if (path === '/admin') return isAdminRole(user);
  const mod = MODULE_ROUTE[path];
  if (!mod) return true;
  return canView(user, mod);
}

/** @deprecated use canView / canUploadModule */
export function hasMod(user: User | null, mod: keyof User): boolean {
  if (!user) return false;
  if (isAdminRole(user)) return true;
  return Boolean(user[mod]);
}

/** @deprecated */
export function canUpload(user: User | null, key: keyof User): boolean {
  if (!user) return false;
  if (isAdminRole(user)) return true;
  return Boolean(user[key]);
}

export const AUTH_MODULES = [
  { id: 'nsc', label: 'New Connection (NSC)', uploadKey: 'nsc' },
  { id: 'disco', label: 'Disconnection', uploadKey: 'disco' },
  { id: 'grievance', label: 'Grievances', uploadKey: 'grievance' },
  { id: 'tech_works', label: 'Tech Works', uploadKey: 'tech-works' },
  { id: 'spot_billing', label: 'Spot Billing', uploadKey: 'spot-billing' },
  { id: 'bulk', label: 'Bulk Consumers', uploadKey: 'bulk' },
  { id: 'consumers', label: 'Consumer Master', uploadKey: 'consumers' },
  { id: 'atc', label: 'AT&C / T&D Losses', uploadKey: 'atc' },
] as const;

export function emptyPermissions(): Permissions {
  const p: Permissions = {};
  for (const m of AUTH_MODULES) {
    p[m.id] = { view: false, upload: false, edit: false };
  }
  return p;
}
