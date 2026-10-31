import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { miscApi, gamificationApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Avatar, Badge, Countdown, DiffBadge, Empty, ErrorBox, Heatmap, Loader, StatCard, StatusBadge, XPBadge } from '../components/ui';
import { fmtNum, timeAgo, VERDICT_ICON } from '../utils/format';

export default function StudentDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [gam, setGam] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    miscApi.studentDashboard()
      .then(({ data: d }) => setData(d.data))
      .catch((e) => setError(e.message));
    gamificationApi.me()
      .then(({ data: d }) => setGam(d.data))
      .catch(() => {});
  };
  useEffect(() => {
    // Same reason as MainLayout: a hard reload starts token-less, so any API
    // call before the session restore finishes answers 401.
    if (authLoading) return undefined;
    load();
    // Refresh when the user returns to this tab/route (e.g. after enrolling
    // from the course detail page) so newly enrolled courses appear without a
    // manual refresh. React 6 keeps this component mounted across client-side
    // navigations, so a plain mount-only effect is not enough.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authLoading]);

  if (error) return <div className="container section"><ErrorBox error={error} onRetry={load} /></div>;
  if (!data) return <Loader label="Building your dashboard…" />;

  const solved = (data.recent_submissions || []).filter((s) => s.status === 'accepted').length;

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div className="row" style={{ gap: 14 }}>
          <Avatar user={user} size={56} />
          <div>
            <h1 style={{ marginBottom: 2 }}>Welcome back, {user.full_name.split(' ')[0]} 👋</h1>
            <p className="muted small" style={{ marginBottom: 0 }}>
              {user.college || 'SmartODL learner'} • Member since {new Date(user.created_at).toLocaleDateString()}
            </p>
            {gam && <div className="mt-s"><XPBadge lv={gam} big /></div>}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn btn-primary" to="/coding">💻 Solve a problem</Link>
          <Link className="btn btn-ghost" to="/quizzes">🧠 Take a quiz</Link>
        </div>
      </div>

      <div className="grid dashboard-stat-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <StatCard icon="🔥" label="Day streak" value={gam ? gam.streak_days : '—'} hint={gam && gam.streak_days > 0 ? `Best: ${gam.streak_best} days` : 'Solve something today!'} to="/coding" />
        <StatCard icon="💎" label="Total points" value={fmtNum(data.rank ? data.rank.points : user.points)} hint="Earned from quizzes & problems" to="/leaderboard" />
        <StatCard icon="📊" label="Global rank" value={data.rank ? `#${data.rank.rank_position}` : '—'} hint={data.rank ? `${Number(data.rank.accuracy).toFixed(1)}% accuracy` : 'Solve to get ranked'} to="/leaderboard" />
        <StatCard icon="📘" label="Enrolled courses" value={data.enrolled_courses.length} hint="Keep your streak going" to="/student/courses" />
        <StatCard icon="🎖" label="Badges earned" value={data.badges.length} hint="Unlocked achievements" to="/student/achievements" />
      </div>

      {gam && (
        <div className="card mt">
          <div className="between mb-s">
            <h2 style={{ fontSize: '1rem' }}>📅 Practice — last 12 weeks</h2>
            <span className="tiny muted">{gam.heatmap.reduce((a, d) => a + d.count, 0)} activities • streak {gam.streak_days}🔥</span>
          </div>
          <Heatmap days={gam.heatmap} />
          {gam.next_title && (
            <div className="mt-s">
              <div className="between tiny muted"><span>⭐ Level {gam.level} — {gam.title}</span><span>Level {gam.next_level} — {gam.next_title} at {gam.next_at} pts</span></div>
              <div className="progress mt-s"><i style={{ width: `${gam.progress_percent}%` }} /></div>
            </div>
          )}
        </div>
      )}

      <div className="card mt between wrap" style={{ gap: 12 }}>
        <div>
          <h2 style={{ fontSize: '1rem', marginBottom: 2 }}>🎤 Placement ki tayari?</h2>
          <p className="small muted" style={{ marginBottom: 0 }}>DSA, JavaScript, SQL, and HR — practise mock interviews and rate yourself.</p>
        </div>
        <Link className="btn btn-primary" to="/interviews">Start mock interview →</Link>
      </div>

      <div className="split mt" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div className="stack">
          <div className="card">
            <div className="between mb-s"><h3>📘 Continue learning</h3><Link className="link small" to="/student/courses">My courses →</Link></div>
            {data.enrolled_courses.length === 0 && <Empty title="No courses yet" hint="Browse the catalogue and enrol in something new." action={<Link className="btn btn-primary btn-sm" to="/courses">Browse courses</Link>} />}
            <div className="stack" style={{ gap: 12 }}>
              {data.enrolled_courses.map((c) => (
                <Link to={`/courses/${c.course_id}`} className="panel hover" key={c.id}>
                  <div className="between">
                    <div style={{ minWidth: 0 }}>
                      <strong className="small">{c.title}</strong>
                      <div className="tiny muted">{c.completed_lessons}/{c.lessons_count} lessons • {c.status}</div>
                    </div>
                    <DiffBadge value={c.difficulty} />
                  </div>
                  <div className="progress mt-s"><i style={{ width: `${Number(c.progress_percent)}%` }} /></div>
                  <div className="tiny muted mt-s">{Number(c.progress_percent)}% complete</div>
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="between mb-s"><h3>💻 Recent submissions</h3><Link className="link small" to="/coding">Arena →</Link></div>
            {data.recent_submissions.length === 0 && <Empty title="No submissions yet" hint="Your verdicts will show up here." />}
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Problem</th><th>Verdict</th><th>Tests</th><th>Lang</th><th>When</th></tr></thead>
                <tbody>
                  {data.recent_submissions.map((s) => (
                    <tr key={s.id}>
                      <td><Link className="link" to={`/coding/${s.problem_id}`}>{s.title}</Link></td>
                      <td><span className={`badge ${s.status === 'accepted' ? 'green' : s.status === 'wrong_answer' ? 'red' : 'amber'}`}>{VERDICT_ICON[s.status] || ''} {s.status.replace(/_/g, ' ')}</span></td>
                      <td className="small">{s.test_cases_passed}/{s.total_test_cases}</td>
                      <td className="small">{s.language}</td>
                      <td className="tiny muted">{timeAgo(s.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="between mb-s"><h3>🧠 Quiz history</h3><Link className="link small" to="/student/results">All results →</Link></div>
            {data.recent_quiz_attempts.length === 0 && <Empty title="No quiz attempts yet" hint="Practice quizzes and live tests appear here." />}
            <div className="stack" style={{ gap: 10 }}>
              {data.recent_quiz_attempts.map((a) => (
                <Link to={`/quizzes/attempts/${a.id}`} className="panel hover" key={a.id}>
                  <div className="between">
                    <strong className="small">{a.title}</strong>
                    <StatusBadge value={a.status} />
                  </div>
                  <div className="row wrap tiny muted mt-s" style={{ gap: 12 }}>
                    <span>🎯 {Number(a.score)}/{a.total_marks}</span>
                    <span>📈 {Number(a.accuracy).toFixed(1)}%</span>
                    <span>🏅 rank #{a.rank_position || '—'}</span>
                    <span>{timeAgo(a.started_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>🎖 Your badges</h3>
            <div className="row wrap" style={{ gap: 8 }}>
              {data.badges.length === 0 && <span className="tiny muted">Earn your first badge by completing a quiz or solving a problem.</span>}
              {data.badges.map((b) => (
                <span className="badge violet" key={b.id} title={b.description}>{b.icon || '🏅'} {b.name}</span>
              ))}
            </div>
            <Link className="btn btn-ghost btn-block mt" to="/student/achievements">View all achievements</Link>
          </div>

          <div className="card">
            <div className="between mb-s"><h3>📡 Upcoming quizzes</h3><Link className="link small" to="/quizzes">All →</Link></div>
            <div className="stack" style={{ gap: 10 }}>
              {data.upcoming_quizzes.map((q) => (
                <div className="between" key={q.id}>
                  <div style={{ minWidth: 0 }}>
                    <Link className="small" style={{ fontWeight: 600 }} to={q.status === 'live' ? `/quizzes/${q.id}/live` : `/quizzes/${q.id}`}>{q.title}</Link>
                    <div className="tiny muted">{q.time_limit_minutes} min • {q.total_marks} marks</div>
                  </div>
                  {q.status === 'live' ? <span className="badge red">● LIVE</span> : <StatusBadge value={q.status} />}
                </div>
              ))}
              {data.upcoming_quizzes.length === 0 && <span className="tiny muted">No quizzes scheduled.</span>}
            </div>
          </div>

          <div className="card">
            <div className="between mb-s"><h3>🏆 Live contests</h3><Link className="link small" to="/contests">All →</Link></div>
            <div className="stack" style={{ gap: 10 }}>
              {data.live_contests.map((c) => (
                <div key={c.id}>
                  <div className="between">
                    <Link className="small" style={{ fontWeight: 600 }} to={`/contests/${c.id}`}>{c.title}</Link>
                    <StatusBadge value={c.status} />
                  </div>
                  {c.status === 'live' ? <Countdown target={c.end_at} compact /> : <Countdown target={c.start_at} prefix="in" compact />}
                </div>
              ))}
              {data.live_contests.length === 0 && <span className="tiny muted">No contests scheduled.</span>}
            </div>
          </div>

          <div className="card">
            <div className="between mb-s"><h3>📄 Latest notes</h3><Link className="link small" to="/notes">Library →</Link></div>
            <div className="stack" style={{ gap: 8 }}>
              {data.recent_notes.map((n) => (
                <div className="between" key={n.id}>
                  <span className="small">📄 {n.title}</span>
                  <span className="tiny muted">{timeAgo(n.created_at)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="soft small">🏅 Solved {solved} of your last submissions. Keep going — consistency builds rank.</div>
        </div>
      </div>
    </div>
  );
}
