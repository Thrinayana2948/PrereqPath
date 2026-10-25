import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const W = 128, H = 48, COL = 204, ROW = 78, PAD = 36, MIN_K = 0.2, MAX_K = 3;
const STATUS_LABEL = { ok: 'Eligible', cycle: 'Cycle member', blocked: 'Blocked', missing: 'Missing code', unknown: 'Unknown' };
const GLYPH = { cycle: '↻', blocked: '⊘', missing: '?' };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function statusMap(nodes, analysis) {
  const members = new Set(analysis?.cycle_members || []);
  const blocked = new Set((analysis?.blocked || []).map((b) => b.course));
  const ordered = new Set(analysis?.order || []);
  const status = {};
  for (const n of nodes) {
    status[n.code] = n.missing ? 'missing' : members.has(n.code) ? 'cycle'
      : blocked.has(n.code) ? 'blocked' : ordered.has(n.code) ? 'ok' : 'unknown';
  }
  return status;
}

// Rank courses by BFS distance from entry courses (indegree 0); a course only reachable through a
// cycle seeds a new BFS. Cycle edges that do not point to a strictly higher rank are ignored for
// layering, which leaves a DAG and keeps entry courses on the left.
function backEdges(nodes, edges) {
  const adj = {}, indeg = {};
  for (const n of nodes) { adj[n.code] = []; indeg[n.code] = 0; }
  for (const e of edges) {
    if (e.source in adj && e.target in adj) { adj[e.source].push(e.target); indeg[e.target]++; }
  }
  const codes = Object.keys(adj).sort();
  const rank = {};
  const bfs = (seeds, base) => {
    const queue = [...seeds];
    seeds.forEach((c) => { rank[c] = base; });
    while (queue.length) {
      const u = queue.shift();
      for (const v of adj[u]) if (!(v in rank)) { rank[v] = rank[u] + 1; queue.push(v); }
    }
  };
  bfs(codes.filter((c) => indeg[c] === 0), 0);
  for (const c of codes) if (!(c in rank)) bfs([c], 0);
  const reaches = (from, to) => {
    const seen = new Set([from]), queue = [from];
    while (queue.length) {
      const u = queue.shift();
      if (u === to) return true;
      for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); queue.push(v); }
    }
    return false;
  };
  // Every cycle has at least one non-increasing edge, and such an edge lies on a cycle, so this
  // removes all cycles while never touching edges outside one.
  return new Set(edges
    .filter((e) => e.source in rank && e.target in rank && rank[e.target] <= rank[e.source] && reaches(e.target, e.source))
    .map((e) => `${e.source}>${e.target}`));
}

// Columns = longest path over the graph minus the ignored cycle edges. Edges outside cycles are
// never ignored, so acyclic parts match the Kahn levels; cycle members spread along their chains.
function computeLayout(nodes, edges) {
  const back = backEdges(nodes, edges);
  const level = {};
  for (const n of nodes) level[n.code] = 0;
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const { source, target } of edges) {
      if (!(source in level) || !(target in level) || back.has(`${source}>${target}`)) continue;
      if (level[target] < level[source] + 1) { level[target] = level[source] + 1; changed = true; }
    }
    if (!changed) break;
  }
  const columns = {};
  for (const n of nodes) (columns[level[n.code]] ||= []).push(n.code);
  const tallest = Math.max(1, ...Object.values(columns).map((c) => c.length));
  const pos = {};
  for (const [lvl, codes] of Object.entries(columns)) {
    codes.sort();
    const offset = ((tallest - codes.length) * ROW) / 2;
    codes.forEach((code, i) => { pos[code] = { x: Number(lvl) * COL, y: offset + i * ROW }; });
  }
  return pos;
}

function edgePath(s, t) {
  if (t.x >= s.x + W + 8) {
    const x1 = s.x + W, y1 = s.y + H / 2, x2 = t.x, y2 = t.y + H / 2, dx = Math.max(30, (x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  if (Math.abs(s.x - t.x) < W) {
    const down = t.y > s.y, side = down ? 30 : -30;
    const x1 = s.x + W / 2 + side / 2, y1 = down ? s.y + H : s.y;
    const x2 = t.x + W / 2 + side / 2, y2 = down ? t.y : t.y + H;
    const my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1 + side * 2},${my} ${x2 + side * 2},${my} ${x2},${y2}`;
  }
  // Backward edge (target in an earlier column): arc underneath.
  const x1 = s.x + W / 2, y1 = s.y + H, x2 = t.x + W / 2, y2 = t.y + H;
  const drop = Math.max(y1, y2) + 56;
  return `M${x1},${y1} C${x1},${drop} ${x2},${drop} ${x2},${y2}`;
}

// Push a dropped node down until it no longer overlaps another node.
function settle(pos, code) {
  const me = { ...pos[code] };
  const hits = () => Object.entries(pos).some(([c, q]) => c !== code && Math.abs(q.x - me.x) < W + 10 && Math.abs(q.y - me.y) < H + 10);
  for (let i = 0; i < 60 && hits(); i++) me.y += 14;
  return { ...pos, [code]: me };
}

function bounds(pos) {
  const pts = Object.values(pos);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + W, h: Math.max(...ys) - Math.min(...ys) + H + 56 };
}

export default function GraphView({ nodes, edges, analysis, names = {}, height = 560, inspector = false }) {
  const layout = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);
  const [pos, setPos] = useState(layout);
  const [view, setView] = useState({ x: PAD, y: PAD, k: 1 });
  const [selected, setSelected] = useState(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const hasNodes = nodes.length > 0;

  const fitTo = useCallback((p) => {
    const svg = svgRef.current, b = bounds(p);
    if (!svg || !b) return;
    const r = svg.getBoundingClientRect();
    const k = clamp(Math.min((r.width - 2 * PAD) / b.w, (r.height - 2 * PAD) / b.h), MIN_K, 1.25);
    setView({ k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k });
  }, []);

  // Auto-fit on new data and on canvas resize, until the user pans or zooms manually.
  const touched = useRef(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(() => { touched.current = false; setPos(layout); fitTo(layout); }, [layout, fitTo]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (!touched.current) fitTo(posRef.current); });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [hasNodes, fitTo]);
  useEffect(() => { if (selected && !nodes.some((n) => n.code === selected)) setSelected(null); }, [nodes, selected]);

  const zoomAt = useCallback((factor, cx, cy) => {
    touched.current = true;
    setView((v) => {
      const k = clamp(v.k * factor, MIN_K, MAX_K), f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [hasNodes, zoomAt]);

  const status = useMemo(() => statusMap(nodes, analysis), [nodes, analysis]);
  const group = useMemo(() => {
    const g = {};
    (analysis?.cycle_groups || []).forEach((grp, i) => grp.forEach((c) => { g[c] = i; }));
    return g;
  }, [analysis]);

  if (!hasNodes) {
    return <div className="empty graph-empty">No courses to draw yet. Add courses and prerequisites, or load the demo data.</div>;
  }

  const zoomCenter = (factor) => {
    const r = svgRef.current.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  };
  const toContent = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };
  const capture = (e) => svgRef.current.setPointerCapture?.(e.pointerId);

  const onBackgroundDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    capture(e);
  };
  const onNodeDown = (e, code) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = toContent(e);
    drag.current = { type: 'node', code, dx: p.x - pos[code].x, dy: p.y - pos[code].y, sx: e.clientX, sy: e.clientY, moved: false };
    capture(e);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.type === 'pan') {
      touched.current = true;
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    } else {
      const p = toContent(e);
      setPos((prev) => ({ ...prev, [d.code]: { x: p.x - d.dx, y: p.y - d.dy } }));
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.type === 'node') {
      if (d.moved) setPos((prev) => settle(prev, d.code));
      else setSelected((s) => (s === d.code ? null : d.code));
    } else if (!d.moved) setSelected(null);
  };

  const incoming = selected ? edges.filter((e) => e.target === selected).map((e) => e.source) : [];
  const outgoing = selected ? edges.filter((e) => e.source === selected).map((e) => e.target) : [];
  const select = (code) => setSelected((s) => (s === code ? null : code));
  const label = (n) => names[n.code] || n.name || (n.missing ? 'not defined' : '');

  return (
    <div className={`graph${inspector ? ' with-inspector' : ''}`}>
      <div className="graph-toolbar">
        <div className="legend" aria-label="Legend">
          <span><i className="swatch ok" />Eligible</span>
          <span><i className="swatch cycle" />Cycle member ↻</span>
          <span><i className="swatch blocked" />Blocked ⊘</span>
          {nodes.some((n) => n.missing) && <span><i className="swatch missing" />Missing ?</span>}
          {selected && <><span><i className="line in" />Requires</span><span><i className="line out" />Unlocks</span></>}
        </div>
        <div className="toolbar-group" role="group" aria-label="Zoom">
          <button type="button" className="icon-btn" onClick={() => zoomCenter(1 / 1.25)} aria-label="Zoom out">−</button>
          <span className="zoom-label" aria-live="polite">{Math.round(view.k * 100)}%</span>
          <button type="button" className="icon-btn" onClick={() => zoomCenter(1.25)} aria-label="Zoom in">+</button>
          <button type="button" className="btn ghost sm" onClick={() => { touched.current = false; fitTo(pos); }}>Fit</button>
          <button type="button" className="btn ghost sm" onClick={() => { touched.current = false; setPos(layout); setSelected(null); fitTo(layout); }}>Reset layout</button>
        </div>
      </div>
      <div className="graph-body">
        <div className="graph-canvas" style={{ height }}>
          <svg ref={svgRef} width="100%" height="100%" onPointerDown={onBackgroundDown} onPointerMove={onMove}
               onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={(e) => e.key === 'Escape' && setSelected(null)}
               role="application" aria-label="Directed prerequisite graph. Drag background to pan, scroll to zoom, Tab to focus courses.">
            <defs>
              {['edge', 'cycle', 'missing', 'in', 'out'].map((k) => (
                <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse"
                        markerWidth="10" markerHeight="10" orient="auto-start-reverse">
                  <path d="M0,1 L10,5 L0,9 z" className={`arrow ${k}`} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {edges.map((e) => {
                const s = pos[e.source], t = pos[e.target];
                if (!s || !t) return null;
                const cyc = group[e.source] !== undefined && group[e.source] === group[e.target];
                const miss = status[e.source] === 'missing' || status[e.target] === 'missing';
                const kind = selected === e.target ? 'in' : selected === e.source ? 'out' : cyc ? 'cycle' : miss ? 'missing' : 'edge';
                const dim = selected && kind !== 'in' && kind !== 'out';
                return (
                  <path key={e.id} d={edgePath(s, t)} className={`link ${kind}${dim ? ' dim' : ''}`} markerEnd={`url(#arrow-${kind})`}>
                    <title>{`${e.source} → ${e.target}`}</title>
                  </path>
                );
              })}
              {nodes.map((n) => {
                const p = pos[n.code];
                if (!p) return null;
                const st = status[n.code];
                const rel = n.code === selected ? ' selected' : incoming.includes(n.code) ? ' in' : outgoing.includes(n.code) ? ' out' : selected ? ' dim' : '';
                const text = label(n);
                return (
                  <g key={n.code} transform={`translate(${p.x},${p.y})`} className={`node ${st}${rel}`}
                     onPointerDown={(e) => onNodeDown(e, n.code)} tabIndex={0}
                     onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n.code); } }}
                     aria-label={`${n.code} ${text}, ${STATUS_LABEL[st]}`}>
                    <title>{`${n.code}${text ? ` — ${text}` : ''} (${STATUS_LABEL[st]})`}</title>
                    <rect width={W} height={H} rx="8" />
                    <text x={12} y={20} className="code">{n.code}</text>
                    {GLYPH[st] && <text x={W - 12} y={20} className="glyph">{GLYPH[st]}</text>}
                    <text x={12} y={36} className="name">{text.length > 19 ? `${text.slice(0, 18)}…` : text}</text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        {inspector ? (
          <aside className="inspector" aria-live="polite">
            {selected ? (
              <>
                <p className="eyebrow">Selected course</p>
                <h3 className="mono">{selected}</h3>
                <p className="muted">{names[selected] || nodes.find((n) => n.code === selected)?.name || ''}</p>
                <span className={`pill ${status[selected]}`}>{STATUS_LABEL[status[selected]]}</span>
                <h4>Requires ({incoming.length})</h4>
                <div className="chips">
                  {incoming.length ? incoming.map((c) => <button key={c} type="button" className="chip in" onClick={() => setSelected(c)}>{c}</button>)
                    : <span className="muted">No prerequisites</span>}
                </div>
                <h4>Unlocks ({outgoing.length})</h4>
                <div className="chips">
                  {outgoing.length ? outgoing.map((c) => <button key={c} type="button" className="chip out" onClick={() => setSelected(c)}>{c}</button>)
                    : <span className="muted">No dependents</span>}
                </div>
                <button type="button" className="btn ghost sm" onClick={() => setSelected(null)}>Clear selection</button>
              </>
            ) : (
              <>
                <p className="eyebrow">Inspector</p>
                <p className="muted">Select a course to see what it requires and what it unlocks.</p>
                <ul className="tips">
                  <li>Scroll to zoom, drag the background to pan</li>
                  <li>Drag a course to reposition it</li>
                  <li>Tab to a course, Enter to select, Esc to clear</li>
                </ul>
                <p className="muted">{nodes.length} courses · {edges.length} dependencies</p>
              </>
            )}
          </aside>
        ) : (
          <p className="hint">
            {selected ? <>Selected <b>{selected}</b> · requires {incoming.join(', ') || 'nothing'} · unlocks {outgoing.join(', ') || 'nothing'}</>
              : 'Click a course to highlight it. Scroll to zoom, drag to pan.'}
          </p>
        )}
      </div>
    </div>
  );
}
