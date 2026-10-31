import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { courseApi, miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { CourseCard, Empty, ErrorBox, Loader, Pagination } from '../components/ui';
import { COURSE_DIFFICULTIES } from '../utils/constants';

export default function Courses() {
  const { user } = useAuth();
  const [suggested, setSuggested] = useState([]);
  const [courses, setCourses] = useState(null);
  const [meta, setMeta] = useState(null);
  const [cats, setCats] = useState([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ search: '', category: '', difficulty: '', sort: 'created_at', page: 1, limit: 9 });

  const load = async (f = filters) => {
    setCourses(null); setError('');
    try {
      const { data } = await courseApi.list(f);
      setCourses(data.data); setMeta(data.meta);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(filters); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => { miscApi.categories().then(({ data }) => setCats(data.data.filter((c) => ['course', 'all'].includes(c.type)))).catch(() => {}); }, []);

  useEffect(() => {
    if (!user) { setSuggested([]); return undefined; }
    let alive = true;
    // Suggestions are advisory; if they fail the catalogue still renders.
    courseApi.recommended()
      .then(({ data }) => { if (alive) setSuggested(data.data || []); })
      .catch(() => { if (alive) setSuggested([]); });
    return () => { alive = false; };
  }, [user]);

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Catalogue</span><h1>Explore courses</h1>
          <p className="muted small">Structured video lessons, notes, quizzes and coding practice for every subject.</p></div>
      </div>

      {suggested.length > 0 && (
        <section className="mb" aria-label="Suggested courses">
          <span className="eyebrow">Suggested for you</span>
          <p className="muted small" style={{ marginTop: 4 }}>
            Based only on the categories of courses you have completed. Suggestions, not a judgement of your skills.
          </p>
          <div className="grid g3">
            {suggested.map((course) => (
              <article className="card hover" key={course.id}>
                <div className="between mb-s">
                  {course.category_name && <span className="tag">{course.category_name}</span>}
                  <span className="tag">{course.difficulty}</span>
                </div>
                <h3 style={{ fontSize: '1.05rem' }}>{course.title}</h3>
                <p className="muted small">{course.summary || 'A course on SmartODL.'}</p>
                {Array.isArray(course.reasons) && course.reasons.length > 0 && (
                  <ul className="tiny muted" style={{ paddingLeft: 18, margin: '8px 0 0' }}>
                    {course.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
                <Link className="btn btn-primary btn-block mt" to={`/courses/${course.slug || course.id}`}>
                  View course →
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="card mb">
        <div className="form-grid">
          <label className="field full">🔎 Search courses
            <input className="input" placeholder="Python, DSA, React, DBMS…" value={filters.search}
              onChange={(e) => set({ search: e.target.value })} />
          </label>
          <label className="field">Category
            <select className="select" value={filters.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All categories</option>
              {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">Difficulty
            <select className="select" value={filters.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
              <option value="">Any level</option>
              {COURSE_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="field">Sort by
            <select className="select" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
              <option value="created_at">Newest</option>
              <option value="total_students">Most popular</option>
              <option value="rating">Highest rated</option>
              <option value="duration_hours">Longest</option>
              <option value="title">A → Z</option>
            </select>
          </label>
          <label className="field">Per page
            <select className="select" value={filters.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>
              {[3, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={() => load()} />}
      {!courses && !error && <Loader label="Fetching courses…" />}
      {courses && courses.length === 0 && <Empty title="No courses matched your filters" hint="Try clearing the filters." />}
      {courses && courses.length > 0 && (
        <>
          <p className="muted small">{meta?.total} course{meta?.total === 1 ? '' : 's'} found</p>
          <div className="grid g3">{courses.map((c) => <CourseCard key={c.id} course={c} />)}</div>
          <Pagination meta={meta} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}
    </div>
  );
}
