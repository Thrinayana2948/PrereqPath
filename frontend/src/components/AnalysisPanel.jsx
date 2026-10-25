import { useState } from 'react';

const REASON = { cycle: 'Behind a cycle', unresolved_prerequisite: 'Unresolved prerequisite' };

export function StatsBar({ analysis }) {
  if (!analysis) return null;
  const s = analysis.summary;
  const cards = [
    ['Courses', s.total_courses],
    ['Prerequisites', s.total_prerequisites],
    ['Ordered', s.ordered_courses, 'ok'],
    ['Cycle members', s.cycle_members, s.cycle_members ? 'cycle' : ''],
    ['Blocked', s.blocked_courses, s.blocked_courses ? 'blocked' : ''],
    ['Unresolved refs', s.unresolved_references, s.unresolved_references ? 'missing' : ''],
  ];
  return (
    <div className="stats">
      {cards.map(([label, value, tone]) => (
        <div key={label} className={`stat ${tone || ''}`}><span>{value}</span><small>{label}</small></div>
      ))}
      <div className={`stat verdict ${s.is_complete ? 'ok' : 'cycle'}`}>
        <span>{s.is_complete ? '✓' : '!'}</span>
        <small>{s.is_complete ? 'Complete plan' : 'Plan incomplete'}</small>
      </div>
    </div>
  );
}

const Chip = ({ code, names, tone }) => (
  <span className={`chip ${tone || ''}`} title={names[code] || ''}>{code}</span>
);

function OrderTab({ a, names }) {
  const s = a.summary;
  const terms = {};
  a.order.forEach((c) => (terms[a.levels[c]] ||= []).push(c));
  return (
    <div>
      {s.total_courses === 0 ? <p className="empty">No courses yet.</p> : s.is_complete ? (
        <div className="callout ok">Every course is eligible and all prerequisites resolve. Below is a valid complete order.</div>
      ) : (
        <div className="callout warn">
          No complete order exists: {s.cycle_members} course(s) in cycles, {s.blocked_courses} blocked,{' '}
          {s.unresolved_references} unresolved reference(s). Showing only the {s.ordered_courses} eligible course(s).
        </div>
      )}
      {a.order.length > 0 && (
        <>
          <h4>Topological order</h4>
          <ol className="sequence">
            {a.order.map((c) => <li key={c}><Chip code={c} names={names} /></li>)}
          </ol>
          <h4>Suggested terms <small>(earliest term each course can be taken)</small></h4>
          <div className="terms">
            {Object.keys(terms).sort((x, y) => x - y).map((t) => (
              <div key={t} className="term">
                <b>Term {Number(t) + 1}</b>
                {terms[t].map((c) => <div key={c} className="term-item"><Chip code={c} names={names} /><span>{names[c]}</span></div>)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TraceTab({ a }) {
  if (!a.trace.length) return <p className="empty">The queue never started: no course has indegree 0.</p>;
  return (
    <div>
      <h4>Initial indegree</h4>
      <div className="chips">
        {Object.entries(a.initial_indegree).map(([c, d]) => (
          <span key={c} className={`chip ${d === 0 ? 'ok' : ''}`}>{c}: {d}</span>
        ))}
      </div>
      <div className="table-wrap">
        <table className="trace">
          <thead><tr><th>Step</th><th>Dequeued</th><th>Indegree updates</th><th>Enqueued</th><th>Queue after</th></tr></thead>
          <tbody>
            {a.trace.map((t) => (
              <tr key={t.step}>
                <td>{t.step}</td>
                <td><b>{t.dequeued}</b></td>
                <td>{t.decremented.map((d) => `${d.course}→${d.indegree}`).join(', ') || '—'}</td>
                <td>{t.enqueued.join(', ') || '—'}</td>
                <td>[{t.queue.join(', ')}]</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.order.length < a.summary.total_courses && (
        <p className="hint">Queue emptied with {a.summary.total_courses - a.order.length} course(s) still having indegree &gt; 0.</p>
      )}
    </div>
  );
}

function CyclesTab({ a, names }) {
  return (
    <div>
      <h4>Cycle groups <small>(strongly connected components)</small></h4>
      {a.cycle_groups.length ? a.cycle_groups.map((g) => (
        <div key={g.join()} className="chips">{g.map((c) => <Chip key={c} code={c} names={names} tone="cycle" />)}</div>
      )) : <p className="empty">No cycles detected by DFS.</p>}
      {a.cycles.length > 0 && (
        <>
          <h4>Back-edge cycles found by DFS</h4>
          <ul className="plain">{a.cycles.map((c, i) => <li key={i} className="mono">{c.join(' → ')}</li>)}</ul>
        </>
      )}
      <h4>Blocked downstream courses</h4>
      {a.blocked.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Course</th><th>Reason</th><th>Waiting on</th></tr></thead>
            <tbody>
              {a.blocked.map((b) => (
                <tr key={b.course}>
                  <td><Chip code={b.course} names={names} tone="blocked" /></td>
                  <td>{b.reasons.map((r) => <span key={r} className="badge">{REASON[r] || r}</span>)}</td>
                  <td className="mono">{b.waiting_on.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">No blocked courses.</p>}
    </div>
  );
}

function UnresolvedTab({ a }) {
  return (
    <div>
      {a.unresolved.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Prerequisite</th><th>Dependent</th><th>Missing code(s)</th></tr></thead>
            <tbody>
              {a.unresolved.map((u) => (
                <tr key={`${u.prerequisite}>${u.dependent}`}>
                  <td className="mono">{u.prerequisite}</td><td className="mono">{u.dependent}</td>
                  <td>{u.missing.map((m) => <span key={m} className="chip missing">{m}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">All prerequisite references resolve to existing courses.</p>}
      {a.duplicate_edges.length > 0 && (
        <>
          <h4>Duplicate relationships (counted once)</h4>
          <ul className="plain">{a.duplicate_edges.map(([p, d], i) => <li key={i} className="mono">{p} → {d}</li>)}</ul>
        </>
      )}
    </div>
  );
}

const COMPLEXITY = [
  ['Build adjacency lists', 'O(V + E)', 'O(V + E)', 'Neighbour lists are sorted for deterministic output: O(E log V) extra time.'],
  ["Kahn's topological sort", 'O(V + E)', 'O(V)', 'Each course is enqueued/dequeued once; each edge decrements one indegree.'],
  ['DFS cycle detection (3 colours)', 'O(V + E)', 'O(V)', 'Iterative stack; listing each found cycle adds O(cycle length), worst case O(V·E) output.'],
  ["Tarjan's SCC (cycle members)", 'O(V + E)', 'O(V)', 'A course is a cycle member iff its strongly connected component has > 1 course.'],
  ['Blocked-course reachability (BFS)', 'O(V + E)', 'O(V)', 'Forward search from cycle members and courses with missing prerequisites.'],
];

function ComplexityTab({ a }) {
  return (
    <div>
      <p className="muted">For this graph: <b className="mono">V = {a.summary.total_courses}</b>, <b className="mono">E = {a.summary.total_prerequisites}</b>. Auxiliary space excludes the input graph and the returned trace.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Step</th><th>Time</th><th>Aux. space</th><th>Notes</th></tr></thead>
          <tbody>
            {COMPLEXITY.map(([step, t, s, note]) => (
              <tr key={step}><td>{step}</td><td className="mono">{t}</td><td className="mono">{s}</td><td className="muted">{note}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AnalysisPanel({ analysis, names = {} }) {
  const [tab, setTab] = useState('order');
  if (!analysis) return <p className="empty">No analysis yet.</p>;
  const a = analysis;
  const tabs = [
    ['order', 'Order'],
    ['trace', `Queue trace (${a.trace.length})`],
    ['cycles', `Cycles & blocked (${a.summary.cycle_members + a.summary.blocked_courses})`],
    ['unresolved', `Unresolved (${a.summary.unresolved_references})`],
    ['complexity', 'Complexity'],
  ];
  return (
    <div>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
                  className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'order' && <OrderTab a={a} names={names} />}
        {tab === 'trace' && <TraceTab a={a} />}
        {tab === 'cycles' && <CyclesTab a={a} names={names} />}
        {tab === 'unresolved' && <UnresolvedTab a={a} />}
        {tab === 'complexity' && <ComplexityTab a={a} />}
      </div>
    </div>
  );
}
