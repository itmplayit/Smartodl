import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { courseApi } from '../services/api';
import { DiffBadge, Empty, ErrorBox, Loader } from '../components/ui';

export default function MyCourses() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = () => courseApi.enrollments()
    .then(({ data }) => setRows(data.data))
    .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // Refresh when the tab/route regains focus so newly-enrolled courses appear
    // without a manual page reload.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!rows) return <Loader label="Loading your courses…" />;

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">My learning</span><h2>My courses</h2>
          <p className="muted small">Everything you have enrolled in, with live progress tracking.</p></div>
        <Link className="btn btn-ghost btn-sm" to="/courses">Browse more courses →</Link>
      </div>

      {rows.length === 0 && <Empty title="You have not enrolled in any course yet" hint="Pick a course from the catalogue to get started." action={<Link className="btn btn-primary" to="/courses">Browse courses</Link>} />}

      <div className="grid g3">
        {rows.map((c) => (
          <div className="card hover" key={c.id}>
            <div className="between mb-s">
              <DiffBadge value={c.difficulty} />
              <span className={`badge ${c.status === 'completed' ? 'green' : 'cyan'}`}>{c.status}</span>
            </div>
            <h3 style={{ fontSize: '1.05rem' }}>{c.title}</h3>
            <div className="progress mt-s"><i style={{ width: `${Number(c.progress_percent)}%` }} /></div>
            <div className="between tiny muted mt-s">
              <span>{c.completed_lessons}/{c.lessons_count} lessons complete</span>
              <span>{Number(c.progress_percent)}%</span>
            </div>
            <div className="row mt" style={{ gap: 8 }}>
              <Link className="btn btn-sm btn-primary" to={`/courses/${c.course_id}`}>Continue</Link>
              <Link className="btn btn-sm btn-ghost" to="/notes">Course notes</Link>
            </div>
            <div className="tiny muted mt-s">Enrolled {new Date(c.enrolled_at).toLocaleDateString()} • Last opened {c.last_accessed_at ? new Date(c.last_accessed_at).toLocaleDateString() : '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
