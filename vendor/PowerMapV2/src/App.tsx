import { useEffect } from 'react';
import { MapView } from '@/features/map/MapView';
import { PrintSheet } from '@/features/print/PrintSheet';
import { ConfirmDialog } from '@/features/shell/ConfirmDialog';
import { SearchPalette } from '@/features/shell/SearchPalette';
import { SidePanel } from '@/features/shell/SidePanel';
import { StatusBar } from '@/features/shell/StatusBar';
import { ToolRail } from '@/features/shell/ToolRail';
import { useNetworkStore } from '@/store/networkStore';

function ScopeBadge() {
  const sceneId = useNetworkStore((s) => s.sceneId);
  const filters = useNetworkStore((s) => s.filters);
  const focusedDistricts = useNetworkStore((s) => s.mapLayers.focusedDistricts);
  const dimAll = useNetworkStore((s) => s.mapLayers.dimAllDistricts);
  const scopeBadgeLabel = useNetworkStore((s) => s.scopeBadgeLabel);
  // Recompute when scope inputs change (getter itself is stable).
  void sceneId;
  void filters;
  void focusedDistricts;
  void dimAll;
  const label = scopeBadgeLabel();
  return (
    <div className="scope-badge" title="Current map / report / print scope">
      <span className="scope-badge-kicker">Reporting on</span>
      <span className="scope-badge-text">{label}</span>
    </div>
  );
}

export function App() {
  const bootstrap = useNetworkStore((s) => s.bootstrap);
  const loaded = useNetworkStore((s) => s.loaded);
  const printPreviewOpen = useNetworkStore((s) => s.printPreviewOpen);
  const printSettings = useNetworkStore((s) => s.printSettings);
  const setPrintPreviewOpen = useNetworkStore((s) => s.setPrintPreviewOpen);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="pm-shell">
      <div className="workspace">
        <ToolRail />
        <div className="map-stage">
          {!loaded && (
            <div className="boot-overlay">
              <div className="boot-card">
                <div className="boot-spinner" />
                <p>Loading network…</p>
              </div>
            </div>
          )}
          <MapView />
          <ScopeBadge />
          <div className="map-legend">
            <div className="legend-title">Symbology</div>
            <div className="legend-row"><span className="sym square" /> 400 kV</div>
            <div className="legend-row"><span className="sym diamond" /> 220 kV</div>
            <div className="legend-row"><span className="sym hex" /> 132 kV</div>
            <div className="legend-row"><span className="sym circle" /> 33 kV</div>
            <div className="legend-note">Filled = existing · Outline = proposed</div>
          </div>
          <SidePanel />
        </div>
      </div>
      <StatusBar />
      <SearchPalette />
      <ConfirmDialog />
      {printPreviewOpen && (
        <PrintSheet
          settings={printSettings}
          onClose={() => setPrintPreviewOpen(false)}
        />
      )}
    </div>
  );
}
