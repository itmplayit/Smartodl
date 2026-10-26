import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { quizApi, miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Badge, Countdown, DiffBadge, Empty, ErrorBox, Loader, Pagination, StatusBadge } from '../components/ui';
import { DIFFICULTIES } from '../utils/constants';

const TABS = [['all', 'All quizzes'], ['live', '🔴 Live now'], ['upcoming', 'Upcoming'], ['practice', 'Practice']];

export default function Quizzes() {
  const { user } = useAuth();
  const [tab, setTab] = useState('all');
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [cats, setCats] = useState([]);
  const [filters, setFilters] = useState({ search: '', difficulty: '', category_id: '', page: 1 });

  const params = () => {
    const p = { ...filters, limit: 9 };
    if (tab === 'live') p.quiz_type = 'live';
    if (tab === 'practice') p.quiz_type = 'normal';
    return p;
  };

  const load = async (silent) => {
    if (!silent) setRows(null);
    setError('');
    try { const { data } = await quizApi.list(params()); setRows(data.data); setMeta(data.meta); }
    catch (e) { if (!silent) setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters, tab]);
  useEffect(() => { miscApi.categories().then(({ data }) => setCats(data.data)).catch(() => {}); }, []);

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const list = (rows || []).filter((r) => {
    if (tab === 'live') return r.status === 'live';
    if (tab === 'upcoming') return ['published', 'scheduled'].includes(r.status) && (!r.start_at || new Date(r.start_at) > new Date());
    return true;
  });

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Assessments</span><h1>Quizzes & live tests</h1>
          <p className="muted small">MCQ, multiple-correct, true/false, short answer and coding questions — auto-graded with instant ranking.</p></div>
      </div>

      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="card mb mt">
        <div className="form-grid">
          <label className="field full">🔎 Search quizzes
            <input className="input" placeholder="Aptitude, Python basics…" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
          </label>
          <label className="field">Difficulty
            <select className="select" value={filters.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
              <option value="">Any level</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="field">Category
            <select className="select" value={filters.category_id} onChange={(e) => set({ category_id: e.target.value })}>
              <option value="">All categories</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!rows && !error && <Loader label="Loading quizzes…" />}
      {rows && list.length === 0 && <Empty title="No quizzes here yet" hint="Check the other tabs or come back later." />}
      {rows && (
        <div className="grid g3">
          {list.map((z) => {
            const attempted = z.last_attempt;
            const target = z.status === 'live' ? `/quizzes/${z.id}/live` : `/quizzes/${z.id}`;
            return (
              <div className="card hover" key={z.id}>
                <div className="between mb-s">
                  <StatusBadge value={z.status} />
                  <span className="tag">{z.quiz_type === 'live' ? '📡 live' : '📝 practice'}</span>
                </div>
                <Link to={target}><h3 style={{ fontSize: '1.05rem' }}>{z.title}</h3></Link>
                <p className="tiny muted">{(z.description || '').slice(0, 100)}</p>
                <div className="row wrap tiny muted mt-s" style={{ gap: 10 }}>
                  <span>❓ {z.question_count || z.actual_question_count} questions</span>
                  <span>🎯 {z.total_marks} marks</span>
                  <span>⏱ {z.time_limit_minutes} min</span>
                  {Number(z.negative_marking) > 0 && <span>➖ {z.negative_marking} negative</span>}
                </div>
                <div className="row mt-s" style={{ gap: 8 }}>
                  <DiffBadge value={z.difficulty} />
                  {!!Number(z.is_premium) && <span className="badge amber">⭐ Premium</span>}
                  {z.category_name && <span className="tag">{z.category_name}</span>}
                </div>
                <div className="divider" />
                {z.status === 'live' && (!z.end_at || new Date(z.end_at) > new Date()) ? (
                  <div className="between">
                    <span className="badge red">● LIVE</span>
                    <Countdown target={z.end_at} compact onEnd={() => load(true)} />
                  </div>
                ) : z.status === 'live' ? (
                  <div className="between">
                    <span className="badge amber">⏰ live window closed</span>
                    <span className="tiny muted">your host can restart it</span>
                  </div>
                ) : ['published', 'scheduled'].includes(z.status) && z.start_at && new Date(z.start_at) > new Date() ? (
                  <Countdown target={z.start_at} compact prefix="Starts in" />
                ) : (
                  <div className="between">
                    <span className="tiny muted">{attempted ? `Last: ${attempted.score}/${attempted.total_marks}` : 'Not attempted'}</span>
                    <Link className="btn btn-sm btn-primary" to={target}>{attempted ? (Number(attempted.score) > 0 ? 'Review' : 'Retry') : z.status === 'live' ? 'Join now' : 'Attempt'}</Link>
                  </div>
                )}
                {z.status === 'live' && (!z.end_at || new Date(z.end_at) > new Date()) && (
                  <Link className="btn btn-primary btn-block mt-s" to={target}>{user ? '🚀 Join live quiz' : 'Login to join'}</Link>
                )}
                {z.status === 'live' && z.end_at && new Date(z.end_at) <= new Date() && (
                  <Link className="btn btn-ghost btn-block mt-s" to={target}>Open live page</Link>
                )}
                {z.status === 'completed' && <Badge tone="cyan">Completed</Badge>}
              </div>
            );
          })}
        </div>
      )}
      {meta && <Pagination meta={meta} onPage={(page) => setFilters((f) => ({ ...f, page }))} />}
    </div>
  );
}
