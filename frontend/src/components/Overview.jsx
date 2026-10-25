export default function Overview({ courses, analysis, busy, onNavigate, onLoadSample }) {
  const s = analysis?.summary;
  if (!s) return <p className="empty">No analysis available.</p>;
  const terms = s.ordered_courses ? Math.max(...Object.values(analysis.levels)) + 1 : 0;
  const entry = Object.entries(analysis.initial_indegree).filter(([, d]) => d === 0).map(([c]) => c);
  const hubs = [...courses].filter((c) => c.dependent_count > 0).sort((a, b) => b.dependent_count - a.dependent_count || a.code.localeCompare(b.code)).slice(0, 5);
  const empty = s.total_courses === 0;

  const headline = empty ? 'Start by adding courses'
    : s.is_complete ? `Complete plan: ${s.total_courses} courses in ${terms} term${terms === 1 ? '' : 's'}`
    : 'Plan is incomplete';
  const detail = empty ? 'Create courses and prerequisite relationships, or load the fictional demo curriculum to explore the planner.'
    : s.is_complete ? 'Every prerequisite resolves and no cycles exist, so a valid topological order is available.'
    : `${s.cycle_members} course(s) sit in cycles, ${s.blocked_courses} are blocked downstream and ${s.unresolved_references} reference(s) are unresolved.`;

  const stats = [
    ['Courses', s.total_courses, ''],
    ['Dependencies', s.total_prerequisites, ''],
    ['Eligible', s.ordered_courses, 'ok'],
    ['Terms needed', s.is_complete ? terms : '—', ''],
    ['Cycle members', s.cycle_members, s.cycle_members ? 'cycle' : ''],
    ['Blocked', s.blocked_courses, s.blocked_courses ? 'blocked' : ''],
  ];

  return (
    <div className="stack">
      <section className={`card hero ${empty ? '' : s.is_complete ? 'ok' : 'warn'}`}>
        <div>
          <p className="eyebrow">Plan status</p>
          <h2>{headline}</h2>
          <p className="muted">{detail}</p>
        </div>
        <div className="actions">
          {empty ? (
            <>
              <button type="button" className="btn primary" onClick={onLoadSample} disabled={busy}>Load demo curriculum</button>
              <button type="button" className="btn ghost" onClick={() => onNavigate('courses')}>Add a course</button>
            </>
          ) : s.is_complete ? (
            <>
              <button type="button" className="btn primary" onClick={() => onNavigate('graph')}>Open dependency graph</button>
              <button type="button" className="btn ghost" onClick={() => onNavigate('analysis')}>View order</button>
            </>
          ) : (
            <>
              <button type="button" className="btn primary" onClick={() => onNavigate('analysis')}>Review issues</button>
              <button type="button" className="btn ghost" onClick={() => onNavigate('graph')}>Open graph</button>
            </>
          )}
        </div>
      </section>

      <div className="stats">
        {stats.map(([label, value, tone]) => (
          <div key={label} className={`stat ${tone}`}><span>{value}</span><small>{label}</small></div>
        ))}
      </div>

      {!empty && (
        <div className="grid-2">
          <section className="card">
            <header className="card-head"><h2>Entry courses</h2><span className="count">{entry.length}</span></header>
            <p className="muted">No prerequisites and no missing references: can be taken first.</p>
            <div className="chips">{entry.length ? entry.map((c) => <span key={c} className="chip ok">{c}</span>) : <span className="muted">None — every course has a prerequisite.</span>}</div>
          </section>
          <section className="card">
            <header className="card-head"><h2>Most depended-on</h2></header>
            {hubs.length ? (
              <ul className="rank">
                {hubs.map((c) => (
                  <li key={c.id}>
                    <b className="mono">{c.code}</b><span>{c.name}</span>
                    <span className="bar" style={{ '--w': `${(c.dependent_count / hubs[0].dependent_count) * 100}%` }} />
                    <small>{c.dependent_count}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No prerequisite relationships yet.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
