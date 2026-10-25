import { useState } from 'react';

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
const EMPTY = { code: '', name: '', description: '' };

function validate(f) {
  const errors = {};
  if (!CODE_RE.test(f.code.trim().toUpperCase())) errors.code = '1–20 letters, digits, - or _';
  if (!f.name.trim()) errors.name = 'Name is required';
  else if (f.name.trim().length > 200) errors.name = 'Max 200 characters';
  if (f.description.length > 2000) errors.description = 'Max 2000 characters';
  return errors;
}

export default function CoursePanel({ courses, busy, onSave, onDelete }) {
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [errors, setErrors] = useState({});
  const [filter, setFilter] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const reset = () => { setForm(EMPTY); setEditId(null); setErrors({}); };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = { code: form.code.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim() || null };
    if (await onSave(editId, payload)) reset();
  };

  const startEdit = (c) => {
    setEditId(c.id);
    setForm({ code: c.code, name: c.name, description: c.description || '' });
    setErrors({});
  };

  const q = filter.trim().toLowerCase();
  const shown = q ? courses.filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(q)) : courses;

  return (
    <section className="card">
      <header className="card-head"><h2>Courses</h2><span className="count">{courses.length}</span></header>
      <form className="form" onSubmit={submit} noValidate>
        <div className="row">
          <label className="field narrow">
            <span>Code</span>
            <input value={form.code} onChange={set('code')} placeholder="CS101" maxLength={20}
                   aria-invalid={!!errors.code} style={{ textTransform: 'uppercase' }} />
            {errors.code && <em>{errors.code}</em>}
          </label>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={set('name')} placeholder="Introduction to Programming" maxLength={200}
                   aria-invalid={!!errors.name} />
            {errors.name && <em>{errors.name}</em>}
          </label>
        </div>
        <label className="field">
          <span>Description <small>(optional)</small></span>
          <textarea rows={2} value={form.description} onChange={set('description')} maxLength={2000} />
          {errors.description && <em>{errors.description}</em>}
        </label>
        <div className="actions">
          <button className="btn primary" disabled={busy}>{editId ? 'Save changes' : 'Add course'}</button>
          {editId && <button type="button" className="btn ghost" onClick={reset}>Cancel</button>}
        </div>
      </form>

      {courses.length > 5 && (
        <input className="search" placeholder="Filter courses…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {courses.length === 0 ? (
        <p className="empty">No courses yet. Add one above or load the demo curriculum.</p>
      ) : (
        <ul className="list">
          {shown.map((c) => (
            <li key={c.id} className={editId === c.id ? 'editing' : ''}>
              <div className="list-main">
                <b className="mono">{c.code}</b>
                <span>{c.name}</span>
                {c.is_sample && <span className="badge" title="Fictional demo data">demo</span>}
                <small className="muted">{c.prerequisite_count} prereq · {c.dependent_count} dependent</small>
              </div>
              <div className="list-actions">
                <button type="button" className="btn ghost sm" onClick={() => startEdit(c)} disabled={busy}>Edit</button>
                <button type="button" className="btn danger sm" onClick={() => onDelete(c)} disabled={busy}>Delete</button>
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="empty">No matches.</li>}
        </ul>
      )}
    </section>
  );
}
