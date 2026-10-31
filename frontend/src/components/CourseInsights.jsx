import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { courseApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { downloadBlobResponse } from '../utils/fileDownload';
import { Empty } from '../components/ui';

/**
 * Course-level insights for the instructor/admin — the Learning Path analytics
 * now live on the course itself. Everything shown here is derived from the
 * course's own lesson completion; nothing measures time spent or effort.
 */
export default function CourseInsights({ course }) {
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setFailed(false);
    // Insights are a bonus view: a failure must never break the course page.
    courseApi.analytics(course.id)
      .then(({ data: payload }) => { if (alive) setData(payload.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [course.id]);

  const exportReport = async () => {
    setExporting(true);
    try {
      const res = await courseApi.analyticsXlsx(course.id);
      downloadBlobResponse(res, `course-${course.slug || course.id}.xlsx`);
      toast.success('Course report downloaded');
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setExporting(false); }
  };

  if (failed) {
    return (
      <section className="card mt">
        <h3>📊 Course insights</h3>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Insights is account ke liye available nahi hain. Sirf course owner, admin, ya us course ko
          assigned developer dekh sakta hai — developer ko chahiye to admin se
          <b> View Student Data</b> permission enable karwayein.
        </p>
      </section>
    );
  }

  return (
    <section className="card mt">
      <div className="between wrap mb-s">
        <div>
          <h3 style={{ marginBottom: 4 }}>📊 Course insights</h3>
          <p className="tiny muted" style={{ margin: 0 }}>
            From learners’ lesson completion and enrolment status — not a measure of time spent or effort.
          </p>
        </div>
        {data && data.enrolled > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={exporting} onClick={exportReport}>
            {exporting ? 'Preparing…' : '⬇ Export report (Excel)'}
          </button>
        )}
      </div>

      {!data ? <p className="small muted" style={{ margin: 0 }}>Loading insights…</p>
        : data.enrolled === 0 ? (
          <Empty title="No learners yet" hint="Insights appear after the first enrolment." />
        ) : (
          <>
            <div className="grid g4 mb">
              <div className="panel"><div className="tiny muted">Enrolled</div><strong style={{ fontSize: 22 }}>{data.enrolled}</strong></div>
              <div className="panel"><div className="tiny muted">Completed</div><strong style={{ fontSize: 22 }}>{data.completed} <span className="tiny muted">({data.completion_rate}%)</span></strong></div>
              <div className="panel"><div className="tiny muted">Average progress</div><strong style={{ fontSize: 22 }}>{data.avg_progress}%</strong></div>
              <div className="panel"><div className="tiny muted">No access for {data.stall_days}+ days</div><strong style={{ fontSize: 22 }}>{data.stalled}</strong></div>
            </div>

            <p className="tiny muted">
              Health: <strong>{data.health}</strong> · Certificates issued: <strong>{data.certificates}</strong> ·
              Inactive learners are a nudge signal, never an automatic penalty.
            </p>

            <div className="table-wrap scroll-x">
              <table className="table">
                <thead><tr><th>#</th><th>Module</th><th>Lessons</th><th>Learners finished</th><th>Drop-off</th></tr></thead>
                <tbody>
                  {data.modules.map((module) => (
                    <tr key={module.module_id}>
                      <td>{module.position}</td>
                      <td style={{ minWidth: 220 }}>{module.title}</td>
                      <td>{module.lessons}</td>
                      <td>{module.reached}</td>
                      <td style={{ minWidth: 150 }}>
                        <div className="progress"><i style={{ width: `${Math.min(100, module.drop_rate)}%` }} /></div>
                        <span className="tiny muted">{module.drop_rate}% not finished</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny muted mt-s" style={{ marginBottom: 0 }}>
              A module counts as finished only when every lesson in it is complete — the same rule the
              course uses to mark itself complete. Modules aur lessons
              {' '}<Link className="link" to={user?.role === 'developer' ? '/developer/courses' : '/admin/modules'}>Modules &amp; Lessons</Link>{' '}
              se edit hote hain.
            </p>
          </>
        )}
    </section>
  );
}
