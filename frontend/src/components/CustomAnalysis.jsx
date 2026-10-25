import { useMemo, useState } from 'react';
import { api } from '../api';
import AnalysisPanel, { StatsBar } from './AnalysisPanel';
import GraphView from './GraphView';

const PRESETS = {
  'Valid DAG': 'CS101, CS102, CS201, MATH101\nCS101 -> CS102 -> CS201\nMATH101 -> CS201',
  Cycle: 'A1, B1, C1, D1, E1, F1\nA1 -> B1 -> C1 -> A1\nC1 -> D1 -> E1',
  Unresolved: 'CS101, CS201, CS301\nCS101 -> CS201\nMATH999 -> CS201\nCS201 -> CS301',
};

// Lines with "->" are prerequisite chains (A -> B -> C); other lines list course codes.
export function parseInput(text) {
  const courses = [], prerequisites = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line.includes('->')) {
      const parts = line.split('->').map((p) => p.trim().toUpperCase());
      if (parts.some((p) => !p)) throw new Error(`Incomplete chain: "${line}"`);
      for (let i = 0; i + 1 < parts.length; i++) prerequisites.push({ prerequisite: parts[i], dependent: parts[i + 1] });
    } else {
      courses.push(...line.split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase()));
    }
  }
  return { courses, prerequisites };
}

export default function CustomAnalysis({ courses, prereqs }) {
  const [text, setText] = useState(PRESETS.Cycle);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fromDatabase = () =>
    [courses.map((c) => c.code).join(', '), ...prereqs.map((p) => `${p.prerequisite_code} -> ${p.dependent_code}`)].join('\n');

  const run = async () => {
    setError('');
    let input;
    try { input = parseInput(text); } catch (e) { return setError(e.message); }
    if (!input.courses.length && !input.prerequisites.length) return setError('Enter at least one course.');
    setLoading(true);
    try {
      setResult({ input, analysis: await api.analyzeCustom(input) });
    } catch (e) {
      setResult(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const graph = useMemo(() => {
    if (!result) return null;
    const known = [...new Set(result.input.courses)];
    const missing = [...new Set(result.analysis.unresolved.flatMap((u) => u.missing))];
    const seen = new Set();
    const edges = result.input.prerequisites
      .filter((e) => { const k = `${e.prerequisite}>${e.dependent}`; return !seen.has(k) && seen.add(k); })
      .map((e, i) => ({ id: i, source: e.prerequisite, target: e.dependent }));
    return { nodes: [...known.map((code) => ({ code })), ...missing.map((code) => ({ code, missing: true }))], edges };
  }, [result]);

  return (
    <section className="card sandbox" aria-labelledby="whatif-title">
      <header className="card-head">
        <h2 id="whatif-title">What-if sandbox</h2>
        <span className="pill neutral">Not saved</span>
        <small className="muted">Analysed on the server without touching your saved courses. Unknown codes are reported as unresolved.</small>
      </header>
      <div className="custom-grid">
        <div>
          <div className="chips">
            {Object.keys(PRESETS).map((k) => (
              <button key={k} type="button" className="btn ghost sm" onClick={() => setText(PRESETS[k])}>{k}</button>
            ))}
            <button type="button" className="btn ghost sm" onClick={() => setText(fromDatabase())} disabled={!courses.length}>
              Copy saved data
            </button>
          </div>
          <textarea className="mono editor" rows={9} value={text} onChange={(e) => setText(e.target.value)}
                    aria-label="Custom graph input" spellCheck={false} />
          <p className="hint">One line of comma-separated course codes, then chains like <code>CS101 -&gt; CS201</code>. <code>#</code> starts a comment.</p>
          {error && <p className="field-error">{error}</p>}
          <button type="button" className="btn primary" onClick={run} disabled={loading}>
            {loading ? 'Analysing…' : 'Analyse'}
          </button>
        </div>
        <div>
          {result ? (
            <>
              <StatsBar analysis={result.analysis} />
              <GraphView nodes={graph.nodes} edges={graph.edges} analysis={result.analysis} height={340} />
              <AnalysisPanel analysis={result.analysis} />
            </>
          ) : <p className="empty">Pick a preset or type a graph, then press Analyse.</p>}
        </div>
      </div>
    </section>
  );
}
