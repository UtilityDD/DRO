import { useEffect } from 'react';
import { Search } from 'lucide-react';
import { App as PowerMapApp } from '../../../../vendor/PowerMapV2/src/App';
import { useNetworkStore } from '@/store/networkStore';
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
    void ensurePowerMapClient();
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
