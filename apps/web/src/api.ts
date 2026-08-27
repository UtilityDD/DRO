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
    cache: 'no-store',
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
  substations: () =>
    request<{
      rows: Substation[];
      total: number;
      by_division: { division_code: string; division_name: string; count: number; capacity_mva: number }[];
      can_edit: boolean;
    }>('/api/substations'),
  createSubstation: (body: Partial<Substation>) =>
    request<{ row: Substation }>('/api/substations', { method: 'POST', body: JSON.stringify(body) }),
  patchSubstation: (id: number | string, body: Partial<Substation>) =>
    request<{ row: Substation }>(`/api/substations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSubstation: (id: number | string) =>
    request<{ ok: boolean }>(`/api/substations/${id}`, { method: 'DELETE' }),
  offices: (type?: string) =>
    request<{ offices: Office[] }>(`/api/offices${type ? `?type=${type}` : ''}`),
  nsc: (q = '') =>
    request<{
      rows: Record<string, unknown>[];
      total: number;
      limit?: number;
      offset?: number;
      report_date?: string | null;
      can_edit?: boolean;
      can_upload?: boolean;
    }>(`/api/nsc${q}`),
  nscDesk: (q = '') =>
    request<{
      report_date: string | null;
      pending: number;
      withheld: number;
      view: number;
      avg_days: number;
      gt_year: number;
      stuck_30?: number;
      stuck_180?: number;
      divisions: { code: string; name: string }[];
      cccs: { code: string; name: string }[];
      classes: string[];
      years: string[];
      by_division: Record<string, string | number>[];
      by_ccc: {
        code?: string;
        name: string;
        count: number;
        hot?: number;
        critical?: number;
        avg_days?: number;
        hot_pct?: number;
        non_pole?: number;
        pole?: number;
        hot_non_pole?: number;
        hot_pole?: number;
        poles_sum?: number;
        proc_a?: number;
        proc_b?: number;
        hot_proc_b?: number;
      }[];
      mix_total?: number;
      pole?: {
        non_pole: number;
        pole: number;
        unknown?: number;
        poles_sum?: number;
        hot_non_pole?: number;
        hot_pole?: number;
        avg_poles?: number;
      };
      by_pole_bin?: { id: string; name: string; min?: number; max?: number | null; count: number }[];
      procedure?: {
        proc_a: number;
        proc_b: number;
        unknown?: number;
        hot_proc_a?: number;
        hot_proc_b?: number;
      };
      by_cumulative?: { id: string; name: string; op?: string; days?: number; count: number }[];
      by_slab: { id: string; name: string; count: number }[];
      by_class?: { name: string; count: number }[];
      timeline: Record<string, string | number>[];
      timeline_divisions: string[];
      reasons: { name: string; count: number }[];
    }>(`/api/nsc/desk${q}`),
  nscQueue: (queue: 'pending' | 'withheld' = 'pending') =>
    request<{
      queue: 'pending' | 'withheld';
      report_date: string | null;
      count: number;
      rows: import('./lib/nscDesk').NscChartRow[];
      divisions: { code: string; name: string }[];
      cccs: { code: string; name: string; division_code?: string }[];
    }>(`/api/nsc/queue?queue=${queue}`),
  nscExport: async (q = '') => {
    const res = await fetch(`/api/nsc/export${q}`, { credentials: 'include' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw newError((data as { error?: string }).error || res.statusText, res.status);
    }
    if (type.includes('application/json')) {
      const data = (await res.json()) as { url?: string; filename?: string };
      if (!data.url) throw newError('No download URL', 500);
      const a = document.createElement('a');
      a.href = data.url;
      a.download = data.filename || 'nsc.csv';
      a.click();
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = match?.[1] || 'nsc.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  },
  nscSummary: () =>
    request<{
      byStatus: Record<string, number>;
      byDivision: DivSum[];
      total: number;
      pending?: number;
      withheld?: number;
      report_date?: string | null;
    }>('/api/nsc/summary'),
  nscStatus: () =>
    request<{
      report_date: string | null;
      updated_at: string | null;
      pending: number;
      withheld: number;
      total: number;
    }>('/api/nsc/status'),
  nscParse: async (file: File, reportDate: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('report_date', reportDate);
    const res = await fetch('/api/nsc/parse', { method: 'POST', credentials: 'include', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw newError(data.error || res.statusText, res.status);
    return data as {
      ok: boolean;
      parse_id: string;
      preview: {
        filename: string;
        report_date: string;
        remapped: boolean;
        source_offices: number;
        skipped: number;
        total: number;
        ccc_count: number;
        by_status: Record<string, number>;
        by_queue: Record<string, number>;
        by_division: { key: string; count: number }[];
        by_class: { key: string; count: number }[];
        by_phase?: { key: string; count: number }[];
        three_phase?: number;
        by_quotation_slab: { key: string; count: number }[];
        by_processing_slab: { key: string; count: number }[];
      };
    };
  },
  nscCommit: (parseId: string) =>
    request<{
      ok: boolean;
      upserted: number;
      report_date?: string;
      cloud?: { persisted?: boolean; host?: string; error?: string };
      batch?: Record<string, unknown>;
    }>('/api/nsc/commit', { method: 'POST', body: JSON.stringify({ parse_id: parseId }) }),
  nscUploadUrl: (filename: string, reportDate: string) =>
    request<{ ok: boolean; job_id: string; url: string; token?: string; path: string }>('/api/nsc/upload-url', {
      method: 'POST',
      body: JSON.stringify({ filename, report_date: reportDate }),
    }),
  nscImportParse: (jobId: string) =>
    request<{
      ok: boolean;
      parse_id: string;
      preview: Record<string, unknown>;
      job: { id: string; total: number; part_count: number; status: string };
    }>('/api/nsc/import/parse', { method: 'POST', body: JSON.stringify({ job_id: jobId }) }),
  nscImportTick: (jobId: string) =>
    request<{
      ok: boolean;
      job: { status: string; upserted: number; total: number; part_index: number; part_count: number; error?: string };
    }>('/api/nsc/import/tick', { method: 'POST', body: JSON.stringify({ job_id: jobId }) }),
  disco: (q = '') =>
    request<{ rows: Record<string, unknown>[]; total: number; can_edit?: boolean }>(`/api/disco${q}`),
  discoSummary: () =>
    request<{ byDivision: DivSum[]; total: number; totalDue: number; pending: number }>('/api/disco/summary'),
  grievances: (q = '') =>
    request<{ rows: Record<string, unknown>[]; total: number; can_edit?: boolean; can_upload?: boolean }>(
      `/api/grievances${q}`
    ),
  createGrievance: (body: Record<string, unknown>) =>
    request<{ row: Record<string, unknown> }>('/api/grievances', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  techWorks: (q = '') =>
    request<{
      rows: TechWork[];
      total: number;
      categories: TechWorkCategory[];
      staff: TechWorkStaff[];
      author_users?: string[];
      can_edit?: boolean;
      can_create?: boolean;
      can_assign?: boolean;
      can_upload?: boolean;
      can_manage_categories?: boolean;
    }>(`/api/tech-works${q}`),
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
  patchGrievance: (id: string, body: Record<string, unknown>) =>
    request<{ row: Record<string, unknown> }>(`/api/grievances/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  patchTech: (workId: string, body: Record<string, unknown>) =>
    request<{ row: TechWork }>(`/api/tech-works/${encodeURIComponent(workId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  createTechWork: (body: Record<string, unknown>) =>
    request<{ row: TechWork }>('/api/tech-works', { method: 'POST', body: JSON.stringify(body) }),
  createTechCategory: (body: Record<string, unknown>) =>
    request<{ row: TechWorkCategory }>('/api/tech-works/categories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchTechCategory: (id: number | string, body: Record<string, unknown>) =>
    request<{ row: TechWorkCategory }>(`/api/tech-works/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  patchTechSettings: (body: { author_users: string[] }) =>
    request<{ author_users: string[] }>('/api/tech-works/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  fieldNotes: () =>
    request<{
      rows: FieldNote[];
      total: number;
      counts: FieldNoteCounts;
      can_edit?: boolean;
      staff: FieldStaff[];
    }>('/api/field-notes'),
  fieldNoteSites: () =>
    request<{
      sites: FieldSite[];
      counts: FieldNoteCounts;
      can_edit?: boolean;
      staff: FieldStaff[];
    }>('/api/field-notes/sites'),
  createFieldNote: (body: Record<string, unknown>) =>
    request<{ row: FieldNote }>('/api/field-notes', { method: 'POST', body: JSON.stringify(body) }),
  patchFieldNote: (id: number | string, body: Record<string, unknown>) =>
    request<{ row: FieldNote }>(`/api/field-notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  visitFieldNote: (body: Record<string, unknown>) =>
    request<{ row: FieldNote; stamped?: number }>('/api/field-notes/visit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export type TechWorkPo = { po_no: string; po_date: string; agency_name: string };
export type TechWorkFollowup = { at: string; by: string; remark: string };
export type TechWorkCategory = {
  id: number;
  name: string;
  parameter_unit: string;
  sort_order: number;
  active: boolean;
};
export type TechWorkStaff = { username: string; name: string; role: string };
export type TechWork = {
  id: number;
  work_id: string;
  category_id: number | null;
  category_name: string;
  description: string;
  title: string;
  division_code: string;
  division_name?: string;
  related_ss_name: string;
  existing_parameter: number | null;
  proposed_parameter: number | null;
  parameter_unit: string;
  proposal_enote_no: string;
  proposal_enote_date: string;
  taa_no: string;
  taa_date: string;
  scheme_value: number | null;
  billing_progress: number | null;
  major_material: string;
  pos: TechWorkPo[];
  work_start_date: string;
  material_issue_status: string;
  work_progress: number;
  status: string;
  remarks: string;
  followups: TechWorkFollowup[];
  followup_users: string[];
  can_update?: boolean;
  can_plan?: boolean;
  can_assign?: boolean;
};

export type FieldStaff = { username: string; name: string; role: string };

export type FieldUpdate = { at: string; by: string; kind: string; text: string };

export type FieldNote = {
  id: number;
  site_type: 'office' | 'ss' | string;
  site_code: string;
  site_name: string;
  office_code?: string;
  office_type?: string;
  office_name?: string;
  division_code?: string;
  ccc_code?: string;
  kind: 'work' | 'assignment' | 'note' | string;
  title: string;
  body: string;
  priority: 'high' | 'normal' | 'low' | string;
  status: 'open' | 'waiting' | 'done' | string;
  assigned_to: string[];
  accompanied?: string[];
  followup_at: string | null;
  last_visited_at: string | null;
  updates: FieldUpdate[];
  created_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type FieldNoteCounts = {
  open: number;
  overdue: number;
  today: number;
  waiting: number;
  done: number;
  total: number;
};

export type FieldSite = {
  site_type: 'office' | 'ss' | string;
  site_code: string;
  site_name: string;
  office_type?: string;
  office_name?: string;
  division_code?: string;
  ccc_code?: string;
  open_count: number;
  overdue_count: number;
  item_count: number;
  next_followup_at: string | null;
  last_visited_at: string | null;
  standing_id: number | null;
  standing_body: string;
};

export type Substation = {
  id: number;
  name: string;
  voltage_kv: string;
  capacity_mva: number | null;
  division_code: string;
  division_name?: string;
  ccc_code?: string;
  ccc_name?: string;
  district?: string;
  latitude?: number | null;
  longitude?: number | null;
  feeder_count?: number | null;
  status?: string;
  commissioned_on?: string;
  remarks?: string;
  source?: string;
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
  '/field': 'field_notes',
  '/upload': '__upload__',
};

export function isAdminRole(user: User | null): boolean {
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
  if (path === '/' || path === '/hierarchy' || path === '/powermap' || path === '/login') return true;
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
  { id: 'tech_works', label: 'Priority Works', uploadKey: 'tech-works' },
  { id: 'spot_billing', label: 'Spot Billing', uploadKey: 'spot-billing' },
  { id: 'bulk', label: 'Bulk Consumers', uploadKey: 'bulk' },
  { id: 'consumers', label: 'Consumer Master', uploadKey: 'consumers' },
  { id: 'atc', label: 'AT&C / T&D Losses', uploadKey: 'atc' },
  { id: 'field_notes', label: 'Field Desk', uploadKey: 'field-notes' },
] as const;

export function emptyPermissions(): Permissions {
  const p: Permissions = {};
  for (const m of AUTH_MODULES) {
    p[m.id] = { view: false, upload: false, edit: false };
  }
  return p;
}
