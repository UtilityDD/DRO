import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { App as PowerMapApp } from '../../../../vendor/PowerMapV2/src/App';
import { ViewToggles } from '../../../../vendor/PowerMapV2/src/features/map/ViewToggles';
import { useNetworkStore } from '@/store/networkStore';
import { adoptFreshBuildOnce, droBuildLabel } from '../lib/appBuild';
import { activateWaitingWorkerAndReload, checkForAppUpdate } from '../lib/pwaRegister';
import { api } from '../api';
import { ensurePowerMapClient } from '../powermap/supabase';
import { usePageHeading } from '../lib/pageHeading';
import 'leaflet/dist/leaflet.css';
import '../powermap/powermap.css';
import '../powermap/powermap-dro.css';

function searchHotkeyLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl+K';
  const platform = navigator.platform || '';
  const ua = navigator.userAgent || '';
  const mac = /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(ua);
  return mac ? '⌘K' : 'Ctrl+K';
}

export function PowerMapPage() {
  const loaded = useNetworkStore((s) => s.loaded);
  const backend = useNetworkStore((s) => s.backend);
  const substations = useNetworkStore((s) => s.substations);
  const lines = useNetworkStore((s) => s.lines);
  const networkVersion = useNetworkStore((s) => s.networkVersion);
  const networkCacheHit = useNetworkStore((s) => s.networkCacheHit);
  const reloadFromSupabase = useNetworkStore((s) => s.reloadFromSupabase);
  const setSearchOpen = useNetworkStore((s) => s.setSearchOpen);
  const searchOpen = useNetworkStore((s) => s.searchOpen);
  // The map's own mount effect calls bootstrap(), and React runs child effects
  // before the parent's, so mounting it before the credentials land would load
  // the offline copy and never retry. Hold it back until they resolve.
  const [clientReady, setClientReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [shellAppearance, setShellAppearance] = useState<'light' | 'dark'>(() => {
    try {
      const from =
        document.querySelector('.app-shell')?.getAttribute('data-appearance') ||
        document.documentElement.getAttribute('data-appearance');
      if (from === 'dark' || from === 'light') return from;
      return window.localStorage.getItem('dro.appearance') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const hotkey = useMemo(() => searchHotkeyLabel(), []);

  usePageHeading('Power Map');

  // Pick up new deploys: SW update + one reload if shell build id changed.
  useEffect(() => {
    if (adoptFreshBuildOnce()) return;
    checkForAppUpdate();
    void activateWaitingWorkerAndReload();
    const onVis = () => {
      if (document.visibilityState === 'visible') checkForAppUpdate();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Keep map canvas theme in sync with the shell (scoped powermap.css hardcodes light bg).
  useEffect(() => {
    const sync = () => {
      const from =
        document.querySelector('.app-shell')?.getAttribute('data-appearance') ||
        document.documentElement.getAttribute('data-appearance');
      if (from === 'dark' || from === 'light') setShellAppearance(from);
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-appearance'],
    });
    const shell = document.querySelector('.app-shell');
    if (shell) {
      obs.observe(shell, { attributes: true, attributeFilter: ['data-appearance'] });
    }
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const store = useNetworkStore.getState();
    // Claim the session synchronously so the standalone PIN prompt can never be
    // reached in the window before the portal identity resolves.
    void store.applyPortalIdentity(null);
    void (async () => {
      // Supabase first: a super admin's identity triggers editor/suggestion loads.
      try {
        await ensurePowerMapClient();
      } finally {
        // Mount either way; without credentials the map runs offline, but it must
        // not be held back forever by a failed or slow config fetch.
        if (!cancelled) setClientReady(true);
      }
      try {
        const me = await api.powerMapIdentity();
        if (cancelled) return;
        await store.applyPortalIdentity({
          username: me.username,
          name: me.name,
          role: me.role,
          allowedSubstationIds: me.allowedSubstationIds ?? [],
          allowedDistricts: me.allowedDistricts ?? [],
          unrestricted: me.unrestricted !== false,
        });
        if (me.role === 'super') {
          const { users } = await api.users();
          if (cancelled) return;
          store.setPortalUsers(
            users.map((u) => ({ username: u.username, name: u.name || u.username })),
          );
        }
      } catch {
        // Session expired or endpoint unavailable — fall back to view only.
        if (!cancelled) await store.applyPortalIdentity(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void reloadFromSupabase().finally(() => setRefreshing(false));
  };

  const versionLabel = networkVersion
    ? networkVersion.startsWith('r:')
      ? networkVersion.split('|')[0]
      : networkVersion.startsWith('c:')
        ? 'c…'
        : networkVersion.length > 24
          ? `${networkVersion.slice(0, 22)}…`
          : networkVersion
    : 'no-stamp';

  const showLoadOverlay = !clientReady || !loaded;

  return (
    <div className="pm-page">
      <div className="pm-desk-toolbar">
        <div className="pm-desk-toolbar-start">
          {clientReady ? <ViewToggles variant="panel" /> : null}
          <button
            type="button"
            className="pm-desk-search"
            onClick={() => setSearchOpen(!searchOpen)}
            disabled={!loaded}
          >
            <Search size={15} />
            Search network
            <kbd>{hotkey}</kbd>
          </button>
        </div>
        {loaded && backend !== 'supabase' ? (
          <span
            className="pm-offline-badge"
            title="The map could not reach the database and is showing a cached copy saved earlier on this device. Edits made now stay in this browser only."
          >
            Offline copy · {substations.length} SS · {lines.length} lines — not live
          </span>
        ) : loaded ? (
          <button
            type="button"
            className="pm-desk-version muted"
            onClick={onRefresh}
            disabled={refreshing}
            title={
              networkCacheHit
                ? `Dump stamp unchanged (${networkVersion || '—'}) — reused device copy. App ${droBuildLabel()}. Click to force a fresh download.`
                : `Fresh pull from Supabase (${networkVersion || 'stamp missing'}). App ${droBuildLabel()}. Click to refresh again.`
            }
          >
            {`${networkCacheHit ? 'Cached' : 'Live'} · ${versionLabel} · app ${droBuildLabel()} · ${substations.length} SS · ${lines.length} lines`}
            {refreshing ? ' · refreshing…' : ''}
          </button>
        ) : (
          <span className="pm-desk-version muted" aria-hidden>
            —
          </span>
        )}
      </div>
      <div className="pm-root" data-appearance={shellAppearance}>
        {showLoadOverlay && (
          <div className="pm-load-overlay" role="status" aria-live="polite">
            <div className="pm-load-card">
              <div className="pm-load-spinner" />
              <p>{clientReady ? 'Loading network…' : 'Connecting…'}</p>
            </div>
          </div>
        )}
        {clientReady ? <PowerMapApp /> : null}
      </div>
    </div>
  );
}
