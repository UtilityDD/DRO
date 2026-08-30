import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

/**
 * PowerMap lives in schema `powermap`, reached via public `pm_*` views
 * (see supabase/migrations/006_live_api_bridge.sql) so the anon key works
 * without waiting on Dashboard → Exposed schemas.
 */
export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true },
    })
  : null;

/** Table / view names on the public bridge */
export const T = {
  voltageLevels: 'pm_voltage_levels',
  orgUnits: 'pm_org_units',
  assets: 'pm_assets',
  substations: 'pm_substations',
  transformers: 'pm_transformers',
  lines: 'pm_lines',
  tapNodes: 'pm_tap_nodes',
  tapLaterals: 'pm_tap_laterals',
  vSubstations: 'pm_v_substations',
  vLines: 'pm_v_lines',
  vTapNodes: 'pm_v_tap_nodes',
  vTapLaterals: 'pm_v_tap_laterals',
  editors: 'pm_editors',
  editSuggestions: 'pm_edit_suggestions',
  networkStamp: 'pm_network_stamp',
} as const;

export function getPowerMapClient() {
  return supabase;
}
export function isPowerMapConfigured() {
  return supabaseConfigured;
}
export function getPowerMapTables() {
  return T;
}
