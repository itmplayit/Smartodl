import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { miscApi } from '../services/api';
import { Avatar, Badge, DiffBadge, Empty, ErrorBox, Loader, StatusBadge } from '../components/ui';
import { DIFFICULTIES } from '../utils/constants';

const TYPES = [['all', 'Everything'], ['course', 'Courses'], ['note', 'Notes'], ['quiz', 'Quizzes'], ['problem', 'Coding problems'], ['contest', 'Contests'], ['developer', 'Developers']];

const LINK = {
  course: (r) => `/courses/${r.id}`,
  note: () => '/notes',
  quiz: (r) => (r.status === 'live' ? `/quizzes/${r.id}/live` : `/quizzes/${r.id}`),
  problem: (r) => `/coding/${r.id}`,
  contest: (r) => `/contests/${r.id}`,
  developer: () => '/courses',
};

export default function SearchResults() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [type, setType] = useState(params.get('type') || 'all');
  const [difficulty, setDifficulty] = useState('');
  const [sort, setSort] = useState('relevance');
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    setResults(null); setError('');
    miscApi.search({ q, type, difficulty, sort, limit: 40 })
      .then(({ data }) => { setResults(data.data); setMeta(data.meta); })
      .catch((e) => setError(e.message));
  }, [q, type, difficulty, sort]);

  const render = (t, rows) => {
    if (!rows.length) return null;
    if (t === 'course') return (
      <div className="grid g3 mb">
        {rows.map((r) => (
          <Link className="card hover" to={LINK.course(r)} key={r.id}>
            <div className="between mb-s"><span className="tag">{r.category_name || 'Course'}</span><DiffBadge value={r.difficulty} /></div>
            <h3 style={{ fontSize: '1rem' }}>{r.title}</h3>
            <p className="tiny muted">{(r.summary || r.description || '').slice(0, 110)}</p>
            <div className="tiny muted mt-s">👨‍🏫 {r.instructor_name || 'SmartODL'} • 🎓 {r.total_students} students</div>
          </Link>
        ))}
      </div>
    );
    if (t === 'note') return (
      <div className="grid g3 mb">
        {rows.map((r) => (
          <Link className="card hover" to={LINK.note(r)} key={r.id}>
            <span style={{ fontSize: '1.8rem' }}>📄</span>
            <h3 style={{ fontSize: '1rem' }}>{r.title}</h3>
            <p className="tiny muted">{r.subject || 'General'} • {String(r.file_type).toUpperCase()}</p>
            <div className="tiny muted mt-s">⬇ {r.download_count} downloads</div>
          </Link>
        ))}
      </div>
    );
    if (t === 'problem') return (
      <div className="grid g3 mb">
        {rows.map((r) => (
          <Link className="card hover" to={LINK.problem(r)} key={r.id}>
            <div className="between mb-s"><DiffBadge value={r.difficulty} /><span className="tag">{r.points} pts</span></div>
            <h3 style={{ fontSize: '1rem' }}>{r.title}</h3>
            <p className="tiny muted">{(r.description || '').slice(0, 110)}</p>
            <div className="tiny muted mt-s">✅ {Number(r.acceptance_rate || 0).toFixed(1)}% acceptance</div>
          </Link>
        ))}
      </div>
    );
    if (t === 'quiz') return (
      <div className="grid g3 mb">
        {rows.map((r) => (
          <Link className="card hover" to={LINK.quiz(r)} key={r.id}>
            <div className="between mb-s"><StatusBadge value={r.status} /><span className="tag">{r.quiz_type}</span></div>
            <h3 style={{ fontSize: '1rem' }}>{r.title}</h3>
            <p className="tiny muted">{(r.description || '').slice(0, 110)}</p>
            <div className="tiny muted mt-s">⏱ {r.time_limit_minutes} min • 🎯 {r.total_marks} marks</div>
          </Link>
        ))}
      </div>
    );
    if (t === 'contest') return (
      <div className="grid g3 mb">
        {rows.map((r) => (
          <Link className="card hover" to={LINK.contest(r)} key={r.id}>
            <div className="between mb-s"><StatusBadge value={r.status} /><span className="tag">{r.contest_type}</span></div>
            <h3 style={{ fontSize: '1rem' }}>{r.title}</h3>
            <p className="tiny muted">{(r.description || '').slice(0, 110)}</p>
            <div className="tiny muted mt-s">👥 {r.participant_count ?? r.registered_count ?? 0} participants</div>
          </Link>
        ))}
      </div>
    );
    return (
      <div className="grid g3 mb">
        {rows.map((r) => (
          <div className="card row" key={r.id} style={{ gap: 12 }}>
            <Avatar user={{ full_name: r.full_name, avatar: r.avatar }} />
            <div><div style={{ fontWeight: 600 }}>{r.full_name}</div><div className="tiny muted">{r.college || 'SmartODL instructor'} • {r.role}</div></div>
          </div>
        ))}
      </div>
    );
  };

  const groups = results ? (type === 'all' ? Object.entries(results) : [[type, results[type] || []]]) : [];
  const total = results && type === 'all' ? Object.values(results).reduce((a, b) => a + b.length, 0) : (results ? results.length : 0);

  return (
    <div className="container section">
      <span className="eyebrow">Search</span>
      <h1>{q ? `Results for “${q}”` : 'Search SmartODL'}</h1>

      <form className="row mb" style={{ gap: 10 }}
        onSubmit={(e) => { e.preventDefault(); setParams({ q: e.target.q.value }); }}>
        <input className="input" name="q" defaultValue={q} placeholder="Search courses, notes, quizzes, problems, contests, developers…" />
        <button className="btn btn-primary">Search</button>
      </form>

      <div className="card mb">
        <div className="form-grid">
          <label className="field">Category
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field">Difficulty
            <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="">Any</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="field">Sort by
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="popular">Most popular</option>
            </select>
          </label>
        </div>
      </div>

      {error && <ErrorBox error={error} />}
      {!results && !error && <Loader label="Searching…" />}
      {results && total === 0 && <Empty title="Nothing matched your search" hint="Try shorter keywords, or switch the category filter." />}
      {results && total > 0 && (
        <>
          <p className="muted small">{total} result{total === 1 ? '' : 's'}{meta && meta.took_ms ? ` • ${meta.took_ms} ms` : ''}</p>
          {groups.map(([t, rows]) => (
            <section key={t}>
              <div className="between mb-s">
                <h2 style={{ textTransform: 'capitalize' }}>{t === 'problem' ? 'Coding problems' : `${t}s`} <span className="tag">{rows.length}</span></h2>
                {type === 'all' && rows.length >= 5 && <button className="btn btn-sm btn-ghost" onClick={() => setType(t)}>See only {t}s →</button>}
              </div>
              {render(t, rows)}
            </section>
          ))}
          {type === 'all' && <div className="soft small">💡 Use the category filter to narrow results, or press ⌘K anywhere for quick suggestions.</div>}
        </>
      )}
    </div>
  );
}
