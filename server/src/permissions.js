/** Auth modules (databases) and permission helpers */

const MODULES = [
  { id: 'nsc', label: 'New Connection (NSC)', uploadKey: 'nsc' },
  { id: 'disco', label: 'Disconnection', uploadKey: 'disco' },
  { id: 'grievance', label: 'Grievances', uploadKey: 'grievance' },
  { id: 'tech_works', label: 'Priority Works', uploadKey: 'tech-works' },
  { id: 'spot_billing', label: 'Spot Billing', uploadKey: 'spot-billing' },
  { id: 'bulk', label: 'Bulk Consumers', uploadKey: 'bulk' },
  { id: 'consumers', label: 'Consumer Master', uploadKey: 'consumers' },
  { id: 'atc', label: 'AT&C / T&D Losses', uploadKey: 'atc' },
  { id: 'field_notes', label: 'Field Desk', uploadKey: 'field-notes' },
  // Power Map has no bulk uploader; only view/edit are meaningful. `edit` grants
  // the map's editor unlock, which used to be a separate name + PIN.
  { id: 'powermap', label: 'Power Map', uploadKey: 'powermap' },
];

const ACTIONS = ['view', 'upload', 'edit'];

function emptyPerms() {
  const p = {};
  for (const m of MODULES) {
    p[m.id] = { view: false, upload: false, edit: false };
  }
  return p;
}

function fullPerms() {
  const p = {};
  for (const m of MODULES) {
    p[m.id] = { view: true, upload: true, edit: true };
  }
  return p;
}

function makePerms(spec) {
  const base = emptyPerms();
  for (const [mod, flags] of Object.entries(spec || {})) {
    if (!base[mod]) continue;
    base[mod] = {
      view: Boolean(flags.view),
      upload: Boolean(flags.upload),
      edit: Boolean(flags.edit),
    };
    // upload/edit imply view for convenience when building seeds
    if (base[mod].upload || base[mod].edit) base[mod].view = true;
  }
  return base;
}

/** Map legacy flat flags → permissions matrix */
function migrateLegacyPermissions(user) {
  if (user.permissions && typeof user.permissions === 'object') {
    return normalizePermissions(user.permissions);
  }
  return makePerms({
    nsc: { view: user.mod_nsc, upload: user.upload_nsc, edit: user.mod_nsc },
    disco: { view: user.mod_disco, upload: user.upload_disco, edit: user.mod_disco },
    grievance: { view: user.mod_grievance, upload: user.upload_grievance, edit: user.mod_grievance },
    tech_works: { view: user.mod_tech_works, upload: user.upload_tech_works, edit: user.mod_tech_works },
    spot_billing: { view: user.mod_spot_billing, upload: user.upload_spot_billing, edit: user.mod_spot_billing },
    bulk: { view: user.mod_bulk, upload: user.upload_bulk, edit: user.mod_bulk },
    consumers: {
      view: user.mod_nsc || user.upload_consumer_master || user.role === 'region',
      upload: user.upload_consumer_master,
      edit: user.upload_consumer_master,
    },
    atc: {
      view: true,
      upload: user.upload_consumer_master || user.role === 'admin',
      edit: user.role === 'admin',
    },
  });
}

function normalizePermissions(raw) {
  const base = emptyPerms();
  if (!raw || typeof raw !== 'object') return base;
  for (const m of MODULES) {
    const src = raw[m.id] || {};
    base[m.id] = {
      view: Boolean(src.view),
      upload: Boolean(src.upload),
      edit: Boolean(src.edit),
    };
  }
  return base;
}

function isAdmin(user) {
  return String(user?.role || '').toLowerCase() === 'admin';
}

function normalizeUser(user) {
  if (!user) return null;
  const permissions = isAdmin(user) ? fullPerms() : migrateLegacyPermissions(user);
  const { pin, mod_nsc, mod_disco, mod_grievance, mod_tech_works, mod_spot_billing, mod_bulk,
    upload_nsc, upload_disco, upload_grievance, upload_tech_works, upload_spot_billing,
    upload_consumer_master, upload_bulk, ...rest } = user;
  // keep pin only server-side when needed; publicUser strips it later
  return {
    ...rest,
    pin: user.pin,
    permissions,
    // legacy mirrors for older UI during transition
    mod_nsc: permissions.nsc.view,
    mod_disco: permissions.disco.view,
    mod_grievance: permissions.grievance.view,
    mod_tech_works: permissions.tech_works.view,
    mod_spot_billing: permissions.spot_billing.view,
    mod_bulk: permissions.bulk.view,
    upload_nsc: permissions.nsc.upload,
    upload_disco: permissions.disco.upload,
    upload_grievance: permissions.grievance.upload,
    upload_tech_works: permissions.tech_works.upload,
    upload_spot_billing: permissions.spot_billing.upload,
    upload_consumer_master: permissions.consumers.upload,
    upload_bulk: permissions.bulk.upload,
  };
}

function can(user, moduleId, action) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const perms = user.permissions || migrateLegacyPermissions(user);
  const m = perms[moduleId];
  if (!m) return false;
  if (action === 'view') return Boolean(m.view || m.upload || m.edit);
  if (action === 'upload') return Boolean(m.upload);
  if (action === 'edit') return Boolean(m.edit);
  return false;
}

function canView(user, moduleId) {
  return can(user, moduleId, 'view');
}

function canUpload(user, moduleId) {
  return can(user, moduleId, 'upload');
}

function canEdit(user, moduleId) {
  return can(user, moduleId, 'edit');
}

/** Map upload route param → module id */
function uploadRouteToModule(route) {
  const map = {
    nsc: 'nsc',
    disco: 'disco',
    grievance: 'grievance',
    'tech-works': 'tech_works',
    'spot-billing': 'spot_billing',
    consumers: 'consumers',
    bulk: 'bulk',
    atc: 'atc',
  };
  return map[route] || null;
}

module.exports = {
  MODULES,
  ACTIONS,
  emptyPerms,
  fullPerms,
  makePerms,
  migrateLegacyPermissions,
  normalizePermissions,
  normalizeUser,
  isAdmin,
  can,
  canView,
  canUpload,
  canEdit,
  uploadRouteToModule,
};
