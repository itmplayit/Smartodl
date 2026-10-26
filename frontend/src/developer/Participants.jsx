import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { courseApi, contestApi, miscApi } from '../services/api';
import { Avatar, Empty, ErrorBox, Loader } from '../components/ui';
import { timeAgo } from '../utils/format';

/** Participants across a developer's courses and contests. */
export default function Participants() {
  const [courses, setCourses] = useState([]);
  const [contests, setContests] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [contestId, setContestId] = useState('');
  const [rows, setRows] = useState(null);
  const [board, setBoard] = useState([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('courses');

  useEffect(() => {
    (async () => {
      try {
        const [d, c] = await Promise.all([miscApi.developerDashboard(), contestApi.list()]);
        const myCourses = d.data.data.my_courses;
        setCourses(myCourses);
        setContests(c.data.data);
        if (myCourses[0]) setCourseId(myCourses[0].id);
        if (c.data.data[0]) setContestId(c.data.data[0].id);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  useEffect(() => {
    if (!courseId) return;
    setRows(null);
    courseApi.courseEnrollments(courseId).then(({ data }) => setRows(data.data)).catch((e) => setError(e.message));
  }, [courseId]);

  useEffect(() => {
    if (!contestId) return;
    contestApi.leaderboard(contestId).then(({ data }) => setBoard(data.data)).catch(() => setBoard([]));
  }, [contestId]);

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">People</span><h2>Participants</h2>
          <p className="muted small">Students enrolled in your courses and competing in your contests, with progress and standings.</p></div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'courses' ? 'active' : ''}`} onClick={() => setTab('courses')}>📘 Course enrollments</button>
        <button className={`tab ${tab === 'contests' ? 'active' : ''}`} onClick={() => setTab('contests')}>🏆 Contest participants</button>
      </div>

      {tab === 'courses' && (
        <>
          <div className="card mb mt">
            <label className="field" style={{ maxWidth: 480 }}>Course
              <select className="select" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                {courses.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.title}</option>)}
              </select>
            </label>
          </div>
          {courses.length === 0 && <Empty title="You have no courses yet" />}
          {!rows && courses.length > 0 && <Loader label="Loading students…" />}
          {rows && rows.length === 0 && <Empty title="No students enrolled yet" hint="Publish the course to attract learners." />}
          {rows && rows.length > 0 && (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Student</th><th>Email</th><th>College</th><th>Progress</th><th>Status</th><th>Enrolled</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><div className="row" style={{ gap: 10 }}><Avatar user={r} size={30} /><strong>{r.full_name}</strong></div></td>
                      <td className="small">{r.email}</td>
                      <td className="small">{r.college || '—'}</td>
                      <td style={{ minWidth: 150 }}>
                        <div className="progress"><i style={{ width: `${Number(r.progress_percent)}%` }} /></div>
                        <span className="tiny muted">{Number(r.progress_percent)}% • {r.completed_lessons} lessons</span>
                      </td>
                      <td><span className={`badge ${r.status === 'completed' ? 'green' : 'cyan'}`}>{r.status}</span></td>
                      <td className="tiny muted">{timeAgo(r.enrolled_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'contests' && (
        <>
          <div className="card mb mt">
            <label className="field" style={{ maxWidth: 480 }}>Contest
              <select className="select" value={contestId} onChange={(e) => setContestId(e.target.value)}>
                {contests.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.title}</option>)}
              </select>
            </label>
          </div>
          {board.length === 0 && <Empty title="No contest participants yet" hint="Students appear after they register or submit." />}
          {board.length > 0 && (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Rank</th><th>Participant</th><th>Solved</th><th>Score</th><th>Penalty</th><th>Last submission</th></tr></thead>
                <tbody>
                  {board.map((r) => (
                    <tr key={r.id}>
                      <td><strong>#{r.rank_position}</strong></td>
                      <td><div className="row" style={{ gap: 10 }}><Avatar user={{ full_name: r.full_name, avatar: r.avatar }} size={30} /><strong>{r.full_name}</strong></div></td>
                      <td>{r.solved_count}</td>
                      <td>{r.score}</td>
                      <td className="small">{r.penalty_minutes} min</td>
                      <td className="tiny muted">{r.last_submission_at ? timeAgo(r.last_submission_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="soft small mt">🔎 Only students you are permitted to view appear here — permission <code>view_student_data</code> controls access.</div>
      <Link className="btn btn-ghost mt-s" to="/developer/analytics">📈 Go to analytics</Link>
    </div>
  );
}
