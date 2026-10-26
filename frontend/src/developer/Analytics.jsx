import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { miscApi, codingApi, courseApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Empty, ErrorBox, Loader, StatCard, StatusBadge } from '../components/ui';
import { fmtNum, timeAgo } from '../utils/format';

export default function Analytics() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [subs, setSubs] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [d, s] = await Promise.all([miscApi.developerDashboard(), codingApi.submissions({ limit: 100 })]);
      setData(d.data.data);
      setSubs(s.data.data || []);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  if (error) return <div className="container section"><ErrorBox error={error} onRetry={load} /></div>;
  if (!data) return <Loader label="Crunching your numbers…" />;

  const myProblemIds = data.my_problems.map((p) => p.id);
  const mine = subs.filter((s) => myProblemIds.includes(s.problem_id));
  const accepted = mine.filter((s) => s.status === 'accepted').length;
  const verdicts = mine.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
  const langs = mine.reduce((acc, s) => { acc[s.language] = (acc[s.language] || 0) + 1; return acc; }, {});

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Insights</span><h2>Analytics</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>How your courses, quizzes and problems are performing with students.</p></div>
        <button className="btn btn-ghost" onClick={load}>🔄 Refresh</button>
      </div>

      <div className="grid g4">
        <StatCard icon="📘" label="My courses" value={data.stats.my_courses} hint={`${data.stats.published_courses} published`} />
        <StatCard icon="🎓" label="Students reached" value={data.stats.total_students} hint="Unique enrollments" />
        <StatCard icon="💻" label="Submissions on my problems" value={mine.length} hint={`${accepted} accepted`} />
        <StatCard icon="📄" label="Notes uploaded" value={data.stats.my_notes} hint="Downloads tracked" />
      </div>

      <div className="split mt" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3>Verdict distribution</h3>
          {mine.length === 0 ? <Empty title="No submissions on your problems yet" /> : (
            <div className="stack" style={{ gap: 10 }}>
              {Object.entries(verdicts).sort((a, b) => b[1] - a[1]).map(([v, count]) => (
                <div key={v}>
                  <div className="between small"><span>{v.replace(/_/g, ' ')}</span><strong>{count}</strong></div>
                  <div className="progress mt-s"><i style={{ width: `${(count / mine.length) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3>Language usage</h3>
          {mine.length === 0 ? <Empty title="Nothing to show yet" /> : (
            <div className="stack" style={{ gap: 10 }}>
              {Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l, count]) => (
                <div key={l}>
                  <div className="between small"><span>{l}</span><strong>{count}</strong></div>
                  <div className="progress mt-s"><i style={{ width: `${(count / mine.length) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="split mt" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3>Course performance</h3>
          {data.my_courses.length === 0 ? <Empty title="No courses yet" /> : (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Course</th><th>Students</th><th>Status</th></tr></thead>
                <tbody>
                  {data.my_courses.map((c) => (
                    <tr key={c.id}>
                      <td><Link className="link" to={`/courses/${c.id}`}>{c.title}</Link><div className="tiny muted">{c.lessons_count} lessons • {c.difficulty}</div></td>
                      <td>{fmtNum(c.total_students)}</td>
                      <td><StatusBadge value={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Problem performance</h3>
          {data.my_problems.length === 0 ? <Empty title="No problems yet" /> : (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Problem</th><th>Subs</th><th>Acceptance</th></tr></thead>
                <tbody>
                  {data.my_problems.map((p) => (
                    <tr key={p.id}>
                      <td><Link className="link" to={`/coding/${p.id}`}>{p.title}</Link><div className="tiny muted">{p.difficulty}</div></td>
                      <td>{p.total_submissions}</td>
                      <td>{Number(p.acceptance_rate).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card mt">
        <h3>Recent submissions on your problems</h3>
        {mine.length === 0 ? <Empty title="No submissions yet" /> : (
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead><tr><th>Student</th><th>Problem</th><th>Verdict</th><th>Tests</th><th>When</th></tr></thead>
              <tbody>
                {mine.slice(0, 15).map((s) => (
                  <tr key={s.id}>
                    <td className="small">{s.full_name}</td>
                    <td><Link className="link" to={`/coding/${s.problem_id}`}>{s.problem_title}</Link></td>
                    <td><span className={`badge ${s.status === 'accepted' ? 'green' : s.status === 'wrong_answer' ? 'red' : 'amber'}`}>{s.status.replace(/_/g, ' ')}</span></td>
                    <td className="small">{s.test_cases_passed}/{s.total_test_cases}</td>
                    <td className="tiny muted">{timeAgo(s.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="soft small mt">👋 {user.full_name}: students on your courses also appear under Participants, with progress per lesson.</div>
    </div>
  );
}
