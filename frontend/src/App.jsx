import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_ROOT, api } from './api';
import AnalysisPanel from './components/AnalysisPanel';
import ConfirmDialog from './components/ConfirmDialog';
import CoursePanel from './components/CoursePanel';
import CustomAnalysis from './components/CustomAnalysis';
import GraphView from './components/GraphView';
import Overview from './components/Overview';
import PrereqPanel from './components/PrereqPanel';

const EMPTY = { courses: [], prereqs: [], graph: { nodes: [], edges: [] }, analysis: null };

const VIEWS = {
  overview: { label: 'Overview', sub: 'Plan health at a glance', icon: 'M4 13h6V4H4zm10 7h6V4h-6zM4 20h6v-4H4z' },
  courses: { label: 'Courses', sub: 'Manage courses and prerequisite relationships', icon: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zm0 13a3 3 0 0 1 3-3h11' },
  graph: { label: 'Dependency Graph', sub: 'Directed graph: prerequisite → dependent', icon: 'M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7.5 7.5 11 16M16.5 7.5 13 16M8 6h8' },
  analysis: { label: 'Analysis', sub: "Kahn's algorithm, DFS cycle detection and what-if testing", icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
};

const store = {
  get: (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export default function App() {
  const [health, setHealth] = useState(null);
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [view, setViewState] = useState(() => (VIEWS[store.get('pp-view')] ? store.get('pp-view') : 'overview'));
  const [theme, setTheme] = useState(() => (store.get('pp-theme') === 'light' ? 'light' : 'dark'));

  useEffect(() => { document.documentElement.dataset.theme = theme; store.set('pp-theme', theme); }, [theme]);
  const setView = (v) => { setViewState(v); store.set('pp-view', v); };

  const notify = (msg, kind = 'ok') => setToast({ msg, kind, id: Date.now() });
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const confirm = (opts) => new Promise((resolve) => setDialog({ ...opts, resolve }));
  const closeDialog = (ok) => { dialog?.resolve(ok); setDialog(null); };

  const refresh = useCallback(async () => {
    setLoadError('');
    try {
      const h = await api.health();
      setHealth(h);
      if (h.database !== 'connected') { setData(EMPTY); return; }
      const [courses, prereqs, graph, analysis] = await Promise.all([
        api.listCourses(), api.listPrereqs(), api.graph(), api.analysis(),
      ]);
      setData({ courses, prereqs, graph, analysis });
    } catch (e) {
      setLoadError(e.message);
      if (e.status === 0) setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Runs a mutation, reports the outcome, then reloads everything from the backend.
  const mutate = async (fn, success) => {
    setBusy(true);
    try {
      const result = await fn();
      if (success) notify(typeof success === 'function' ? success(result) : success);
      await refresh();
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const names = useMemo(() => Object.fromEntries(data.courses.map((c) => [c.code, c.name])), [data.courses]);
  const sampleCount = data.courses.filter((c) => c.is_sample).length;

  const saveCourse = (id, body) => mutate(
    () => (id ? api.updateCourse(id, body) : api.createCourse(body)),
    `Course ${body.code} ${id ? 'updated' : 'added'}`,
  );

  const deleteCourse = async (c) => {
    const links = c.prerequisite_count + c.dependent_count;
    const ok = await confirm({
      title: `Delete ${c.code}?`,
      danger: true,
      confirmLabel: links ? `Delete course and ${links} relationship(s)` : 'Delete course',
      message: links
        ? <p><b>{c.code}</b> is used in <b>{links}</b> prerequisite relationship(s). Deleting it will also delete those relationships in the same transaction. This cannot be undone.</p>
        : <p>This permanently deletes <b>{c.code} — {c.name}</b>.</p>,
    });
    if (ok) await mutate(() => api.deleteCourse(c.id, links > 0), (r) => `Deleted ${r.deleted} (${r.removed_prerequisites} relationship(s) removed)`);
  };

  const savePrereq = (id, body) => mutate(
    () => (id ? api.updatePrereq(id, body) : api.createPrereq(body)),
    (r) => `${r.prerequisite_code} → ${r.dependent_code} ${id ? 'updated' : 'added'}`,
  );

  const deletePrereq = async (p) => {
    const ok = await confirm({
      title: 'Delete relationship?', danger: true, confirmLabel: 'Delete',
      message: <p>Remove the prerequisite <b>{p.prerequisite_code} → {p.dependent_code}</b>?</p>,
    });
    if (ok) await mutate(() => api.deletePrereq(p.id), 'Relationship deleted');
  };

  const loadSample = () => mutate(api.sampleLoad,
    (r) => `Demo data loaded: ${r.courses_added} course(s), ${r.prerequisites_added} link(s) added; ${r.courses_skipped} existing code(s) left untouched`);

  const resetSample = async () => {
    const ok = await confirm({
      title: 'Reset demo data?', danger: true, confirmLabel: 'Reset demo data',
      message: <p>This deletes the {sampleCount} demo course(s) and <b>every relationship touching them</b> (including ones you added), then re-creates the original demo data. Edits to demo courses are lost. Courses you created are kept.</p>,
    });
    if (ok) await mutate(api.sampleReset, 'Demo data restored');
  };

  const removeSample = async () => {
    const ok = await confirm({
      title: 'Remove demo data?', danger: true, confirmLabel: 'Remove demo data',
      message: <p>This deletes the {sampleCount} demo course(s) and every relationship touching them. Courses you created are kept.</p>,
    });
    if (ok) await mutate(api.sampleRemove, (r) => `Removed ${r.courses_removed} demo course(s) and ${r.prerequisites_removed} relationship(s)`);
  };

  const connected = health?.database === 'connected';
  const dbLabel = {
    connected: 'Connected', not_configured: 'Not configured', unreachable: 'Unreachable', schema_missing: 'Schema missing',
  }[health?.database] || 'API offline';

  const sampleActions = connected && (view === 'overview' || view === 'courses') && (
    <div className="toolbar-group" role="group" aria-label="Demo data (fictional curriculum)">
      <button type="button" className="btn ghost sm" onClick={loadSample} disabled={busy} title="Adds a fictional demo curriculum; existing courses are left untouched">Load demo data</button>
      <button type="button" className="btn ghost sm" onClick={resetSample} disabled={busy || !sampleCount}>Reset demo</button>
      <button type="button" className="btn ghost sm danger-text" onClick={removeSample} disabled={busy || !sampleCount}>Remove demo</button>
    </div>
  );

  const unavailable = loading ? (
    <div className="card center"><div className="spinner" />Loading planner…</div>
  ) : !health ? (
    <div className="banner error">
      <h3>Backend not reachable</h3>
      <p>{loadError || `No response from ${API_ROOT}.`}</p>
      <p>Start it from <code>backend/</code> with <code>.venv\Scripts\uvicorn app.main:app --reload</code>, then retry.</p>
      <button type="button" className="btn primary" onClick={refresh}>Retry</button>
    </div>
  ) : !connected ? (
    <div className="banner warn">
      <h3>Database {dbLabel.toLowerCase()}</h3>
      <p>{health.detail}</p>
      <button type="button" className="btn primary" onClick={refresh}>Check again</button>
    </div>
  ) : null;

  const saved = (
    <>
      {loadError && <div className="banner error"><p>{loadError}</p></div>}
      {view === 'overview' && (
        <Overview courses={data.courses} analysis={data.analysis} busy={busy} onNavigate={setView} onLoadSample={loadSample} />
      )}
      {view === 'courses' && (
        <div className="grid-2 align-start">
          <CoursePanel courses={data.courses} busy={busy} onSave={saveCourse} onDelete={deleteCourse} />
          <PrereqPanel courses={data.courses} prereqs={data.prereqs} busy={busy} onSave={savePrereq} onDelete={deletePrereq} />
        </div>
      )}
      {view === 'graph' && (
        <section className="card flush">
          <GraphView nodes={data.graph.nodes} edges={data.graph.edges} analysis={data.analysis} names={names}
                     height="calc(100vh - 210px)" inspector />
        </section>
      )}
      {view === 'analysis' && (
        <section className="card">
          <header className="card-head"><h2>Saved plan</h2><span className="pill ok-soft">From database</span></header>
          <AnalysisPanel analysis={data.analysis} names={names} />
        </section>
      )}
    </>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 6.8 17 11M7 17.2 17 13" />
            </svg>
          </span>
          <span className="brand-text"><b>PrereqPath</b><small>Course dependency planner</small></span>
        </div>
        <nav aria-label="Main">
          {Object.entries(VIEWS).map(([id, v]) => (
            <button key={id} type="button" className={`nav-item${view === id ? ' active' : ''}`}
                    aria-current={view === id ? 'page' : undefined} aria-label={v.label} title={v.label} onClick={() => setView(id)}>
              <Icon d={v.icon} /><span>{v.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`status ${connected ? 'ok' : 'bad'}`}>{loading ? 'Connecting…' : `Database: ${dbLabel}`}</span>
          <small>No authentication. Local use only.</small>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{VIEWS[view].label}</h1>
            <p className="muted">{VIEWS[view].sub}</p>
          </div>
          <div className="topbar-actions">
            {sampleActions}
            <button type="button" className="icon-btn" onClick={() => { setBusy(true); refresh().finally(() => setBusy(false)); }}
                    disabled={busy} aria-label="Refresh data" title="Refresh">
              <Icon d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
            </button>
            <button type="button" className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
              <Icon d={theme === 'dark' ? 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
                                          : 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'} />
            </button>
          </div>
        </header>

        <main className="content">
          {unavailable ?? saved}
          {view === 'analysis' && <CustomAnalysis courses={data.courses} prereqs={data.prereqs} />}
        </main>
      </div>

      {toast && <div key={toast.id} className={`toast ${toast.kind}`} role="status">{toast.msg}</div>}
      <ConfirmDialog dialog={dialog} onClose={closeDialog} />
    </div>
  );
}
