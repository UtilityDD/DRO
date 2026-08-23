import { useEffect, useState } from 'react';
import { App as PowerMapApp } from '@/App';
import { ensurePowerMapClient } from '../powermap/supabase';
import 'leaflet/dist/leaflet.css';
import '../powermap/powermap.css';

export function PowerMapPage() {
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState('Opening Power Map…');

  useEffect(() => {
    let cancelled = false;
    ensurePowerMapClient().then((r) => {
      if (cancelled) return;
      if (r.live?.ok) setHint(`Live network · ${r.live.table || 'pm_*'}`);
      else if (r.configured) setHint(`Supabase key set · not reading tables (${r.live?.reason || 'run 011 bridge SQL or expose schema powermap'})`);
      else setHint('Local copy — Power Map is not using the live table');
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="pm-page pm-booting">
        <p className="muted">{hint}</p>
      </div>
    );
  }

  return (
    <div className="pm-page">
      <p className="pm-live-hint muted">{hint}. Existing Power Map substations load first; DRO stations are added later without replacing them.</p>
      <div className="pm-root" data-backend={hint}>
        <PowerMapApp />
      </div>
    </div>
  );
}
