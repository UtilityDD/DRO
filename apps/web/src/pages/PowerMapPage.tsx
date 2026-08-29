import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { App as PowerMapApp } from '../../../../vendor/PowerMapV2/src/App';
import { useNetworkStore } from '@/store/networkStore';
import { api } from '../api';
import { ensurePowerMapClient } from '../powermap/supabase';
import { usePageHeading } from '../lib/pageHeading';
import 'leaflet/dist/leaflet.css';
import '../powermap/powermap.css';
import '../powermap/powermap-dro.css';

export function PowerMapPage() {
  const loaded = useNetworkStore((s) => s.loaded);
  const backend = useNetworkStore((s) => s.backend);
  const substations = useNetworkStore((s) => s.substations);
  const lines = useNetworkStore((s) => s.lines);
  const setSearchOpen = useNetworkStore((s) => s.setSearchOpen);
  const searchOpen = useNetworkStore((s) => s.searchOpen);
  // The map's own mount effect calls bootstrap(), and React runs child effects
  // before the parent's, so mounting it before the credentials land would load
  // the offline copy and never retry. Hold it back until they resolve.
  const [clientReady, setClientReady] = useState(false);

  usePageHeading('Power Map');

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

  return (
    <div className="pm-page">
      <div className="pm-desk-toolbar">
        <button
          type="button"
          className="pm-desk-search"
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search size={15} />
          Search network
          <kbd>⌘K</kbd>
        </button>
        {loaded && backend !== 'supabase' ? (
          <span
            className="pm-offline-badge"
            title="The map could not reach the database and is showing a cached copy saved earlier on this device. Edits made now stay in this browser only."
          >
            Offline copy · {substations.length} SS · {lines.length} lines — not live
          </span>
        ) : (
          <span className="muted">
            {loaded
              ? `Live · ${substations.length} SS · ${lines.length} lines`
              : 'Loading network…'}
          </span>
        )}
      </div>
      <div className="pm-root">
        {clientReady ? (
          <PowerMapApp />
        ) : (
          <p className="pm-boot muted">Connecting to the network…</p>
        )}
      </div>
    </div>
  );
}
