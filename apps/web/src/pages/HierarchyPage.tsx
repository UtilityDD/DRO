import { useEffect, useMemo, useState } from 'react';
import { api, type Office, type Substation } from '../api';

type DivBranch = Office & { cccs: Office[] };
type Kind = 'region' | 'division' | 'ccc' | 'ss';
type Tab = 'offices' | 'substations';
type Sel = { kind: Kind; code: string };

type TreeNode = {
  kind: Kind;
  code: string;
  name: string;
  color: string;
  parent?: string;
  metric?: string;
  value?: number;
  extra?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const W = 1120;
const DIV_COLOR: Record<string, string> = {
  '3412': '#1565c0',
  '3413': '#00897b',
  '3414': '#3949ab',
  '3415': '#0277bd',
};

function countOf(o: { consumer_count?: number } | null | undefined) {
  return Number(o?.consumer_count || 0);
}

function field(s: object | null | undefined, keys: string[]) {
  if (!s) return undefined;
  const rec = s as Record<string, unknown>;
  for (const k of keys) {
    if (rec[k] != null && rec[k] !== '') return rec[k];
  }
  return undefined;
}

function mvaOf(s: object | null | undefined) {
  return Number(field(s, ['capacity_mva', 'capacity_mva']) || 0);
}

function voltageOf(s: object | null | undefined) {
  return String(field(s, ['voltage_kv', 'voltage_kv']) || '33/11');
}

function fmtMva(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${s} MVA`;
}

function shortName(name: string) {
  return name.replace(/\s+CCC$/i, '').replace(/^Siliguri\s+/i, '').trim();
}

function layoutTree(
  region: Office | null,
  divisions: DivBranch[],
  tab: Tab,
  substations: Substation[]
) {
  const n = Math.max(divisions.length, 1);
  const colW = (W - 24) / n;
  const leavesByDiv = divisions.map((d) => {
    if (tab === 'offices') {
      return [...d.cccs]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          kind: 'ccc' as const,
          code: c.code,
          name: c.name,
          metric: c.code,
          value: countOf(c),
          extra: '',
        }));
    }
    return substations
      .filter((s) => s.division_code === d.code)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({
        kind: 'ss' as const,
        code: String(s.id),
        name: s.name,
        metric: fmtMva(mvaOf(s)),
        value: mvaOf(s),
        extra: [voltageOf(s), s.ccc_name || s.ccc_code].filter(Boolean).join(' · '),
      }));
  });
  const maxLeaves = Math.max(3, ...leavesByDiv.map((list) => list.length));
  const ssTab = tab === 'substations';
  const divY = ssTab ? 176 : 148;
  const leafStart = ssTab ? 256 : 214;
  const H = Math.max(640, leafStart + maxLeaves * 42 + 36);

  const regionValue =
    tab === 'offices'
      ? countOf(region) || divisions.reduce((s, d) => s + (countOf(d) || d.cccs.reduce((a, c) => a + countOf(c), 0)), 0)
      : substations.reduce((s, r) => s + mvaOf(r), 0);

  const regionNode: TreeNode = {
    kind: 'region',
    code: region?.code || '341',
    name: region?.name || 'Darjeeling Region',
    color: '#1565c0',
    metric: tab === 'offices' ? undefined : fmtMva(regionValue),
    value: regionValue,
    x: W / 2,
    y: ssTab ? 50 : 42,
    w: 280,
    h: ssTab ? 72 : 48,
  };

  const divNodes: TreeNode[] = divisions.map((d, i) => {
    const leaves = leavesByDiv[i];
    const value =
      tab === 'offices' ? countOf(d) || d.cccs.reduce((s, c) => s + countOf(c), 0) : leaves.reduce((s, l) => s + (l.value || 0), 0);
    return {
      kind: 'division' as const,
      code: d.code,
      name: d.name,
      color: DIV_COLOR[d.code] || '#1a73e8',
      parent: regionNode.code,
      metric: tab === 'offices' ? undefined : fmtMva(value),
      value,
      x: 12 + colW * (i + 0.5),
      y: divY,
      w: Math.min(210, colW - 18),
      h: ssTab ? 64 : 44,
    };
  });

  const leafNodes: TreeNode[] = divisions.flatMap((d, i) => {
    const parent = divNodes[i];
    return leavesByDiv[i].map((leaf, j) => ({
      ...leaf,
      color: parent.color,
      parent: d.code,
      x: parent.x,
      y: leafStart + j * 42,
      w: parent.w,
      h: 34,
    }));
  });

  const railY = (regionNode.y + regionNode.h / 2 + divY - (ssTab ? 30 : 22)) / 2 + 8;
  const divXs = divNodes.map((d) => d.x);
  const rail = {
    y: railY,
    x1: Math.min(...divXs, regionNode.x),
    x2: Math.max(...divXs, regionNode.x),
  };

  return { H, regionNode, divNodes, leafNodes, rail };
}

export function HierarchyPage() {
  const [region, setRegion] = useState<Office | null>(null);
  const [divisions, setDivisions] = useState<DivBranch[]>([]);
  const [substations, setSubstations] = useState<Substation[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [tab, setTab] = useState<Tab>('offices');

  useEffect(() => {
    api.hierarchy().then((r) => {
      setRegion(r.region);
      setDivisions(r.divisions || []);
      setSel(r.region?.code ? { kind: 'region', code: r.region.code } : null);
    });
    api.substations().then((r) => setSubstations(r.rows || [])).catch(() => setSubstations([]));
  }, []);

  useEffect(() => {
    setSel({ kind: 'region', code: region?.code || '341' });
  }, [tab, region?.code]);

  const tree = useMemo(
    () => layoutTree(region, divisions, tab, substations),
    [region, divisions, tab, substations]
  );

  const allNodes = [tree.regionNode, ...tree.divNodes, ...tree.leafNodes];
  const selected = allNodes.find((n) => n.kind === sel?.kind && n.code === sel.code) || tree.regionNode;
  const selectedSs = selected.kind === 'ss' ? substations.find((s) => String(s.id) === selected.code) : null;

  const kids =
    selected.kind === 'region'
      ? tree.divNodes
      : selected.kind === 'division'
        ? tree.leafNodes.filter((n) => n.parent === selected.code)
        : [];

  const focusDiv =
    sel?.kind === 'division' ? sel.code : sel?.kind === 'ccc' || sel?.kind === 'ss' ? selected.parent : null;

  const dimmed = (n: TreeNode) => {
    if (!focusDiv) return false;
    if (n.kind === 'region') return false;
    if (n.kind === 'division') return n.code !== focusDiv;
    return n.parent !== focusDiv;
  };

  const kicker =
    selected.kind === 'ss'
      ? `${voltageOf(selectedSs)} kV substation`
      : selected.kind === 'ccc'
        ? 'CCC'
        : selected.kind === 'division'
          ? 'Division'
          : 'Region';

  return (
    <div className="hier-page">
      <div className="panel hier-head">
        <div>
          <h2>{region?.name || 'Darjeeling Region'}</h2>
          <div className="hier-tabs" role="tablist" aria-label="Hierarchy views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'offices'}
              className={`hier-tab${tab === 'offices' ? ' on' : ''}`}
              onClick={() => setTab('offices')}
            >
              Offices
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'substations'}
              className={`hier-tab${tab === 'substations' ? ' on' : ''}`}
              onClick={() => setTab('substations')}
            >
              Substations
            </button>
          </div>
        </div>
      </div>

      <div className="hier-work">
          <div className="panel hier-canvas-wrap">
            <svg
              viewBox={`0 0 ${W} ${tree.H}`}
              className="hier-svg tree-svg"
              role="img"
              aria-label={tab === 'substations' ? 'Substation hierarchy with capacities' : 'Office hierarchy tree'}
            >
              <rect
                x="0"
                y="0"
                width={W}
                height={tree.H}
                className="hier-paper"
                onClick={() => setSel({ kind: 'region', code: region?.code || '341' })}
              />
              <g className="tree-links" fill="none">
                <path
                  d={`M ${tree.regionNode.x} ${tree.regionNode.y + tree.regionNode.h / 2} V ${tree.rail.y}`}
                />
                <path
                  className={focusDiv ? 'dim' : undefined}
                  d={`M ${tree.rail.x1} ${tree.rail.y} H ${tree.rail.x2}`}
                />
                {focusDiv && (
                  <path
                    d={`M ${tree.regionNode.x} ${tree.rail.y} H ${tree.divNodes.find((d) => d.code === focusDiv)?.x ?? tree.regionNode.x}`}
                  />
                )}
                {tree.divNodes.map((d) => (
                  <path
                    key={`link-div-${d.code}`}
                    className={dimmed(d) ? 'dim' : undefined}
                    d={`M ${d.x} ${tree.rail.y} V ${d.y - d.h / 2}`}
                  />
                ))}
                {tree.divNodes.map((d) => {
                  const children = tree.leafNodes.filter((c) => c.parent === d.code);
                  if (!children.length) return null;
                  const last = children[children.length - 1];
                  const spineX = d.x - d.w / 2 + 10;
                  return (
                    <g key={`spine-${d.code}`} className={dimmed(d) ? 'dim' : undefined}>
                      <path d={`M ${d.x} ${d.y + d.h / 2} V ${children[0].y} H ${spineX} V ${last.y}`} />
                      {children.map((c) => (
                        <path key={`leaf-link-${c.code}`} d={`M ${spineX} ${c.y} H ${c.x - c.w / 2}`} />
                      ))}
                    </g>
                  );
                })}
              </g>
              {allNodes.map((n) => {
                const on = sel?.kind === n.kind && sel.code === n.code;
                const leaf = n.kind === 'ccc' || n.kind === 'ss';
                const parentBox = n.kind === 'region' || n.kind === 'division';
                const stacked = Boolean(n.metric);
                const fade = dimmed(n);
                return (
                  <g
                    key={`${n.kind}-${n.code}`}
                    className={`tree-node tree-${n.kind}${on ? ' on' : ''}${fade ? ' is-dim' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSel({ kind: n.kind, code: n.code });
                    }}
                  >
                    <rect
                      x={n.x - n.w / 2}
                      y={n.y - n.h / 2}
                      width={n.w}
                      height={n.h}
                      rx={leaf ? 8 : 10}
                      fill={leaf ? (fade ? '#eef2f6' : '#fff') : fade ? '#9aadc2' : n.color}
                      stroke={on ? n.color : leaf ? (fade ? '#c5d0de' : 'rgba(30,64,120,0.16)') : fade ? '#9aadc2' : n.color}
                      strokeWidth={on ? 2.4 : 1.2}
                    />
                    <text
                      x={n.x}
                      y={parentBox && stacked ? n.y - 14 : leaf ? n.y - 5 : n.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={fade ? '#94a3b8' : leaf ? '#1e293b' : '#fff'}
                      className="tree-label"
                    >
                      {shortName(n.name)}
                    </text>
                    {stacked && (leaf || parentBox) && (
                      <text
                        x={n.x}
                        y={parentBox ? n.y + 16 : n.y + 9}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className={leaf ? 'tree-code' : 'tree-metric'}
                        fill={fade ? '#94a3b8' : leaf ? undefined : 'rgba(255,255,255,0.88)'}
                      >
                        {n.metric}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <aside className="panel hier-inspect">
            <p className="hier-kicker">{kicker}</p>
            <h3>
              {selected.name} <span className="code-pill">{selectedSs?.ccc_code || selected.code}</span>
            </h3>
            <p className="hier-stat">
              {tab === 'substations'
                ? fmtMva(selected.value || 0)
                : (selected.value || 0).toLocaleString()}
              <span>{tab === 'substations' ? 'capacity' : 'consumers'}</span>
            </p>
            {selectedSs && (
              <p className="muted tight">
                {[selectedSs.ccc_name || selectedSs.ccc_code, selectedSs.division_name, selectedSs.status]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {kids.length > 0 && (
              <div className="hier-kids">
                {kids.map((c) => (
                  <button
                    type="button"
                    key={`${c.kind}-${c.code}`}
                    className="hier-kid"
                    onClick={() => setSel({ kind: c.kind, code: c.code })}
                  >
                    <i style={{ width: 8, height: 8, background: c.color }} />
                    <span>{c.name}</span>
                    <b>
                      {tab === 'substations'
                        ? c.metric || fmtMva(c.value || 0)
                        : (c.value || 0).toLocaleString()}
                    </b>
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>
    </div>
  );
}
