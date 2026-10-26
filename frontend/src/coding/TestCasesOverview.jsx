import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { codingApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Badge, Empty, Loader, Modal } from '../components/ui';
import JsonImportPrompt from '../components/JsonImportPrompt';
import { downloadJson, readJsonFile, safeJsonFilename, transferCount } from '../utils/jsonTransfer';

/** Dedicated test-case workbench: pick a problem and manage its hidden/public cases. */
export default function TestCasesOverview({ scope = 'admin' }) {
  const toast = useToast();
  const [problems, setProblems] = useState(null);
  const [problem, setProblem] = useState(null);
  const [tests, setTests] = useState(null);
  const [form, setForm] = useState({ input: '', expected_output: '', is_hidden: 0, points: 2 });
  const [busy, setBusy] = useState(false);
  const [runInput, setRunInput] = useState('');
  const [runOpen, setRunOpen] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const importInputRef = useRef(null);
  const base = scope === 'admin' ? '/admin' : '/developer';

  useEffect(() => {
    codingApi.problems({ limit: 100 }).then(({ data }) => {
      setProblems(data.data);
      if (data.data[0]) setProblem(data.data[0]);
    }).catch((e) => { toast.error(e.message); setProblems([]); });
  }, []);

  const loadTests = async () => {
    if (!problem) return;
    setTests(null);
    try { const { data } = await codingApi.testCases(problem.id, true); setTests(data.data); }
    catch (e) { toast.error(e.message); setTests([]); }
  };
  useEffect(() => { loadTests(); /* eslint-disable-next-line */ }, [problem && problem.id]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await codingApi.addTestCase(problem.id, { ...form, position: (tests?.length || 0) + 1 });
      toast.success('Test case added');
      setForm({ input: '', expected_output: '', is_hidden: 0, points: 2 });
      loadTests();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const toggle = async (t) => {
    try { await codingApi.updateTestCase(t.id, { is_hidden: t.is_hidden ? 0 : 1 }); loadTests(); } catch (e) { toast.error(e.message); }
  };

  const remove = async (t) => {
    if (!window.confirm('Delete this test case?')) return;
    try { await codingApi.removeTestCase(t.id); toast.success('Deleted'); loadTests(); } catch (e) { toast.error(e.message); }
  };

  const runSample = async () => {
    try {
      const src = (problem.starter_code && problem.starter_code.python) || '# provide an implementation\n';
      const { data } = await codingApi.run({ language: 'python', source_code: src, stdin: runInput, problem_id: problem.id });
      const st = data.data.status;
      toast.info(`Judge says: ${typeof st === 'string' ? st.replace(/_/g, ' ') : (st && st.description) || 'done'}`);
    } catch (e) { toast.error(e.message); }
  };

  const exportJson = async (target) => {
    setTransferBusy(true);
    try {
      const { data } = target ? await codingApi.exportProblem(target.id) : await codingApi.exportProblems();
      downloadJson(data.data, target
        ? `${safeJsonFilename(target.title, 'coding-problem')}.json`
        : `smartodl-coding-problems-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success(`${target ? 1 : transferCount(data.data)} problem package(s) exported`);
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTransferBusy(true);
    try {
      const pack = await readJsonFile(file, 'coding-problems');
      if (!window.confirm(`Import ${transferCount(pack)} problem(s) with test cases as new drafts?`)) return;
      const { data } = await codingApi.importProblems(pack);
      toast.success(`${data.data.imported_count} problem(s) imported as drafts`);
      const refreshed = await codingApi.problems({ limit: 100 });
      setProblems(refreshed.data.data);
      if (refreshed.data.data[0]) setProblem(refreshed.data.data[0]);
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  if (!problems) return <Loader label="Loading problems…" />;

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Judge</span><h2>Test case workbench</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Hidden cases decide the verdict and are never exposed to students.</p></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
          <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={() => importInputRef.current?.click()}>⬆ Import Coding JSON</button>
          <JsonImportPrompt defaultPrompt="coding" />
          <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={() => exportJson(null)}>⬇ Export all JSON</button>
          <Link className="btn btn-ghost" to={`${base}/problems`}>💻 Problem management</Link>
        </div>
      </div>

      {problems.length === 0 && <Empty title="No problems yet" hint="Create a problem first." />}

      {problems.length > 0 && (
        <>
          <div className="card mb">
            <label className="field" style={{ maxWidth: 520 }}>Problem
              <select className="select" value={problem ? problem.id : ''} onChange={(e) => setProblem(problems.find((p) => String(p.id) === e.target.value))}>
                {problems.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.title} ({p.test_cases_count} tests)</option>)}
              </select>
            </label>
            {problem && (
              <div className="between wrap mt-s">
                <div className="row wrap" style={{ gap: 10 }}>
                  <Badge tone="cyan">{problem.test_cases_count} total</Badge>
                  <Badge tone="violet">{problem.hidden_test_cases_count} hidden</Badge>
                  <span className="tag">⏱ {problem.time_limit_ms} ms</span>
                  <span className="tag">💾 {(problem.memory_limit_kb / 1024).toFixed(0)} MB</span>
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btn btn-sm btn-ghost" type="button" disabled={transferBusy} onClick={() => exportJson(problem)}>⬇ Export JSON</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => { setRunInput(''); setRunOpen(true); }}>▶ Try judge</button>
                  <Link className="btn btn-sm btn-ghost" to={`/coding/${problem.id}`}>👁 Open problem</Link>
                </div>
              </div>
            )}
          </div>

          {!tests && <Loader label="Loading test cases…" />}
          {tests && tests.length === 0 && <Empty title="No test cases for this problem" hint="Add at least one public example and several hidden cases." />}

          {tests && tests.length > 0 && (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>#</th><th>Visibility</th><th>Input</th><th>Expected output</th><th>Points</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id}>
                      <td>{t.position}</td>
                      <td>{t.is_hidden ? <Badge tone="violet">🔒 hidden</Badge> : <Badge tone="cyan">public</Badge>}</td>
                      <td><pre className="code-block" style={{ margin: 0, maxWidth: 260 }}>{String(t.input || '').slice(0, 200) || '(no input)'}</pre></td>
                      <td><pre className="code-block" style={{ margin: 0, maxWidth: 260 }}>{String(t.expected_output || '').slice(0, 200)}</pre></td>
                      <td>{t.points}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => toggle(t)}>{t.is_hidden ? '🔓 Make public' : '🔒 Hide'}</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => remove(t)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {problem && (
            <form className="card mt" onSubmit={add}>
              <h3>Add test case to #{problem.id}</h3>
              <div className="form-grid">
                <label className="field">Input (stdin)
                  <textarea className="textarea code" rows="4" value={form.input} onChange={(e) => setForm((f) => ({ ...f, input: e.target.value }))} placeholder="5&#10;1 2 3 4 5" />
                </label>
                <label className="field">Expected output *
                  <textarea className="textarea code" rows="4" required value={form.expected_output} onChange={(e) => setForm((f) => ({ ...f, expected_output: e.target.value }))} />
                </label>
                <label className="field">Points
                  <input className="input" type="number" min="1" value={form.points} onChange={(e) => setForm((f) => ({ ...f, points: Number(e.target.value) }))} />
                </label>
                <label className="field row" style={{ gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={Number(form.is_hidden) === 1} onChange={(e) => setForm((f) => ({ ...f, is_hidden: e.target.checked ? 1 : 0 }))} />
                  Hidden from students
                </label>
              </div>
              <button className="btn btn-primary mt" disabled={busy}>{busy ? 'Adding…' : '➕ Add test case'}</button>
            </form>
          )}
        </>
      )}

      <Modal open={runOpen} title="Run against the sandbox judge" onClose={() => setRunOpen(false)}>
        <p className="small muted">The starter template for this problem will be executed with your custom stdin to sanity-check the judge path.</p>
        <label className="field">Custom stdin
          <textarea className="textarea code" rows="5" value={runInput} onChange={(e) => setRunInput(e.target.value)} />
        </label>
        <div className="row mt" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setRunOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { setRunOpen(false); runSample(); }}>▶ Run</button>
        </div>
      </Modal>
    </div>
  );
}
