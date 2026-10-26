import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { codingApi, userApi, contestApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Empty, Loader, Modal, Pagination } from '../components/ui';
import { VERDICT_ICON, timeAgo } from '../utils/format';
import AiScoreBadge from '../components/AiScoreBadge';

/** Submission explorer with filters, verdict viewer and source-code inspection. */
export default function SubmissionsManager({ scope = 'admin' }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [problems, setProblems] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ page: 1, status: '', language: '', problem_id: '', user_id: '', contest_id: '' });
  const [view, setView] = useState(null);
  const [detail, setDetail] = useState(null);
  const [contests, setContests] = useState([]);

  const load = async () => {
    try { const { data } = await codingApi.submissions({ ...filters, limit: 15 }); setRows(data.data); setMeta(data.meta); }
    catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable eslint-disable-next-line */ }, [JSON.stringify(filters)]);
  useEffect(() => {
    codingApi.problems({ limit: 100 }).then(({ data }) => setProblems(data.data)).catch(() => {});
    userApi.list({ limit: 100 }).then(({ data }) => setUsers(data.data)).catch(() => {});
    contestApi.list().then(({ data }) => setContests(data.data)).catch(() => {});
  }, []);

  const open = async (s) => {
    setView(s); setDetail(null);
    try { const { data } = await codingApi.submission(s.id); setDetail(data.data); } catch (_) { /* keep row data */ }
  };

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Judge</span><h2>Submissions</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Every judged run with verdict, per-test results, execution time and memory.</p></div>
        <button className="btn btn-ghost" onClick={load}>🔄 Refresh</button>
      </div>

      <div className="card mb">
        <div className="form-grid">
          <label className="field">Verdict
            <select className="select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}>
              <option value="">All verdicts</option>
              {['accepted', 'wrong_answer', 'compilation_error', 'runtime_error', 'time_limit_exceeded', 'memory_limit_exceeded', 'internal_error'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label className="field">Language
            <select className="select" value={filters.language} onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value, page: 1 }))}>
              <option value="">All languages</option>
              {['c', 'cpp', 'java', 'python', 'javascript', 'sql'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">Problem
            <select className="select" value={filters.problem_id} onChange={(e) => setFilters((f) => ({ ...f, problem_id: e.target.value, page: 1 }))}>
              <option value="">All problems</option>
              {problems.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.title}</option>)}
            </select>
          </label>
          <label className="field">Student
            <select className="select" value={filters.user_id} onChange={(e) => setFilters((f) => ({ ...f, user_id: e.target.value, page: 1 }))}>
              <option value="">All students</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </label>
          <label className="field">Contest
            <select className="select" value={filters.contest_id} onChange={(e) => setFilters((f) => ({ ...f, contest_id: e.target.value, page: 1 }))}>
              <option value="">All contests</option>
              {contests.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        </div>
      </div>

      {!rows && <Loader label="Loading submissions…" />}
      {rows && rows.length === 0 && <Empty title="No submissions match these filters" />}

      {rows && rows.length > 0 && (
        <>
          <div className="table-wrap scroll-x">
            <table className="table">
              <thead><tr><th>#</th><th>Student</th><th>Problem</th><th>Verdict</th><th title="Built-in AI text classifier (GPTZero-style heuristics)">🤖 AI Score</th><th>Tests</th><th>Time</th><th>Memory</th><th>Lang</th><th>Points</th><th>When</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="small muted">{s.id}</td>
                    <td><div style={{ fontWeight: 600 }}>{s.full_name}</div><div className="tiny muted">{s.college || '—'}</div></td>
                    <td><Link className="link" to={`/coding/${s.problem_id}`}>{s.problem_title}</Link></td>
                    <td>
                      <span className={`badge ${s.status === 'accepted' ? 'green' : s.status === 'wrong_answer' ? 'red' : 'amber'}`}>
                        {VERDICT_ICON[s.status] || ''} {s.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td><AiScoreBadge row={s} compact /></td>
                    <td className="small">{s.test_cases_passed}/{s.total_test_cases}</td>
                    <td className="small">{Number(s.execution_time).toFixed(3)} s</td>
                    <td className="small">{Number(s.memory_used).toFixed(1)} MB</td>
                    <td><span className="tag">{s.language}</span></td>
                    <td>{s.score}</td>
                    <td className="tiny muted">{timeAgo(s.submitted_at)}</td>
                    <td><button className="btn btn-sm btn-ghost" onClick={() => open(s)}>👁 View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={meta} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}

      <Modal open={!!view} title={`Submission #${view ? view.id : ''}`} onClose={() => { setView(null); setDetail(null); }} wide>
        {view && (
          <>
            <div className="row wrap mb" style={{ gap: 10 }}>
              <span className={`badge ${view.status === 'accepted' ? 'green' : 'red'}`}>{view.status.replace(/_/g, ' ')}</span>
              <span className="tag">{view.language}</span>
              <span className="tag">{view.test_cases_passed}/{view.total_test_cases} tests</span>
              <span className="tag">{Number(view.execution_time).toFixed(3)} s</span>
              <span className="tag">{Number(view.memory_used).toFixed(1)} MB</span>
              <span className="tag">{view.score} points</span>
            </div>
            <h4>Source code</h4>
            {detail && detail.source_code
              ? <pre className="code-block" style={{ maxHeight: 340, overflow: 'auto' }}>{detail.source_code}</pre>
              : <span className="tiny muted">Loading source…</span>}
            {detail && detail.ai_score != null && (
              <div className="mt-s">
                <AiScoreBadge row={detail} compact={false} />
                {Number(detail.pasted_chars || 0) + Number(detail.typed_chars || 0) + Number(detail.blocked_pastes || 0) > 0 && (
                  <div className="tiny muted mt-s">
                    📊 {Number(detail.typed_chars || 0)} chars typed · {Number(detail.pasted_chars || 0)} pasted
                    {Number(detail.blocked_pastes || 0) > 0 && <> · <strong>{detail.blocked_pastes} paste attempt{Number(detail.blocked_pastes) === 1 ? '' : 's'} blocked</strong></>}
                    {Number(detail.typing_ms || 0) > 0 && <> · {Math.round(Number(detail.typing_ms) / 1000)}s active typing</>}
                  </div>
                )}
              </div>
            )}
            {detail && detail.compile_output && (<><h4 className="mt">Compiler output</h4><pre className="code-block err">{detail.compile_output}</pre></>)}
            {detail && detail.stderr && (<><h4 className="mt">stderr</h4><pre className="code-block err">{detail.stderr}</pre></>)}
            {detail && detail.test_results && (
              <>
                <h4 className="mt">Per-test results</h4>
                <div className="stack" style={{ gap: 6 }}>
                  {detail.test_results.map((t, i) => (
                    <div className="between panel" key={i}>
                      <span className="small">Test {i + 1} {t.hidden ? <span className="tag">hidden</span> : <span className="tag">public</span>}</span>
                      <span className={`badge ${t.passed ? 'green' : 'red'}`}>{t.passed ? 'passed' : 'failed'}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {detail && detail.stdout && (<><h4 className="mt">stdout</h4><pre className="code-block">{String(detail.stdout).slice(0, 2000)}</pre></>)}
          </>
        )}
      </Modal>
    </div>
  );
}
