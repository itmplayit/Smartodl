import { useEffect, useMemo, useState } from 'react';
import { quizApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Empty, Loader } from '../components/ui';

export default function IntegrityScores() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      const { data } = await quizApi.adminIntegrityScores({ limit: 1000 });
      setRows(data.data || { enabled: true, rows: [] });
    } catch (error) { toast.error(error.message); setRows({ enabled: true, rows: [] }); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const visible = useMemo(() => {
    const list = (rows && rows.rows) || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => [row.student_name, row.student_email, row.quiz_title, row.status]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [rows, search]);

  if (!rows) return <Loader label="Loading integrity review scores…" />;
  return (
    <div className="container section">
      <div className="section-head between wrap" style={{ gap: 12 }}>
        <div>
          <span className="eyebrow">Admin only</span>
          <h2>⚖️ Exam Integrity Review Scores</h2>
          <p className="muted small" style={{ maxWidth: 820 }}>
            A transparent review indicator from recorded tab-switch and proctor-violation counts—not a finding of cheating or a probability. Current penalty settings apply to past attempts too. Use <strong>Insufficient data</strong> when the attempt has no monitoring evidence.
          </p>
        </div>
        <button className="btn" type="button" onClick={load}>↻ Refresh</button>
      </div>

      {!rows.enabled ? (
        <div className="card"><strong>Integrity score is OFF</strong><div className="tiny muted">Turn on “Student integrity review score” in Feature Control to display scores.</div></div>
      ) : (
        <>
          <div className="row wrap mb-s" style={{ gap: 10 }}>
            <input className="input" style={{ maxWidth: 360 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student or quiz…" aria-label="Search integrity scores" />
            <span className="tiny muted">{visible.length} attempt(s)</span>
          </div>

          {visible.length === 0 ? <Empty title="No matching attempts" hint="Scores appear when attempts have recorded monitoring data." /> : (
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>Student</th><th>Quiz</th><th>Status</th><th>Review score</th><th>Tab switches</th><th>Proctor violations</th><th>Score calculation</th><th>Started</th></tr></thead>
                <tbody>{visible.map((row) => (
                  <tr key={row.attempt_id}>
                    <td><strong>{row.student_name}</strong><div className="tiny muted">{row.student_email}</div></td>
                    <td>{row.quiz_title}<div className="tiny muted">Attempt #{row.attempt_id} · {row.quiz_type}</div></td>
                    <td><span className="badge">{String(row.status || '').replace('_', ' ')}</span></td>
                    <td>{row.available
                      ? <strong className={`badge ${row.score >= 80 ? 'green' : row.score >= 50 ? 'amber' : 'red'}`}>{row.score}/100</strong>
                      : <span className="badge muted">Insufficient data</span>}</td>
                    <td>{row.tab_violations}</td>
                    <td>{row.proctor_violations}</td>
                    <td className="tiny">{row.available
                      ? (row.deductions.length
                        ? row.deductions.map((item) => <div key={item.key}>{item.key === 'tab_switches' ? 'Tab switches' : 'Proctor violations'}: {item.count} × {item.points_each} = −{item.points}</div>)
                        : 'No deductions from recorded counters.')
                      : 'No active/recorded monitoring evidence.'}</td>
                    <td className="tiny">{row.started_at ? new Date(row.started_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="soft small mt">AI-use estimates, advisory detections, recording consent choices, and technical failures are not part of this score. A low score is a prompt for human review only; it must not trigger automatic penalties.</div>
        </>
      )}
    </div>
  );
}
