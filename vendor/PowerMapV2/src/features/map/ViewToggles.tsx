import { useNetworkStore } from '@/store/networkStore';
import type { VoltageFocus } from '@/lib/voltageFocus';

const VIEWS: { id: VoltageFocus; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Overview — full network' },
  { id: 'ehv', label: 'EHT', title: 'EHT — dim 33 kV' },
  { id: '33', label: '33', title: '33 kV — dim distant EHT; feeders to 33 stay bright' },
  { id: 'proposed', label: 'Proposed', title: 'Proposed only — dim existing network' },
];

export function ViewToggles() {
  const voltageFocus = useNetworkStore((s) => s.voltageFocus);
  const setVoltageFocus = useNetworkStore((s) => s.setVoltageFocus);

  return (
    <div className="view-toggles" role="group" aria-label="Map view">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          className={voltageFocus === v.id ? 'on' : ''}
          title={v.title}
          aria-pressed={voltageFocus === v.id}
          onClick={() => setVoltageFocus(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
