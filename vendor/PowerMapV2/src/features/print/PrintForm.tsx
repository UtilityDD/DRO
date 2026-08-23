import type { ReactNode } from 'react';
import { useNetworkStore } from '@/store/networkStore';
import { PRINT_PAPERS, paperSizeMm, type PrintPaperId } from '@/lib/printLayout';
import { SITING_DISTRICTS } from '@/lib/sitingSuggestions';

const QUICK_DISTRICTS = [...SITING_DISTRICTS];

const PAPER_OPTIONS: { id: PrintPaperId; label: string }[] = [
  { id: 'a4', label: PRINT_PAPERS.a4.label },
  { id: 'a3', label: PRINT_PAPERS.a3.label },
  { id: 'a2', label: PRINT_PAPERS.a2.label },
  { id: 'a1', label: PRINT_PAPERS.a1.label },
  { id: 'custom', label: 'Custom (mm)' },
];

export function PrintForm() {
  const settings = useNetworkStore((s) => s.printSettings);
  const setPrintSettings = useNetworkStore((s) => s.setPrintSettings);
  const setPrintPreviewOpen = useNetworkStore((s) => s.setPrintPreviewOpen);
  const availableDistricts = useNetworkStore((s) => s.availableDistricts);

  const districts =
    availableDistricts.length > 0
      ? [...availableDistricts].sort((a, b) => a.localeCompare(b))
      : QUICK_DISTRICTS;

  const size = paperSizeMm(settings);

  const toggleDistrict = (name: string) => {
    const has = settings.districts.includes(name);
    setPrintSettings({
      districts: has
        ? settings.districts.filter((d) => d !== name)
        : [...settings.districts, name],
    });
  };

  return (
    <div className="form-stack">
      <p className="muted">
        Office wall / desk maps — clean basemap, SS names, feeder lengths, and a capacity
        list beside the map. Choose paper size and districts, then open print preview.
      </p>

      <Field label="Title">
        <input
          value={settings.title}
          onChange={(e) => setPrintSettings({ title: e.target.value })}
        />
      </Field>
      <Field label="Subtitle (optional)">
        <input
          value={settings.subtitle}
          onChange={(e) => setPrintSettings({ subtitle: e.target.value })}
          placeholder="Auto-fills from selected districts if empty"
        />
      </Field>

      <Field label="Paper size">
        <select
          value={settings.paperId}
          onChange={(e) =>
            setPrintSettings({ paperId: e.target.value as PrintPaperId })
          }
        >
          {PAPER_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="chip-group" role="group" aria-label="Quick paper size">
        {PAPER_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`chip${settings.paperId === o.id ? ' on' : ''}`}
            aria-pressed={settings.paperId === o.id}
            onClick={() => setPrintSettings({ paperId: o.id })}
          >
            {o.id === 'custom' ? 'Custom' : o.id.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="muted">
        Sheet: <strong>{size.widthMm} × {size.heightMm} mm</strong>
        {settings.paperId === 'custom' ? ' (exact custom size)' : ` (${settings.orientation})`}
      </p>

      {settings.paperId !== 'custom' && (
        <Field label="Orientation">
          <select
            value={settings.orientation}
            onChange={(e) =>
              setPrintSettings({
                orientation: e.target.value as 'landscape' | 'portrait',
              })
            }
          >
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </Field>
      )}

      {settings.paperId === 'custom' && (
        <div className="field-row">
          <Field label="Width (mm)">
            <input
              type="number"
              min={100}
              max={1200}
              value={settings.customWidthMm}
              onChange={(e) =>
                setPrintSettings({
                  customWidthMm: Math.min(1200, Math.max(100, Number(e.target.value) || 100)),
                })
              }
            />
          </Field>
          <Field label="Height (mm)">
            <input
              type="number"
              min={100}
              max={1200}
              value={settings.customHeightMm}
              onChange={(e) =>
                setPrintSettings({
                  customHeightMm: Math.min(1200, Math.max(100, Number(e.target.value) || 100)),
                })
              }
            />
          </Field>
        </div>
      )}
      {settings.paperId === 'custom' && (
        <p className="muted">Enter final page width × height (100–1200 mm). Orientation is not applied.</p>
      )}

      <p className="section-label">Districts</p>
      <div className="btn-row">
        <button
          type="button"
          className="text-btn"
          onClick={() => setPrintSettings({ districts: [...QUICK_DISTRICTS] })}
        >
          Malda + Dinajpurs
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={() => setPrintSettings({ districts: [] })}
        >
          Clear (all)
        </button>
      </div>
      <div className="print-district-list">
        {districts.map((name) => (
          <label key={name} className="check-row">
            <input
              type="checkbox"
              checked={settings.districts.includes(name)}
              onChange={() => toggleDistrict(name)}
            />
            {name}
          </label>
        ))}
      </div>
      <p className="muted">
        {settings.districts.length === 0
          ? 'No district filter — uses all substations (still respects proposed toggle).'
          : `${settings.districts.length} district(s) selected.`}
      </p>

      <p className="section-label">Map content</p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.showDistrictBoundaries}
          onChange={(e) =>
            setPrintSettings({ showDistrictBoundaries: e.target.checked })
          }
        />
        District boundaries
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.showSsNames}
          onChange={(e) => setPrintSettings({ showSsNames: e.target.checked })}
        />
        Substation names on map
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.showFeederLength}
          onChange={(e) => setPrintSettings({ showFeederLength: e.target.checked })}
        />
        Feeder lengths on map
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.showProposed}
          onChange={(e) => setPrintSettings({ showProposed: e.target.checked })}
        />
        Include proposed assets
      </label>

      <button
        type="button"
        className="primary-btn"
        onClick={() => setPrintPreviewOpen(true)}
      >
        Open print preview
      </button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
