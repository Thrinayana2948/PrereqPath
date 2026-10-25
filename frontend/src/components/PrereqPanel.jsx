import { useState } from 'react';

export default function PrereqPanel({ courses, prereqs, busy, onSave, onDelete }) {
  const [form, setForm] = useState({ pre: '', dep: '' });
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const reset = () => { setForm({ pre: '', dep: '' }); setEditId(null); setError(''); };

  const submit = async (e) => {
    e.preventDefault();
    const pre = Number(form.pre), dep = Number(form.dep);
    if (!pre || !dep) return setError('Choose both courses.');
    if (pre === dep) return setError('A course cannot be its own prerequisite.');
    if (prereqs.some((p) => p.prerequisite_id === pre && p.dependent_id === dep && p.id !== editId)) {
      return setError('This relationship already exists.');
    }
    setError('');
    if (await onSave(editId, { prerequisite_id: pre, dependent_id: dep })) reset();
  };

  const startEdit = (p) => {
    setEditId(p.id);
    setForm({ pre: String(p.prerequisite_id), dep: String(p.dependent_id) });
    setError('');
  };

  const options = courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>);
  const q = filter.trim().toUpperCase();
  const shown = q ? prereqs.filter((p) => p.prerequisite_code.includes(q) || p.dependent_code.includes(q)) : prereqs;

  return (
    <section className="card">
      <header className="card-head"><h2>Prerequisites</h2><span className="count">{prereqs.length}</span></header>
      {courses.length < 2 ? (
        <p className="empty">Add at least two courses to create a prerequisite relationship.</p>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <div className="row align-end">
            <label className="field">
              <span>Prerequisite (take first)</span>
              <select value={form.pre} onChange={(e) => setForm({ ...form, pre: e.target.value })}>
                <option value="">Select…</option>{options}
              </select>
            </label>
            <span className="arrow-sep" aria-hidden>→</span>
            <label className="field">
              <span>Dependent course</span>
              <select value={form.dep} onChange={(e) => setForm({ ...form, dep: e.target.value })}>
                <option value="">Select…</option>{options}
              </select>
            </label>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="actions">
            <button className="btn primary" disabled={busy}>{editId ? 'Save relationship' : 'Add relationship'}</button>
            {editId && <button type="button" className="btn ghost" onClick={reset}>Cancel</button>}
          </div>
          <p className="hint">Cycles are allowed to be saved so the analyser can detect and explain them.</p>
        </form>
      )}

      {prereqs.length > 5 && (
        <input className="search" placeholder="Filter by course code…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {prereqs.length === 0 ? (
        <p className="empty">No prerequisite relationships yet.</p>
      ) : (
        <ul className="list">
          {shown.map((p) => (
            <li key={p.id} className={editId === p.id ? 'editing' : ''}>
              <div className="list-main mono"><b>{p.prerequisite_code}</b> → <b>{p.dependent_code}</b></div>
              <div className="list-actions">
                <button type="button" className="btn ghost sm" onClick={() => startEdit(p)} disabled={busy}>Edit</button>
                <button type="button" className="btn danger sm" onClick={() => onDelete(p)} disabled={busy}>Delete</button>
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="empty">No matches.</li>}
        </ul>
      )}
    </section>
  );
}
