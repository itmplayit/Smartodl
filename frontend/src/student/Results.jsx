import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { quizApi, codingApi } from '../services/api';
import { Empty, ErrorBox, Loader, StatusBadge } from '../components/ui';
import { timeAgo, VERDICT_ICON, fmtNum } from '../utils/format';

export default function Results() {
  const [attempts, setAttempts] = useState(null);
  const [subs, setSubs] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('quizzes');

  useEffect(() => {
    (async () => {
      try {
        const [q, c] = await Promise.all([quizApi.myAttempts(), codingApi.mySubmissions({ limit: 50 })]);
        setAttempts(q.data.data);
        setSubs(c.data.data);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!attempts || !subs) return <Loader label="Loading your results…" />;

  const best = attempts.reduce((a, b) => Math.max(a, Number(b.score) || 0), 0);
  const accepted = subs.filter((s) => s.status === 'accepted').length;

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Performance</span><h2>My results</h2>
          <p className="muted small">Every quiz attempt and code submission, with verdicts, scores and ranks.</p></div>
      </div>

      <div className="grid g4 mb">
        {[['Quiz attempts', attempts.length], ['Best quiz score', best], ['Code submissions', subs.length],
          ['Accepted', `${accepted}/${subs.length}`]].map(([l, v]) => (
          <div className="stat" key={l}><div className="v">{typeof v === 'number' ? fmtNum(v) : v}</div><div className="l">{l}</div></div>
        ))}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'quizzes' ? 'active' : ''}`} onClick={() => setTab('quizzes')}>🧠 Quiz attempts</button>
        <button className={`tab ${tab === 'code' ? 'active' : ''}`} onClick={() => setTab('code')}>💻 Code submissions</button>
      </div>

      {tab === 'quizzes' && (
        attempts.length === 0 ? <Empty title="No quiz attempts yet" hint="Attempt a practice or live quiz to see results here." />
          : (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Quiz</th><th>Score</th><th>Accuracy</th><th>Rank</th><th>Status</th><th>Attempted</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {attempts.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.title}</strong><div className="tiny muted">{a.quiz_type} • {a.difficulty}</div></td>
                      <td><strong>{Number(a.score)}</strong>/{a.total_marks}</td>
                      <td>{Number(a.accuracy).toFixed(1)}%</td>
                      <td>{a.rank_position ? `#${a.rank_position}` : '—'}</td>
                      <td><StatusBadge value={a.status} />{a.passed === 1 && <span className="badge green" style={{ marginLeft: 6 }}>passed</span>}</td>
                      <td className="tiny muted">{timeAgo(a.started_at)}</td>
                      <td><Link className="btn btn-sm btn-ghost" to={`/quizzes/attempts/${a.id}`}>Answer sheet</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}

      {tab === 'code' && (
        subs.length === 0 ? <Empty title="No submissions yet" hint="Head to the Coding Arena and solve your first problem." action={<Link className="btn btn-primary" to="/coding">Open the arena</Link>} />
          : (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Problem</th><th>Verdict</th><th>Tests</th><th>Time</th><th>Memory</th><th>Points</th><th>Language</th><th>When</th></tr></thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id}>
                      <td><Link className="link" to={`/coding/${s.problem_id}`}>{s.title}</Link><div className="tiny muted">{s.difficulty}</div></td>
                      <td><span className={`badge ${s.status === 'accepted' ? 'green' : s.status === 'wrong_answer' ? 'red' : 'amber'}`}>{VERDICT_ICON[s.status] || ''} {s.status.replace(/_/g, ' ')}</span></td>
                      <td className="small">{s.test_cases_passed}/{s.total_test_cases}</td>
                      <td className="small">{Number(s.execution_time).toFixed(3)} s</td>
                      <td className="small">{Number(s.memory_used).toFixed(1)} MB</td>
                      <td>{s.score}</td>
                      <td className="small">{s.language}</td>
                      <td className="tiny muted">{timeAgo(s.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </div>
  );
}
