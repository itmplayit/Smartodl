import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { codingApi, miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, DiffBadge, Empty, Loader, Modal, StatusBadge } from '../components/ui';
import JsonImportPrompt from '../components/JsonImportPrompt';
import { DIFFICULTIES, STARTER } from '../utils/constants';
import { toList } from '../utils/format';
import { downloadJson, readJsonFile, safeJsonFilename, transferCount } from '../utils/jsonTransfer';

const EMPTY = {
  title: '', description: '', input_format: 'A single integer n', output_format: 'A single integer — the answer', constraints: '', difficulty: 'easy',
  category_id: '', points: 10, time_limit_ms: 2000, memory_limit_kb: 262144, tags: '', hints: '', status: 'draft', time_limit_minutes: '',
};

const EMPTY_TEST = { input: '', expected_output: '', is_hidden: 0, points: 2, position: 1 };

/** Coding problem manager with inline test-case CRUD (public + hidden). */
export default function ProblemsManager({ scope = 'admin' }) {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [cats, setCats] = useState([]);
  const [filters, setFilters] = useState({ search: '', difficulty: '', status: '', page: 1, creator_role: '' });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [tcFor, setTcFor] = useState(null);
  const [tests, setTests] = useState(null);
  const [testForm, setTestForm] = useState(EMPTY_TEST);
  const [transferBusy, setTransferBusy] = useState(false);
  const importInputRef = useRef(null);
  const base = scope === 'admin' ? '/admin' : '/developer';

  const load = async () => {
    try { const { data } = await codingApi.problems({ ...filters, limit: 10, ...(scope === 'developer' ? { mine: 1 } : {}) }); setRows(data.data); setMeta(data.meta); }
    catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [JSON.stringify(filters)]);
  useEffect(() => { miscApi.categories().then(({ data }) => setCats(data.data)).catch(() => {}); }, []);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, starter_code: {} }); setOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ ...EMPTY, ...p }); setOpen(true); };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        category_id: form.category_id || null,
        points: Number(form.points),
        time_limit_ms: Number(form.time_limit_ms),
        memory_limit_kb: Number(form.memory_limit_kb),
        time_limit_minutes: form.time_limit_minutes ? Number(form.time_limit_minutes) : null,
      };
      if (editing) await codingApi.updateProblem(editing.id, payload);
      else await codingApi.createProblem(payload);
      toast.success(editing ? 'Problem updated' : 'Problem created — now add test cases');
      setOpen(false); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete problem “${p.title}” (with its test cases)?`)) return;
    try { await codingApi.removeProblem(p.id); toast.success('Problem deleted'); load(); } catch (e) { toast.error(e.message); }
  };

  const publish = async (p) => {
    try { await codingApi.updateProblem(p.id, { status: p.status === 'published' ? 'draft' : 'published' }); toast.success('Updated'); load(); }
    catch (e) { toast.error(e.message); }
  };

  const togglePremium = async (p) => {
    try {
      await codingApi.updateProblem(p.id, { is_premium: Number(p.is_premium) ? 0 : 1 });
      toast.success(Number(p.is_premium) ? '⭐ Premium removed' : '⭐ Marked as PREMIUM — only subscribed students can solve it');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const openTests = async (p) => {
    setTcFor(p); setTests(null);
    try { const { data } = await codingApi.testCases(p.id, true); setTests(data.data); } catch (e) { toast.error(e.message); setTests([]); }
  };

  const addTest = async (e) => {
    e.preventDefault();
    try {
      await codingApi.addTestCase(tcFor.id, { ...testForm, position: (tests?.length || 0) + 1 });
      toast.success('Test case added');
      setTestForm(EMPTY_TEST);
      openTests(tcFor);
    } catch (err) { toast.error(err.message); }
  };

  const removeTest = async (t) => {
    if (!window.confirm('Delete this test case?')) return;
    try { await codingApi.removeTestCase(t.id); toast.success('Deleted'); openTests(tcFor); } catch (e) { toast.error(e.message); }
  };

  const toggleHidden = async (t) => {
    try { await codingApi.updateTestCase(t.id, { is_hidden: t.is_hidden ? 0 : 1 }); openTests(tcFor); } catch (e) { toast.error(e.message); }
  };

  const exportOne = async (problem) => {
    setTransferBusy(true);
    try {
      const { data } = await codingApi.exportProblem(problem.id);
      downloadJson(data.data, `${safeJsonFilename(problem.title, 'coding-problem')}.json`);
      toast.success('Problem and test cases exported');
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  const exportAll = async () => {
    setTransferBusy(true);
    try {
      const { data } = await codingApi.exportProblems();
      downloadJson(data.data, `smartodl-coding-problems-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success(`${transferCount(data.data)} problem(s) exported with test cases`);
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTransferBusy(true);
    try {
      const pack = await readJsonFile(file, 'coding-problems');
      if (!window.confirm(`Import ${transferCount(pack)} coding problem(s) as new drafts? Existing problems will not be overwritten.`)) return;
      const { data } = await codingApi.importProblems(pack);
      toast.success(`${data.data.imported_count} problem(s) imported as drafts`);
      await load();
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  const setStarter = (lang, value) => setForm((f) => ({ ...f, starter_code: { ...(f.starter_code || {}), [lang]: value } }));

  const base2 = scope === 'admin' ? '/admin' : '/developer';

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Coding arena</span><h2>Coding problems & test cases</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Each problem carries public examples plus hidden tests that decide the verdict.</p></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
          <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={() => importInputRef.current?.click()}>⬆ Import Coding JSON</button>
          <JsonImportPrompt defaultPrompt="coding" />
          <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={exportAll}>⬇ Export all JSON</button>
          <Link className="btn btn-ghost" to={`${base2}/test-cases`}>🧪 Test case overview</Link>
          <button className="btn btn-primary" onClick={openCreate}>➕ New problem</button>
        </div>
      </div>

      <div className="card mb">
        <div className="form-grid">
          <label className="field full">Search
            <input className="input" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))} placeholder="Problem title…" />
          </label>
          <label className="field">Difficulty
            <select className="select" value={filters.difficulty} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value, page: 1 }))}>
              <option value="">Any</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="field">Status
            <select className="select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}>
              <option value="">All</option>
              {['draft', 'published'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      {scope === 'admin' && (
        <div className="row wrap mb" style={{ gap: 8, marginTop: -6 }}>
          <span className="tiny muted" style={{ alignSelf: 'center' }}>Creator filter:</span>
          {[['', '📂 All'], ['developer', '👨‍💻 Developers'], ['admin', '🛡 Admins']].map(([v, label]) => (
            <button key={v} className={filters.creator_role === v ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => setFilters((f) => ({ ...f, creator_role: v, page: 1 }))}>{label}</button>
          ))}
        </div>
      )}
      {scope === 'developer' && (
        <div className="tiny muted mb" style={{ marginTop: -6 }}>👤 Only content created by you is shown here — administrator content is not displayed in the developer panel.</div>
      )}
      {!rows && <Loader label="Loading problems…" />}
      {rows && rows.length === 0 && <Empty title="No problems yet" hint="Create your first coding problem." />}

      {rows && rows.length > 0 && (
        <div className="table-wrap scroll-x">
          <table className="table">
            <thead><tr><th>Problem</th><th>Category</th><th>Difficulty</th><th>Points</th><th>Tests</th><th>Subs</th><th>Accuracy</th><th>Status</th><th style={{ width: 330 }}>Actions</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td style={{ minWidth: 200 }}><strong>{p.title}</strong><div className="tiny muted">{toList(p.tags).join(', ').slice(0, 40)}</div>{scope === 'admin' && <div className="tiny muted">by {(p.created_by_role === 'developer' ? '👨‍💻 ' : '🛡 ') + (p.created_by_name || '—')}</div>}</td>
                  <td className="small">{p.category_name || '—'}</td>
                  <td><DiffBadge value={p.difficulty} /></td>
                  <td>{p.points}</td>
                  <td className="small">{p.test_cases_count} <span className="muted">({p.hidden_test_cases_count} hidden)</span></td>
                  <td>{p.total_submissions}</td>
                  <td className="small">{Number(p.acceptance_rate).toFixed(1)}%</td>
                  <td><StatusBadge value={p.status} /></td>
                  <td>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => openTests(p)}>🧪 Tests</button>
                      <Link className="btn btn-sm btn-ghost" to={`/coding/${p.id}`}>👁</Link>
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(p)}>✏️</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => publish(p)}>{p.status === 'published' ? '🙈' : '🚀'}</button>
                      {scope === 'admin' && (
                        <button className="btn btn-sm btn-ghost" title="Premium toggle (administrators only)" onClick={() => togglePremium(p)}>
                          {Number(p.is_premium) ? '⭐' : '☆'}
                        </button>
                      )}
                      <button className="btn btn-sm btn-ghost" disabled={transferBusy} onClick={() => exportOne(p)} title="Export problem and test cases as JSON">⬇ JSON</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(p)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(meta && meta.pages > 1) && (
        <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" disabled={meta.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Prev</button>
          <span className="tiny muted">Page {meta.page} / {meta.pages}</span>
          <button className="btn btn-sm btn-ghost" disabled={meta.page >= meta.pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next →</button>
        </div>
      )}

      {/* ---------------------------- problem modal ---------------------------- */}
      <Modal open={open} title={editing ? `Edit problem: ${editing.title}` : 'New coding problem'} onClose={() => setOpen(false)} wide>
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field full">Title *
              <input className="input" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </label>
            <label className="field full">Problem statement *
              <textarea className="textarea" rows="5" required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </label>
            <label className="field">Input format
              <textarea className="textarea" rows="2" value={form.input_format} onChange={(e) => setForm((f) => ({ ...f, input_format: e.target.value }))} />
            </label>
            <label className="field">Output format
              <textarea className="textarea" rows="2" value={form.output_format} onChange={(e) => setForm((f) => ({ ...f, output_format: e.target.value }))} />
            </label>
            <label className="field">Constraints
              <textarea className="textarea code" rows="3" value={form.constraints} onChange={(e) => setForm((f) => ({ ...f, constraints: e.target.value }))} placeholder="1 <= n <= 10^5" />
            </label>
            <label className="field">Hints
              <textarea className="textarea" rows="3" value={form.hints} onChange={(e) => setForm((f) => ({ ...f, hints: e.target.value }))} />
            </label>
            <label className="field">Category
              <select className="select" value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                <option value="">— none —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field">Difficulty
              <select className="select" value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="field">Points
              <input className="input" type="number" min="1" value={form.points} onChange={(e) => setForm((f) => ({ ...f, points: e.target.value }))} />
            </label>
            <label className="field">Status
              <select className="select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {['draft', 'published'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">⏱ Solve timer (minutes — 0 = no timer)
              <input className="input" type="number" min="0" value={form.time_limit_minutes ?? ''} onChange={(e) => setForm((f) => ({ ...f, time_limit_minutes: e.target.value }))} />
            </label>
            <label className="field">Time limit (ms)
              <input className="input" type="number" min="100" step="100" value={form.time_limit_ms} onChange={(e) => setForm((f) => ({ ...f, time_limit_ms: e.target.value }))} />
            </label>
            <label className="field">Memory limit (KB)
              <input className="input" type="number" min="16384" step="1024" value={form.memory_limit_kb} onChange={(e) => setForm((f) => ({ ...f, memory_limit_kb: e.target.value }))} />
            </label>
            <label className="field full">Tags (comma separated)
              <input className="input" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="arrays, hashmap, interview" />
            </label>
          </div>

          <h4 className="mt">Starter code per language</h4>
          <div className="form-grid">
            {Object.keys(STARTER).map((lang) => (
              <label className="field" key={lang}>
                {lang}
                <textarea className="textarea code" rows="3"
                  value={(form.starter_code && form.starter_code[lang]) || ''}
                  onChange={(e) => setStarter(lang, e.target.value)} />
              </label>
            ))}
          </div>

          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save problem' : 'Create problem'}</button>
          </div>
        </form>
      </Modal>

      {/* --------------------------- test case modal --------------------------- */}
      <Modal open={!!tcFor} title={`Test cases — ${tcFor ? tcFor.title : ''}`} onClose={() => setTcFor(null)} wide>
        {!tests && <Loader label="Loading test cases…" />}
        {tests && (
          <>
            <div className="row wrap mb-s" style={{ gap: 8 }}>
              <Badge tone="cyan">{tests.filter((t) => !t.is_hidden).length} public</Badge>
              <Badge tone="violet">{tests.filter((t) => t.is_hidden).length} hidden</Badge>
              <span className="tiny muted">Hidden cases are never sent to students — only pass/fail is reported.</span>
              <button className="btn btn-sm btn-ghost" type="button" disabled={transferBusy} onClick={() => exportOne(tcFor)}>⬇ Export JSON</button>
            </div>
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>#</th><th>Input</th><th>Expected output</th><th>Points</th><th>Visibility</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id}>
                      <td>{t.position}</td>
                      <td><pre className="code-block" style={{ margin: 0, maxWidth: 240 }}>{String(t.input || '').slice(0, 120) || '(empty)'}</pre></td>
                      <td><pre className="code-block" style={{ margin: 0, maxWidth: 240 }}>{String(t.expected_output || '').slice(0, 120)}</pre></td>
                      <td>{t.points}</td>
                      <td>{t.is_hidden ? <span className="badge violet">🔒 hidden</span> : <span className="badge cyan">public</span>}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => toggleHidden(t)}>{t.is_hidden ? '🔓' : '🔒'}</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => removeTest(t)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {tests.length === 0 && <tr><td colSpan="6"><span className="muted small">No test cases yet.</span></td></tr>}
                </tbody>
              </table>
            </div>

            <form className="card mt" onSubmit={addTest}>
              <h4>Add test case</h4>
              <div className="form-grid">
                <label className="field">Input
                  <textarea className="textarea code" rows="3" value={testForm.input} onChange={(e) => setTestForm((f) => ({ ...f, input: e.target.value }))} placeholder="5" />
                </label>
                <label className="field">Expected output
                  <textarea className="textarea code" rows="3" required value={testForm.expected_output} onChange={(e) => setTestForm((f) => ({ ...f, expected_output: e.target.value }))} placeholder="120" />
                </label>
                <label className="field">Points
                  <input className="input" type="number" min="1" value={testForm.points} onChange={(e) => setTestForm((f) => ({ ...f, points: Number(e.target.value) }))} />
                </label>
                <label className="field row" style={{ gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={Number(testForm.is_hidden) === 1} onChange={(e) => setTestForm((f) => ({ ...f, is_hidden: e.target.checked ? 1 : 0 }))} />
                  Hidden test case
                </label>
              </div>
              <button className="btn btn-primary mt">➕ Add test case</button>
            </form>
          </>
        )}
      </Modal>
    </div>
  );
}
