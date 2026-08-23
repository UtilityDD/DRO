import { useEffect, useMemo, useState } from 'react';
import { api, type Office } from '../api';

type DivBranch = Office & { cccs: Office[] };
type Kind = 'region' | 'division' | 'ccc';
type Sel = { kind: Kind; code: string };

type InLine = {
  text: string;
  y: number;
  size: number;
  className: 'hier-dot-name' | 'hier-dot-count';
};

type Bubble = {
  kind: Kind;
  code: string;
  name: string;
  consumers: number;
  share: number;
  rank: number;
  x: number;
  y: number;
  r: number;
  color: string;
  parent?: string;
  inside: InLine[];
  outsideName?: string;
};

type OutLabel = {
  code: string;
  parent: string;
  text: string;
  x: number;
  y: number;
  tw: number;
  hx: number;
  hy: number;
  anchor: 'start' | 'middle' | 'end';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type Cluster = {
  code: string;
  name: string;
  consumers: number;
  share: number;
  rank: number;
  color: string;
  x: number;
  y: number;
  R: number;
  nodes: Bubble[];
};

const W = 1080;
const H = 720;
const MIN_R = 16;
const MAX_R = 46;
const GAP = 10;

const DIV_STYLE: Record<string, { color: string; ax: number; ay: number }> = {
  '3414': { color: '#3949ab', ax: 250, ay: 250 },
  '3413': { color: '#00897b', ax: 830, ay: 240 },
  '3415': { color: '#0277bd', ax: 270, ay: 510 },
  '3412': { color: '#1565c0', ax: 840, ay: 520 },
};

const FALLBACK = { color: '#1a73e8', ax: 540, ay: 360 };

function countOf(o: { consumer_count?: number } | null | undefined) {
  return Number(o?.consumer_count || 0);
}

function radiusFor(consumers: number, maxC: number) {
  if (maxC <= 0) return (MIN_R + MAX_R) / 2;
  return Math.max(MIN_R, MAX_R * Math.sqrt(Math.max(consumers, 0) / maxC));
}

function fmtK(n: number) {
  if (n >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function cleanName(name: string) {
  return name.replace(/\s+CCC$/i, '').trim();
}

function textW(s: string, size: number) {
  return s.length * size * 0.62;
}

function chordAt(r: number, y: number, pad: number) {
  const extent = Math.abs(y) + 3.2;
  if (extent >= r - 1) return 0;
  return Math.max(0, 2 * Math.sqrt(r * r - extent * extent) - pad * 2);
}

function nameSplits(name: string): string[][] {
  const words = name.split(/\s+/).filter(Boolean);
  const out: string[][] = [[name]];
  if (words.length < 2) return out;
  for (let i = 1; i < words.length; i++) {
    out.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  }
  return out.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    const bal = (lines: string[]) => Math.abs((lines[0]?.length || 0) - (lines[1]?.length || 0));
    return bal(a) - bal(b);
  });
}

function plateX(x: number, tw: number, anchor: OutLabel['anchor']) {
  if (anchor === 'start') return x - 4;
  if (anchor === 'end') return x - tw + 4;
  return x - tw / 2;
}

function fitLabel(name: string, count: string, r: number): { inside: InLine[]; outsideName?: string } {
  const pad = Math.max(6, r * 0.2);
  const nameSizes = r >= 42 ? [11, 10, 9] : r >= 34 ? [10, 9, 8] : [9, 8];

  for (const ns of nameSizes) {
    const cs = Math.max(7.5, ns - 1.5);
    const lineH = ns + 1.05;
    const countH = cs + 0.8;
    for (const lines of nameSplits(name)) {
      const block = lines.length * lineH + countH;
      if (block > r * 1.42) continue;
      const y0 = -block / 2 + lineH * 0.68;
      const nameLines: InLine[] = lines.map((text, i) => ({
        text,
        y: y0 + i * lineH,
        size: ns,
        className: 'hier-dot-name',
      }));
      const countY = y0 + lines.length * lineH + countH * 0.5;
      const slack = lines.length === 1 ? 5 : 2;
      const fits =
        nameLines.every((l) => textW(l.text, l.size) + slack <= chordAt(r, l.y, pad)) &&
        textW(count, cs) + 2 <= chordAt(r, countY, pad);
      if (fits) {
        return {
          inside: [...nameLines, { text: count, y: countY, size: cs, className: 'hier-dot-count' }],
        };
      }
    }
  }

  for (const cs of [10, 9, 8, 7.5]) {
    if (r >= 15 && textW(count, cs) <= chordAt(r, 0.4, pad)) {
      return {
        inside: [{ text: count, y: 0.6, size: cs, className: 'hier-dot-count' }],
        outsideName: name,
      };
    }
  }

  return { inside: [], outsideName: `${name} · ${count}` };
}

function packCircles<T extends { r: number }>(items: T[]) {
  const ordered = [...items].sort((a, b) => b.r - a.r);
  const placed: (T & { x: number; y: number })[] = [];

  const hits = (x: number, y: number, r: number) =>
    placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + GAP - 0.2);

  for (const item of ordered) {
    if (!placed.length) {
      placed.push({ ...item, x: 0, y: 0 });
      continue;
    }
    let best: { x: number; y: number; d: number } | null = null;
    for (const p of placed) {
      const dist = p.r + item.r + GAP;
      const steps = Math.max(16, Math.ceil((Math.PI * dist) / 4.5));
      for (let s = 0; s < steps; s++) {
        const a = (2 * Math.PI * s) / steps - Math.PI / 2;
        const x = p.x + Math.cos(a) * dist;
        const y = p.y + Math.sin(a) * dist;
        if (hits(x, y, item.r)) continue;
        const d = x * x + y * y;
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    placed.push({ ...item, x: best?.x ?? 0, y: best?.y ?? 0 });
  }

  const w = placed.reduce((s, p) => s + p.r * p.r, 0) || 1;
  const cx = placed.reduce((s, p) => s + p.x * p.r * p.r, 0) / w;
  const cy = placed.reduce((s, p) => s + p.y * p.r * p.r, 0) / w;
  const centered = placed.map((p) => ({ ...p, x: p.x - cx, y: p.y - cy }));
  const R = Math.max(...centered.map((p) => Math.hypot(p.x, p.y) + p.r), 36);
  return { nodes: centered, R };
}

function placeOutside(
  cluster: { x: number; y: number },
  items: { code: string; parent: string; text: string; x: number; y: number; r: number }[],
  others: { x: number; y: number; r: number }[]
): OutLabel[] {
  const labels: OutLabel[] = items.map((b) => {
    let ang = Math.atan2(b.y - cluster.y, b.x - cluster.x);
    if (!Number.isFinite(ang) || (Math.abs(b.x - cluster.x) < 0.8 && Math.abs(b.y - cluster.y) < 0.8)) {
      ang = -Math.PI / 2;
    }
    const towardTop = Math.abs(Math.atan2(Math.sin(ang + Math.PI / 2), Math.cos(ang + Math.PI / 2))) < 0.4;
    if (towardTop) ang += b.x >= cluster.x ? 0.55 : -0.55;

    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    let reach = b.r + 12;
    for (let k = 0; k < 6; k++) {
      const tx = b.x + cos * (reach + 8);
      const ty = b.y + sin * (reach + 8);
      const hits = others.some((o) => (Math.abs(o.x - b.x) > 0.5 || Math.abs(o.y - b.y) > 0.5) && Math.hypot(o.x - tx, o.y - ty) < o.r + 10);
      if (!hits) break;
      reach += 6;
    }
    const x1 = b.x + cos * (b.r + 1.5);
    const y1 = b.y + sin * (b.r + 1.5);
    const x2 = b.x + cos * reach;
    const y2 = b.y + sin * reach;
    const east = cos > 0.18;
    const west = cos < -0.18;
    const anchor: OutLabel['anchor'] = east ? 'start' : west ? 'end' : 'middle';
    const tw = textW(b.text, 10) + 8;
    const x = Math.min(W - 12, Math.max(12, x2 + (east ? 5 : west ? -5 : 0)));
    const y = Math.min(H - 12, Math.max(14, anchor === 'middle' ? y2 - 1 : y2));
    return {
      code: b.code,
      parent: b.parent,
      text: b.text,
      x,
      y,
      tw,
      hx: plateX(x, tw, anchor),
      hy: y - 7.5,
      anchor,
      x1,
      y1,
      x2,
      y2,
    };
  });

  labels.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1];
    const cur = labels[i];
    const overlapX = !(cur.hx + cur.tw + 4 < prev.hx || prev.hx + prev.tw + 4 < cur.hx);
    if (overlapX && cur.y - prev.y < 15) {
      const dy = 15 - (cur.y - prev.y);
      cur.y += dy;
      cur.y2 += dy;
      cur.hy += dy;
    }
  }
  return labels;
}

function separateClusters(clusters: Cluster[]) {
  const next = clusters.map((c) => ({ ...c }));
  for (let k = 0; k < 22; k++) {
    for (let i = 0; i < next.length; i++) {
      for (let j = i + 1; j < next.length; j++) {
        const a = next[i];
        const b = next[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.R + b.R + 48;
        if (d >= min) continue;
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
  }
  const minX = Math.min(...next.map((c) => c.x - c.R));
  const maxX = Math.max(...next.map((c) => c.x + c.R));
  const minY = Math.min(...next.map((c) => c.y - c.R - 24));
  const maxY = Math.max(...next.map((c) => c.y + c.R + 18));
  const ox = (W - (maxX - minX)) / 2 - minX;
  const oy = (H - (maxY - minY)) / 2 - minY + 8;
  return next.map((c) => ({
    ...c,
    x: c.x + ox,
    y: c.y + oy,
    nodes: c.nodes.map((n) => ({ ...n, x: n.x + c.x + ox, y: n.y + c.y + oy })),
  }));
}

export function ConsumerBubbleMap() {
  const [region, setRegion] = useState<Office | null>(null);
  const [divisions, setDivisions] = useState<DivBranch[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    api.hierarchy().then((r) => {
      setRegion(r.region);
      setDivisions(r.divisions || []);
      setSel(r.region?.code ? { kind: 'region', code: r.region.code } : null);
    });
  }, []);

  const model = useMemo(() => {
    const regionC =
      countOf(region) || divisions.reduce((s, d) => s + (countOf(d) || d.cccs.reduce((a, c) => a + countOf(c), 0)), 0);
    const cccCounts = divisions.flatMap((d) => d.cccs.map(countOf));
    const maxCcc = Math.max(1, ...cccCounts);
    const minCcc = Math.min(...cccCounts.filter((n) => n > 0), maxCcc);
    const rankedDivs = [...divisions]
      .map((d) => ({
        office: d,
        consumers: countOf(d) || d.cccs.reduce((s, c) => s + countOf(c), 0),
      }))
      .sort((a, b) => b.consumers - a.consumers);

    const raw: Cluster[] = rankedDivs.map((d, i) => {
      const style = DIV_STYLE[d.office.code] || {
        ...FALLBACK,
        ax: 220 + (i % 2) * 620,
        ay: 230 + Math.floor(i / 2) * 280,
      };
      const rankedCccs = [...d.office.cccs].sort((a, b) => countOf(b) - countOf(a));
      const packed = packCircles(
        rankedCccs.map((c, ri) => ({
          kind: 'ccc' as const,
          code: c.code,
          name: c.name,
          consumers: countOf(c),
          share: regionC ? countOf(c) / regionC : 0,
          rank: ri + 1,
          r: radiusFor(countOf(c), maxCcc),
          color: style.color,
          parent: d.office.code,
        }))
      );
      const nodes: Bubble[] = packed.nodes.map((n) => {
        const fit = fitLabel(cleanName(n.name), fmtK(n.consumers), n.r);
        return { ...n, inside: fit.inside, outsideName: fit.outsideName };
      });
      return {
        code: d.office.code,
        name: d.office.name,
        consumers: d.consumers,
        share: regionC ? d.consumers / regionC : 0,
        rank: i + 1,
        color: style.color,
        x: style.ax,
        y: style.ay,
        R: packed.R + 26,
        nodes,
      };
    });

    const clusters = separateClusters(raw);
    const outside = clusters.flatMap((cl) =>
      placeOutside(
        cl,
        cl.nodes
          .filter((n) => n.outsideName)
          .map((n) => ({
            code: n.code,
            parent: n.parent || cl.code,
            text: n.outsideName!,
            x: n.x,
            y: n.y,
            r: n.r,
          })),
        cl.nodes
      )
    );
    const mid = Math.round((minCcc + maxCcc) / 2 / 1000) * 1000;
    const legend = [minCcc, mid, maxCcc].map((n) => ({ n, r: radiusFor(n, maxCcc) }));
    return { regionC, maxCcc, clusters, legend, outside };
  }, [region, divisions]);

  const bubbles = model.clusters.flatMap((c) => c.nodes);
  const selectedBubble = bubbles.find((b) => sel?.kind === 'ccc' && b.code === sel.code);
  const selectedCluster = model.clusters.find((c) =>
    sel?.kind === 'division' ? c.code === sel.code : sel?.kind === 'ccc' ? c.code === selectedBubble?.parent : false
  );

  const selected = selectedBubble
    ? selectedBubble
    : selectedCluster
      ? {
          kind: 'division' as const,
          code: selectedCluster.code,
          name: selectedCluster.name,
          consumers: selectedCluster.consumers,
          share: selectedCluster.share,
          rank: selectedCluster.rank,
          color: selectedCluster.color,
          parent: region?.code,
        }
      : {
          kind: 'region' as const,
          code: region?.code || '341',
          name: region?.name || 'Darjeeling Region',
          consumers: model.regionC,
          share: 1,
          rank: 1,
          color: '#1565c0',
        };

  const hoveredBubble = bubbles.find((b) => b.code === hover);
  const kids =
    selected.kind === 'region'
      ? model.clusters
      : selected.kind === 'division'
        ? bubbles.filter((b) => b.parent === selected.code).sort((a, b) => b.consumers - a.consumers)
        : [];

  const focusDiv = sel?.kind === 'division' ? sel.code : sel?.kind === 'ccc' ? selectedBubble?.parent : null;

  const isDim = (divCode: string, cccCode?: string) => {
    if (!focusDiv) return false;
    if (sel?.kind === 'division') return divCode !== focusDiv;
    return cccCode ? cccCode !== sel?.code : divCode !== focusDiv;
  };

  const tip = hoveredBubble;

  return (
    <div className="hier-page">
      <div className="panel hier-head">
        <div>
          <h2>
            {region?.name || 'Darjeeling Region'} <span className="code-pill">{region?.code || '341'}</span>
          </h2>
        </div>
        <div className="hier-head-tools">
          <div className="hier-chips">
            <button
              type="button"
              className={`hier-chip${sel?.kind === 'region' ? ' on' : ''}`}
              onClick={() => setSel({ kind: 'region', code: region?.code || '341' })}
            >
              <i style={{ width: 18, height: 18, background: sel?.kind === 'region' ? '#fff' : '#1565c0' }} />
              Region
            </button>
            {model.clusters.map((cl) => {
              const size = 10 + 12 * Math.sqrt(cl.share);
              const on = focusDiv === cl.code;
              return (
                <button
                  type="button"
                  key={cl.code}
                  className={`hier-chip${on ? ' on' : ''}`}
                  style={on ? { background: cl.color, borderColor: cl.color } : undefined}
                  onClick={() => setSel({ kind: 'division', code: cl.code })}
                >
                  <i style={{ width: size, height: size, background: on ? '#fff' : cl.color }} />
                  {cl.name.replace('Siliguri ', '')}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="hier-work">
        <div className="panel hier-canvas-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="hier-svg" role="img" aria-label="Office bubble map sized by consumers">
            <defs>
              <filter id="hier-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.4" floodOpacity="0.16" />
              </filter>
            </defs>
            <rect
              x="0"
              y="0"
              width={W}
              height={H}
              className="hier-paper"
              onClick={() => setSel({ kind: 'region', code: region?.code || '341' })}
            />
            {model.clusters.map((cl) => {
              const on = sel?.kind === 'division' && sel.code === cl.code;
              return (
                <g key={`hull-${cl.code}`} className={isDim(cl.code) ? 'hier-dim' : undefined}>
                  <circle
                    cx={cl.x}
                    cy={cl.y}
                    r={cl.R}
                    className={`hier-hull${on ? ' on' : ''}`}
                    fill={cl.color}
                    stroke={cl.color}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSel({ kind: 'division', code: cl.code });
                    }}
                    onMouseEnter={() => setHover(cl.code)}
                    onMouseLeave={() => setHover(null)}
                  />
                  <text x={cl.x} y={cl.y - cl.R - 12} textAnchor="middle" className="hier-cluster-label" fill={cl.color}>
                    {cl.name}
                    <tspan className="hier-cluster-count"> · {fmtK(cl.consumers)}</tspan>
                  </text>
                </g>
              );
            })}
            {bubbles.map((b) => {
              const on = sel?.kind === 'ccc' && sel.code === b.code;
              const hot = hover === b.code;
              return (
                <g
                  key={b.code}
                  className={`hier-dot${on ? ' on' : ''}${hot ? ' hot' : ''}${isDim(b.parent || '', b.code) ? ' hier-dim' : ''}`}
                  onMouseEnter={() => setHover(b.code)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSel({ kind: 'ccc', code: b.code });
                  }}
                >
                  {on && <circle cx={b.x} cy={b.y} r={b.r + 5} className="hier-dot-halo" stroke={b.color} />}
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={b.r}
                    fill={b.color}
                    fillOpacity={on ? 1 : hot ? 0.55 : 0.88}
                    stroke="#fff"
                    strokeWidth={on ? 3 : 2.25}
                    filter="url(#hier-soft)"
                  />
                  {b.inside.map((line, i) => (
                    <text
                      key={`${b.code}-${i}`}
                      x={b.x}
                      y={b.y + line.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className={line.className}
                      fontSize={line.size}
                    >
                      {line.text}
                    </text>
                  ))}
                </g>
              );
            })}
            {model.outside.map((l) =>
              hover === l.code ? null : (
                <g key={`out-${l.code}`} className={isDim(l.parent, l.code) ? 'hier-dim' : undefined}>
                  <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="hier-leader" />
                  <rect x={l.hx} y={l.hy} width={l.tw} height={15} rx="7.5" className="hier-out-plate" />
                  <text x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="middle" className="hier-out-name">
                    {l.text}
                  </text>
                </g>
              )
            )}
          </svg>
          <div className="hier-scale" aria-hidden>
            {[...model.legend].reverse().map((s) => (
              <span key={s.n} className="hier-scale-item">
                <i style={{ width: s.r * 0.72, height: s.r * 0.72 }} />
                {fmtK(s.n)}
              </span>
            ))}
          </div>
          {tip && (
            <div
              className="hier-tip"
              style={{ left: `${(tip.x / W) * 100}%`, top: `${((tip.y - tip.r) / H) * 100}%` }}
            >
              <strong>{tip.name}</strong>
              <span>{tip.consumers.toLocaleString()} consumers</span>
            </div>
          )}
        </div>

        <aside className="panel hier-inspect">
          <p className="hier-kicker">
            {selected.kind === 'ccc' ? 'CCC' : selected.kind === 'division' ? 'Division' : 'Region'}
          </p>
          <h3>
            {selected.name} <span className="code-pill">{selected.code}</span>
          </h3>
          <p className="hier-stat">
            {selected.consumers.toLocaleString()}
            <span>{(selected.share * 100).toFixed(1)}%</span>
          </p>
          <div className="hier-bar" aria-hidden>
            <span style={{ width: `${Math.max(selected.share * 100, 2)}%`, background: selected.color }} />
          </div>
          {kids.length > 0 && (
            <div className="hier-kids">
              {kids.map((c) => {
                const size = 8 + 14 * Math.sqrt(c.consumers / (selected.kind === 'region' ? model.regionC || 1 : model.maxCcc));
                return (
                  <button
                    type="button"
                    key={c.code}
                    className="hier-kid"
                    onClick={() =>
                      setSel({
                        kind: selected.kind === 'region' ? 'division' : 'ccc',
                        code: c.code,
                      })
                    }
                  >
                    <i style={{ width: size, height: size, background: c.color }} />
                    <span>
                      {c.rank}. {c.name}
                    </span>
                    <b>{fmtK(c.consumers)}</b>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
