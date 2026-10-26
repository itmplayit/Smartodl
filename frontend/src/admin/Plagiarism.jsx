import { useEffect, useState } from 'react';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { Empty, Loader, Modal } from '../components/ui';

const pct = (s) => `${Math.round(s * 100)}%`;
const tone = (s) => (s >= 0.8 ? 'red' : s >= 0.65 ? 'amber' : 'cyan');

/** Similarity checker: flags submissions that look copied for a problem. */
export default function Plagiarism({ scope = 'admin' }) {
  const toast = useToast();
  const [problems, setProblems] = useState(null);
  const [problemId, setProblemId] = useState('');
  const [threshold, setThreshold] = useState(50);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState(null); // pair opened in modal

  useEffect(() => {
    api.get('/plagiarism/problems').then(({ data }) => setProblems(data.data)).catch((e) => { toast.error(e.message); setProblems([]); });
    /* eslint-disable-next-line */
  }, []);

  const run = async () => {
    if (!problemId) return;
    setBusy(true); setResult(null);
    try {
      const { data } = await api.get(`/plagiarism/check/${problemId}`, { params: { threshold: threshold / 100 } });
      setResult(data.data);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          <span className="eyebrow">Academic integrity</span>
          <h2>🕵 Similarity / plagiarism check</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Compares accepted submissions of a problem using token n-gram similarity. High % means code structure is nearly identical.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ minWidth: 280 }}>Problem
            <select className="select" value={problemId} onChange={(e) => setProblemId(e.target.value)}>
              <option value="">— choose a problem —</option>
              {(problems || []).map((p) => <option key={p.id} value={p.id}>#{p.id} {p.title} ({p.users} users)</option>)}
            </select>
          </label>
          <label className="field">Minimum similarity: <strong>{threshold}%</strong>
            <input type="range" min="30" max="90" step="5" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ width: 180 }} />
          </label>
          <button className="btn btn-primary" disabled={busy || !problemId} onClick={run}>{busy ? 'Checking…' : '🔍 Run check'}</button>
        </div>
      </div>

      {problems === null && <Loader label="Loading problems…" />}
      {problems && problems.length === 0 && <Empty title="Nothing to check" hint="At least 2 students need accepted submissions on the same problem." />}

      {result && (
        <div className="card mt">
          <div className="between mb-s">
            <h3 style={{ margin: 0 }}>Results</h3>
            <span className="tag">{result.checked} students compared • {result.pairs.length} suspicious pair{result.pairs.length === 1 ? '' : 's'}</span>
          </div>
          {result.pairs.length === 0 ? (
            <div className="empty">No pairs above {threshold}% — everything is clean ✅</div>
          ) : (
            <div className="table-wrap scroll-x">
              <table className="table">
                <thead><tr><th>Similarity</th><th>Student A</th><th>Student B</th><th>Languages</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {result.pairs.map((p, i) => (
                    <tr key={i}>
                      <td><span className={`badge ${tone(p.similarity)}`}>{pct(p.similarity)}</span></td>
                      <td><div style={{ fontWeight: 600 }}>{p.a.name}</div><div className="tiny muted">{p.a.email}</div></td>
                      <td><div style={{ fontWeight: 600 }}>{p.b.name}</div><div className="tiny muted">{p.b.email}</div></td>
                      <td className="small">{p.a.language} / {p.b.language}</td>
                      <td><button className="btn btn-sm btn-ghost" onClick={() => setInspect(p)}>👁 Compare code</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal open={!!inspect} title={`Similarity ${inspect ? pct(inspect.similarity) : ''}`} onClose={() => setInspect(null)} wide>
        {inspect && (
          <div className="grid g2">
            {[inspect.a, inspect.b].map((s, i) => (
              <div key={i}>
                <div className="between mb-s">
                  <strong className="small">{i === 0 ? 'A' : 'B'} · {s.name}</strong>
                  <span className="tag">{s.language}</span>
                </div>
                <pre className="code-block" style={{ maxHeight: 420, overflow: 'auto' }}>{s.source_code}</pre>
                <div className="tiny muted">{new Date(s.submitted_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
