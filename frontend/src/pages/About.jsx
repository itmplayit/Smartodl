import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { miscApi } from '../services/api';
import { fmtNum } from '../utils/format';

export default function About() {
  const [stats, setStats] = useState(null);
  useEffect(() => { miscApi.publicStats().then(({ data }) => setStats(data.data)).catch(() => {}); }, []);

  return (
    <div className="container section">
      <span className="eyebrow">About SmartODL</span>
      <h1>One platform for learning, practising and competing</h1>
      <p className="muted" style={{ maxWidth: 820 }}>
        SmartODL is a full-stack educational platform designed for colleges and universities. Students learn through
        structured courses and downloadable notes, test themselves with auto-graded and live quizzes, and sharpen
        problem-solving skills in a HackerRank-style coding arena backed by a secure, isolated execution worker.
        Instructors publish content from their own dashboard, and administrators control every entity — users,
        courses, quizzes, contests, problems, notifications and site settings — without touching a single line of code.
      </p>

      <div className="grid g4 mt">
        {[['Students', stats?.total_students], ['Courses', stats?.total_courses], ['Problems', stats?.total_problems], ['Submissions', stats?.total_submissions]]
          .map(([l, v]) => <div className="stat" key={l}><div className="v">{fmtNum(v || 0)}</div><div className="l">{l}</div></div>)}
      </div>

      <div className="grid g3 section">
        {[
          ['🎯', 'Learning-first', 'Courses with modules, lessons, video links, downloadable notes and progress tracking.'],
          ['🛡', 'Secure by design', 'JWT auth with refresh tokens, bcrypt hashing, RBAC + per-developer permissions, rate limiting, validated uploads.'],
          ['⚙️', 'Sandboxed judge', 'Student code never runs inside the API process — every run goes to an isolated, resource-limited worker.'],
          ['📡', 'Live quizzes', 'Schedule, broadcast, monitor participants in real time, auto-submit on expiry and rank instantly.'],
          ['🏆', 'Contests', 'Timed contests with problem sets, points, penalties, participant tracking and contest leaderboards.'],
          ['📊', 'Insight', 'Leaderboards (global/weekly/monthly/contest/course), badges, and admin reports over real database data.'],
        ].map(([icon, title, text]) => (
          <div className="card" key={title}>
            <div style={{ fontSize: '1.6rem' }}>{icon}</div>
            <h3>{title}</h3>
            <p className="muted small">{text}</p>
          </div>
        ))}
      </div>

      <div className="card section">
        <h2>Technology</h2>
        <div className="grid g2">
          <div>
            <h4>Frontend</h4>
            <div className="row wrap" style={{ gap: 8 }}>
              {['React 18', 'React Router 6', 'Vite', 'Axios', 'HTML5', 'CSS3'].map((t) => <span className="tag" key={t}>{t}</span>)}
            </div>
          </div>
          <div>
            <h4>Backend</h4>
            <div className="row wrap" style={{ gap: 8 }}>
              {['Node.js', 'Express', 'JWT', 'bcrypt', 'OAuth 2.0', 'Multer', 'mysql2', 'MySQL / XAMPP'].map((t) => <span className="tag" key={t}>{t}</span>)}
            </div>
          </div>
        </div>
        <div className="mt">
          <h4>Roles</h4>
          <div className="grid g3">
            {[['🎓 Student', 'Learn, attempt quizzes, solve problems, compete.'],
              ['👨‍🏫 Developer', 'Publish courses, notes, quizzes, problems and contests.'],
              ['🛠 Admin', 'Full control over content, users, permissions and settings.']].map(([t, d]) => (
              <div className="soft" key={t}><strong>{t}</strong><div className="small muted">{d}</div></div>
            ))}
          </div>
        </div>
      </div>

      <div className="card center">
        <h2>Want to try it?</h2>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary" to="/register">Create an account</Link>
          <Link className="btn btn-ghost" to="/courses">Browse courses</Link>
        </div>
      </div>
    </div>
  );
}
