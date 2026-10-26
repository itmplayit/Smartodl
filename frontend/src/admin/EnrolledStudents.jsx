import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { courseApi } from '../services/api';
import { Avatar, Empty, ErrorBox, Loader } from '../components/ui';
import { timeAgo } from '../utils/format';

export default function EnrolledStudents({ scope = 'admin' }) {
  const { id } = useParams();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { courseApi.courseEnrollments(id).then(({ data }) => setRows(data.data)).catch((e) => setError(e.message)); }, [id]);

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!rows) return <Loader label="Loading enrolled students…" />;

  return (
    <div className="container section">
      <div className="between mb">
        <div>
          <Link className="link small" to={`${scope === 'admin' ? '/admin' : '/developer'}/courses`}>← Courses</Link>
          <h2 style={{ marginBottom: 0 }}>👥 Enrolled students</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>{rows.length} enrollment{rows.length === 1 ? '' : 's'} for course #{id}</p>
        </div>
      </div>

      {rows.length === 0 && <Empty title="No students enrolled yet" hint="Publish the course and share it with your batch." />}

      {rows.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Student</th><th>Email</th><th>College</th><th>Progress</th><th>Lessons</th><th>Status</th><th>Enrolled</th><th>Last active</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><div className="row" style={{ gap: 10 }}><Avatar user={r} size={30} /><strong>{r.full_name}</strong></div></td>
                  <td className="small">{r.email}</td>
                  <td className="small">{r.college || '—'}</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="progress"><i style={{ width: `${Number(r.progress_percent)}%` }} /></div>
                    <span className="tiny muted">{Number(r.progress_percent)}%</span>
                  </td>
                  <td className="small">{r.completed_lessons}</td>
                  <td><span className={`badge ${r.status === 'completed' ? 'green' : 'cyan'}`}>{r.status}</span></td>
                  <td className="tiny muted">{timeAgo(r.enrolled_at)}</td>
                  <td className="tiny muted">{r.last_accessed_at ? timeAgo(r.last_accessed_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
