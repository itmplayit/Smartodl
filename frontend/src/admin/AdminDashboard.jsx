import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Empty, ErrorBox, Loader, StatCard, StatusBadge } from '../components/ui';
import { fmtNum, timeAgo } from '../utils/format';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => miscApi.adminDashboard().then(({ data: d }) => setData(d.data)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (error) return <div className="container section"><ErrorBox error={error} onRetry={load} /></div>;
  if (!data) return <Loader label="Loading control centre…" />;

  const c = data.counts;
  const maxActivity = Math.max(1, ...data.activity.map((a) => a.submissions));

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          <span className="eyebrow">Control centre</span>
          <h1 style={{ marginBottom: 4 }}>Welcome, {user.full_name.split(' ')[0]} 🛠</h1>
          <p className="muted small" style={{ marginBottom: 0 }}>Every entity on the platform is managed from here — no source code changes needed.</p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn btn-primary" to="/admin/courses">📘 Manage courses</Link>
          <Link className="btn btn-ghost" to="/admin/certificates">🎓 Certificates</Link>
          <Link className="btn btn-ghost" to="/admin/settings">⚙️ Site settings</Link>
        </div>
      </div>

      {data.pendingDevelopers.length > 0 && (
        <div className="alert warn mb">
          👨‍🏫 {data.pendingDevelopers.length} developer account{data.pendingDevelopers.length > 1 ? 's' : ''} awaiting approval —{' '}
          <Link className="link" to="/admin/developers">review permissions</Link>.
        </div>
      )}

      <div className="grid g4">
        <StatCard icon="👥" label="Total users" value={fmtNum(c.total_users)} hint={`${c.students} students • ${c.developers} developers`} to="/admin/users" />
        <StatCard icon="📘" label="Courses" value={c.courses} hint={`${c.published_courses} published`} to="/admin/courses" />
        <StatCard icon="📄" label="Notes" value={c.notes} hint="Downloadable material" to="/admin/notes" />
        <StatCard icon="🧠" label="Quizzes" value={c.quizzes} hint={`${c.quiz_attempts} attempts`} to="/admin/quizzes" />
        <StatCard icon="💻" label="Coding problems" value={c.coding_problems} hint={`${c.published_problems} published`} to="/admin/problems" />
        <StatCard icon="🏆" label="Contests" value={c.contests} hint="All time" to="/admin/contests" />
        <StatCard icon="🚀" label="Submissions" value={fmtNum(c.submissions)} hint="Judged by the sandbox" to="/admin/submissions" />
        <StatCard icon="🔓" label="Active (24h)" value={c.active_users} hint="Users who logged in" to="/admin/users" />
      </div>

      <div className="row wrap mt-s" style={{ gap: 10 }}>
        <Link className="btn btn-sm btn-ghost" to="/admin/plagiarism">🕵 Similarity / plagiarism check</Link>
        <Link className="btn btn-sm btn-ghost" to="/admin/certificates">🎓 Certificates</Link>
        <Link className="btn btn-sm btn-ghost" to="/admin/ai">🤖 AI generator</Link>
      </div>

      <div className="split mt" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <div className="card">
          <h2 style={{ fontSize: '1rem' }}>📈 Submissions — last 14 days</h2>
          {data.activity.length === 0 ? <Empty title="No submission activity yet" /> : (
            <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: 160 }}>
              {data.activity.map((a) => (
                <div key={a.day} style={{ flex: 1, textAlign: 'center' }} title={`${a.submissions} submissions on ${new Date(a.day).toLocaleDateString()}`}>
                  <div style={{ height: `${(a.submissions / maxActivity) * 120}px`, background: 'linear-gradient(180deg,#22d3ee,#4f46e5)', borderRadius: 6 }} />
                  <div className="tiny muted">{new Date(a.day).getDate()}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3>🎓 Enrollments — last 14 days</h3>
          {data.enrollTrend.length === 0 ? <Empty title="No enrollments yet" /> : (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Day</th><th>Enrollments</th></tr></thead>
                <tbody>{data.enrollTrend.map((e) => <tr key={e.day}><td className="small">{new Date(e.day).toLocaleDateString()}</td><td>{e.enrollments}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="split mt" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="between mb-s"><h3>🆕 Recent registrations</h3><Link className="link small" to="/admin/users">All users →</Link></div>
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
              <tbody>
                {data.recentUsers.map((u) => (
                  <tr key={u.id}>
                    <td><div style={{ fontWeight: 600 }}>{u.full_name}</div><div className="tiny muted">{u.email}</div></td>
                    <td><span className="tag">{u.role}</span></td>
                    <td><StatusBadge value={u.status} /></td>
                    <td className="tiny muted">{timeAgo(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>🚀 Recent submissions</h3>
            <div className="list-tight">
              {data.recentSubmissions.map((s) => (
                <div className="between" key={s.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 600 }}>{s.full_name} → {s.title}</div>
                    <div className="tiny muted">{s.language} • {timeAgo(s.submitted_at)}</div>
                  </div>
                  <span className={`badge ${s.status === 'accepted' ? 'green' : s.status === 'wrong_answer' ? 'red' : 'amber'}`}>{s.status.replace(/_/g, ' ')}</span>
                </div>
              ))}
              {data.recentSubmissions.length === 0 && <span className="tiny muted">No submissions yet.</span>}
            </div>
          </div>
          <div className="card">
            <h3>🥇 Top learners</h3>
            <div className="list-tight">
              {data.topLearners.map((u, i) => (
                <div className="between" key={u.id}>
                  <span className="small">{['🥇', '🥈', '🥉'][i] || `#${i + 1}`} {u.full_name}</span>
                  <span className="small"><strong>{fmtNum(u.points)}</strong> pts • {u.problems_solved} solved</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card mt">
        <h3>⚡ Quick admin actions</h3>
        <div className="row wrap" style={{ gap: 10 }}>
          {[['/admin/users', '👥 Users'], ['/admin/courses', '📘 Courses'], ['/admin/notes', '📄 Notes'], ['/admin/quizzes', '🧠 Quizzes'],
            ['/admin/live', '📡 Live quiz'], ['/admin/problems', '💻 Problems'], ['/admin/test-cases', '🧪 Test cases'],
            ['/admin/contests', '🏆 Contests'], ['/admin/submissions', '📨 Submissions'], ['/admin/leaderboard', '📊 Leaderboard'],
            ['/admin/achievements', '🎖 Achievements'], ['/admin/notifications', '🔔 Notifications'], ['/admin/reports', '📈 Reports'],
            ['/admin/settings', '⚙️ Settings']].map(([to, label]) => (
            <Link className="btn btn-ghost btn-sm" key={to} to={to}>{label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
