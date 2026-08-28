import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const T_PUBLIC = {
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
};

const T_POWERMAP = {
  voltageLevels: 'voltage_levels',
  orgUnits: 'org_units',
  assets: 'assets',
  substations: 'substations',
  transformers: 'transformers',
  lines: 'lines',
  tapNodes: 'tap_nodes',
  tapLaterals: 'tap_laterals',
  vSubstations: 'v_substations',
  vLines: 'v_lines',
  vTapNodes: 'v_tap_nodes',
  vTapLaterals: 'v_tap_laterals',
  editors: 'editors',
  editSuggestions: 'edit_suggestions',
};

export let T = { ...T_PUBLIC };

export let supabase: SupabaseClient | null = null;
export let supabaseConfigured = false;

export type PowerMapLive = { ok: boolean; table?: string; reason?: string };

function applyClient(url: string, key: string, schema = 'public') {
  const usePm = schema === 'powermap';
  T = usePm ? { ...T_POWERMAP } : { ...T_PUBLIC };
  supabase = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: usePm ? 'powermap' : 'public' },
  }) as unknown as SupabaseClient;
  supabaseConfigured = true;
}

export async function ensurePowerMapClient(): Promise<{ configured: boolean; live?: PowerMapLive }> {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (envUrl && envKey) applyClient(envUrl, envKey, 'public');

  try {
    const res = await fetch('/api/powermap/config', {
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const cfg = (await res.json()) as {
        url?: string | null;
        anonKey?: string | null;
        schema?: string | null;
        configured?: boolean;
        live?: PowerMapLive;
      };
      if (cfg.url && cfg.anonKey) applyClient(cfg.url, cfg.anonKey, cfg.schema || 'public');
      return { configured: supabaseConfigured, live: cfg.live };
    }
  } catch {
    /* env / offline */
  }
  return { configured: supabaseConfigured };
}
