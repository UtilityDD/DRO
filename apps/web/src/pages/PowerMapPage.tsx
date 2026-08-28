import { useEffect } from 'react';
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

  usePageHeading('Power Map');

  useEffect(() => {
    let cancelled = false;
    const store = useNetworkStore.getState();
    // Claim the session synchronously so the standalone PIN prompt can never be
    // reached in the window before the portal identity resolves.
    void store.applyPortalIdentity(null);
    void (async () => {
      // Supabase first: a super admin's identity triggers editor/suggestion loads.
      await ensurePowerMapClient();
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
        <span className="muted">
          {loaded
            ? `${backend === 'supabase' ? 'Live' : 'Local'} · ${substations.length} SS · ${lines.length} lines`
            : 'Loading network…'}
        </span>
      </div>
      <div className="pm-root">
        <PowerMapApp />
      </div>
    </div>
  );
}
