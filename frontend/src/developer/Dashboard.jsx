import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { miscApi, courseApi, quizApi, codingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Empty, ErrorBox, Loader, StatCard, StatusBadge } from '../components/ui';
import { timeAgo } from '../utils/format';

export default function DeveloperDashboard() {
  const { user, can, refreshMe } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = () => miscApi.developerDashboard().then(({ data: d }) => setData(d.data)).catch((e) => setError(e.message));

  // reload the numbers whenever the admin changes this account's access —
  // AuthContext re-reads /auth/me and the new permission list lands in `user`
  const permissionKey = (user?.permissions || []).join(',');
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [permissionKey]);

  const refreshAccess = async () => {
    setRefreshing(true);
    await refreshMe();
    await load();
    setRefreshing(false);
  };

  if (error) return <div className="container section"><ErrorBox error={error} onRetry={load} /></div>;
  if (!data) return <Loader label="Loading instructor workspace…" />;

  const perms = data.permissions || [];

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          <span className="eyebrow">Instructor workspace</span>
          <h1 style={{ marginBottom: 4 }}>Hello {user.full_name.split(' ')[0]} 👨‍🏫</h1>
          <p className="muted small" style={{ marginBottom: 0 }}>
            {perms.length} permission{perms.length === 1 ? '' : 's'} granted by the administrator.
            {user.status === 'pending' && ' Your account is pending admin approval.'}
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {[
            ['/developer/courses/new', '➕ Create course', 'create_course'],
            ['/developer/quiz/new', '🧠 Create quiz', 'create_quiz'],
            ['/developer/problems/new', '💻 New problem', 'create_problem'],
          ].map(([to, label, perm]) => (
            can(perm) ? (
              <Link className="btn btn-ghost" key={to} to={to}>{label}</Link>
            ) : (
              <span className="btn btn-ghost" key={to} title={`Needs the "${perm}" permission`}
                style={{ opacity: .55, cursor: 'not-allowed' }}>🔒 {label.replace(/^\S+\s/, '')}</span>
            )
          ))}
          <button className="btn btn-ghost" onClick={refreshAccess} disabled={refreshing} title="Re-read my permissions">
            {refreshing ? '⏳ Checking…' : '🔄 Refresh access'}
          </button>
        </div>
      </div>

      <div className="grid g4">
        <StatCard icon="📘" label="My courses" value={data.stats.my_courses} hint={`${data.stats.published_courses} published`} to="/developer/courses" />
        <StatCard icon="🎓" label="Students enrolled" value={data.stats.total_students} hint="Across your courses" to="/developer/participants" />
        <StatCard icon="📄" label="Notes uploaded" value={data.stats.my_notes} hint="Study material" to="/developer/notes" />
        <StatCard icon="🧠" label="Quizzes" value={data.stats.my_quizzes} hint="Practice + live" to="/developer/quizzes" />
        <StatCard icon="💻" label="Coding problems" value={data.stats.my_problems} hint="With test cases" to="/developer/problems" />
        <StatCard icon="🏆" label="Contests" value={data.stats.my_contests} hint="Hosted by you" to="/developer/contests" />
      </div>

      <div className="card mt">
        <div className="between wrap">
          <h3 style={{ margin: 0 }}>🔑 Your permissions</h3>
          <button className="btn btn-sm btn-ghost" onClick={refreshAccess} disabled={refreshing}>
            {refreshing ? '⏳ Checking…' : '🔄 Refresh'}
          </button>
        </div>
        {perms.length === 0 ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            No permissions yet — an administrator has to enable the actions you need.
            This panel refreshes by itself as soon as your access changes.
          </p>
        ) : (
          <div className="row wrap mt-s" style={{ gap: 8 }}>
            {perms.map((p) => (
              <span className="tag" key={p} style={can(p) ? undefined : { opacity: .6 }}>
                {can(p) ? '✓' : '—'} {p.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
        <p className="tiny muted mt-s">
          Locked actions are greyed out here and blocked by the API (HTTP 403).
          New grants reach this page within a minute, when you switch back to this tab, or instantly via 🔄 Refresh.
        </p>
      </div>

      <div className="split mt" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="between mb-s"><h3>📘 My courses</h3><Link className="link small" to="/developer/courses">Manage →</Link></div>
          {data.my_courses.length === 0 && <Empty title="No courses yet" hint="Create your first course to reach students." />}
          <div className="list-tight">
            {data.my_courses.map((c) => (
              <div className="between" key={c.id}>
                <div style={{ minWidth: 0 }}>
                  <Link className="small" style={{ fontWeight: 600 }} to={`/developer/courses/${c.id}`}>{c.title}</Link>
                  <div className="tiny muted">{c.lessons_count} lessons • {c.total_students} students • {c.difficulty}</div>
                </div>
                <StatusBadge value={c.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="between mb-s"><h3>💻 My problems</h3><Link className="link small" to="/developer/problems">Manage →</Link></div>
          {data.my_problems.length === 0 && <Empty title="No coding problems yet" />}
          <div className="list-tight">
            {data.my_problems.map((p) => (
              <div className="between" key={p.id}>
                <div style={{ minWidth: 0 }}>
                  <Link className="small" style={{ fontWeight: 600 }} to={`/coding/${p.id}`}>{p.title}</Link>
                  <div className="tiny muted">{p.difficulty} • {p.total_submissions} submissions • {Number(p.acceptance_rate).toFixed(1)}% accepted</div>
                </div>
                <StatusBadge value={p.status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="split mt" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="between mb-s"><h3>🧠 My quizzes</h3><Link className="link small" to="/developer/quizzes">Manage →</Link></div>
          {data.my_quizzes.length === 0 && <Empty title="No quizzes yet" />}
          <div className="list-tight">
            {data.my_quizzes.map((z) => (
              <div className="between" key={z.id}>
                <div style={{ minWidth: 0 }}>
                  <Link className="small" style={{ fontWeight: 600 }} to={`/developer/quizzes/${z.id}`}>{z.title}</Link>
                  <div className="tiny muted">{z.question_count} questions • {z.time_limit_minutes} min • {z.quiz_type}</div>
                </div>
                <StatusBadge value={z.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="between mb-s"><h3>📨 Recent submissions on your problems</h3><Link className="link small" to="/developer/submissions">All →</Link></div>
          {data.recent_submissions.length === 0 && <Empty title="No submissions yet" />}
          <div className="list-tight">
            {data.recent_submissions.map((s) => (
              <div className="between" key={s.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600 }}>{s.full_name} → {s.title}</div>
                  <div className="tiny muted">{s.language} • {timeAgo(s.submitted_at)}</div>
                </div>
                <span className={`badge ${s.status === 'accepted' ? 'green' : s.status === 'wrong_answer' ? 'red' : 'amber'}`}>{s.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt">
        <h3>⚡ Quick actions</h3>
        <div className="row wrap" style={{ gap: 10 }}>
          <Link className="btn btn-ghost" to="/developer/notes">📄 Upload notes</Link>
          <Link className="btn btn-ghost" to="/developer/live">📡 Host a live quiz</Link>
          <Link className="btn btn-ghost" to="/developer/contests">🏆 Host a contest</Link>
          <Link className="btn btn-ghost" to="/developer/participants">👥 Participants</Link>
          <Link className="btn btn-ghost" to="/developer/analytics">📈 Analytics</Link>
          <button className="btn btn-ghost" onClick={() => Promise.all([
            courseApi.list({ limit: 1 }), quizApi.list({ limit: 1 }), codingApi.problems({ limit: 1 }),
          ]).then(() => window.location.reload())}>🔄 Refresh data</button>
        </div>
      </div>
    </div>
  );
}
