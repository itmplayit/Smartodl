import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { codingApi, miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { DiffBadge, Empty, ErrorBox, Loader, Pagination } from '../components/ui';
import { fmtNum, toList } from '../utils/format';
import { DIFFICULTIES } from '../utils/constants';

export default function CodingArena() {
  const { user } = useAuth();
  const [problems, setProblems] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [langs, setLangs] = useState([]);
  const [cats, setCats] = useState([]);
  const [mine, setMine] = useState(null);
  const [filters, setFilters] = useState({ search: '', difficulty: '', category_id: '', sort: 'created_at', page: 1, limit: 10 });

  const load = async () => {
    setProblems(null); setError('');
    try { const { data } = await codingApi.problems(filters); setProblems(data.data); setMeta(data.meta); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => {
    codingApi.languages().then(({ data }) => setLangs(data.data)).catch(() => {});
    miscApi.categories().then(({ data }) => setCats(data.data.filter((c) => ['coding', 'all', 'dsa'].includes(c.type)))).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) return;
    codingApi.mySubmissions({ limit: 8 }).then(({ data }) => setMine(data.data)).catch(() => {});
  }, [user]);

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Coding Arena</span><h1>Solve problems, earn points</h1>
          <p className="muted small">Write, run and submit code in C, C++, Java, Python, JavaScript or SQL. Every submission is executed in an isolated sandbox.</p></div>
        <div className="row wrap" style={{ gap: 8 }}>
          {langs.map((l) => <span className="tag" key={l.id}>{l.name}</span>)}
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <div className="card mb">
            <div className="form-grid">
              <label className="field full">🔎 Search problems
                <input className="input" placeholder="Two sum, palindrome, SQL joins…" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
              </label>
              <label className="field">Difficulty
                <select className="select" value={filters.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
                  <option value="">Any difficulty</option>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="field">Category
                <select className="select" value={filters.category_id} onChange={(e) => set({ category_id: e.target.value })}>
                  <option value="">All categories</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="field">Sort by
                <select className="select" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
                  <option value="created_at">Newest</option>
                  <option value="total_submissions">Most attempted</option>
                  <option value="acceptance_rate">Highest acceptance</option>
                  <option value="points">Most points</option>
                </select>
              </label>
            </div>
          </div>

          {error && <ErrorBox error={error} onRetry={load} />}
          {!problems && !error && <Loader label="Loading problems…" />}
          {problems && problems.length === 0 && <Empty title="No problems matched" hint="Try another category or difficulty." />}
          {problems && (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr><th>Status</th><th>Problem</th><th>Category</th><th>Difficulty</th><th>Points</th><th>Accuracy</th><th>Subs</th><th><span className="sr-only">Action</span></th></tr>
                </thead>
                <tbody>
                  {problems.map((p) => (
                    <tr key={p.id}>
                      <td>{p.solved ? <span className="badge green">✓ Solved</span> : <span className="tiny muted">—</span>}</td>
                      <td>
                        <Link className="link" to={`/coding/${p.id}`} style={{ fontWeight: 600 }}>{p.title}</Link>
                        {!!Number(p.is_premium) && <span className="badge amber" style={{ marginLeft: 6 }}>⭐ Premium</span>}
                        <div className="tiny muted">{toList(p.tags).slice(0, 3).map((t) => `#${t}`).join(' ')}</div>
                      </td>
                      <td className="small">{p.category_name || '—'}</td>
                      <td><DiffBadge value={p.difficulty} /></td>
                      <td>{p.points}</td>
                      <td className="small">{Number(p.acceptance_rate).toFixed(1)}%</td>
                      <td className="small">{p.total_submissions}</td>
                      <td><Link className="btn btn-sm btn-primary" to={`/coding/${p.id}`}>Solve</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {meta && <Pagination meta={meta} onPage={(page) => setFilters((f) => ({ ...f, page }))} />}
        </div>

        <div className="stack">
          <div className="card">
            <h2 style={{ fontSize: '1rem' }}>🏁 Arena summary</h2>
            <div className="stack" style={{ gap: 8 }}>
              <div className="between small"><span>Total problems</span><strong>{meta?.total ?? '—'}</strong></div>
              <div className="between small"><span>Languages</span><strong>{langs.length}</strong></div>
              <div className="between small"><span>Your points</span><strong>{fmtNum(user?.points || 0)}</strong></div>
            </div>
            <div className="divider" />
            <div className="tiny muted">Every accepted submission awards the problem's full points and counts toward the leaderboard and badges.</div>
          </div>

          {user && (
            <div className="card">
              <div className="between mb-s"><h3 style={{ fontSize: '1rem' }}>Your recent submissions</h3>
                <Link className="tiny link" to="/student">All →</Link></div>
              <div className="list-tight">
                {(mine || []).map((s) => (
                  <div key={s.id} className="between">
                    <div style={{ minWidth: 0 }}>
                      <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.problem_title || `Problem #${s.problem_id}`}</div>
                      <div className="tiny muted">{s.language} • {s.test_cases_passed}/{s.total_test_cases} tests</div>
                    </div>
                    <span className={`badge ${s.status === 'accepted' ? 'green' : s.status === 'wrong_answer' ? 'red' : 'amber'}`}>
                      {s.status === 'accepted' ? 'Accepted' : s.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
                {(!mine || mine.length === 0) && <div className="tiny muted">No submissions yet — pick a problem and hit Run.</div>}
              </div>
            </div>
          )}

          <div className="soft small">🧪 <strong>Practice tips:</strong> read the constraints first, test with the public examples, then Submit to run the hidden test set.</div>
        </div>
      </div>
    </div>
  );
}
