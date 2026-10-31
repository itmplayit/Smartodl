import { useEffect, useState } from 'react';
import { courseApi, miscApi, contestApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Avatar, Empty, ErrorBox, Loader } from '../components/ui';
import { fmtNum } from '../utils/format';

const SCOPES = [['global', '🌍 Global'], ['weekly', '🗓 Weekly'], ['monthly', '📅 Monthly'], ['course', '📘 Course'], ['contest', '🏆 Contest']];

export default function Leaderboard() {
  const { user } = useAuth();
  const [scope, setScope] = useState('global');
  const [scopeRef, setScopeRef] = useState('');
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [courses, setCourses] = useState([]);
  const [contests, setContests] = useState([]);

  useEffect(() => {
    courseApi.list({ limit: 50 }).then(({ data }) => setCourses(data.data)).catch(() => {});
    contestApi.list().then(({ data }) => setContests(data.data)).catch(() => {});
  }, []);
  useEffect(() => { setScopeRef(''); }, [scope]);

  useEffect(() => {
    if (['course', 'contest'].includes(scope) && !scopeRef) { setRows(null); return; }
    setRows(null); setError('');
    miscApi.leaderboard({ scope, scope_ref: scopeRef || undefined, limit: 50 })
      .then(({ data }) => { setRows(data.data); setMeta(data.meta); })
      .catch((e) => setError(e.message));
  }, [scope, scopeRef]);

  const medal = (r) => (r <= 3 ? ['🥇', '🥈', '🥉'][r - 1] : `#${r}`);

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Rankings</span><h1>Leaderboard</h1>
          <p className="muted small">Computed from real submissions, quiz scores and earned points — refreshed automatically.</p></div>
        <h2 className="sr-only">Ranking table</h2>
        {meta && meta.my_rank && (
          <div className="card" style={{ minWidth: 200 }}>
            <div className="tiny muted">Your rank ({scope})</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{medal(meta.my_rank.rank_position)}</div>
            <div className="tiny muted">{fmtNum(meta.my_rank.points)} points • {meta.my_rank.problems_solved} solved</div>
          </div>
        )}
      </div>

      <div className="tabs">
        {SCOPES.map(([k, label]) => (
          <button key={k} className={`tab ${scope === k ? 'active' : ''}`} onClick={() => setScope(k)}>{label}</button>
        ))}
      </div>

      {['course', 'contest'].includes(scope) && (
        <div className="card mb mt">
          <label className="field" style={{ maxWidth: 380 }}>
            Select {scope === 'course' ? 'course' : 'contest'}
            <select className="select" value={scopeRef} onChange={(e) => setScopeRef(e.target.value)}>
              <option value="">Choose…</option>
              {(scope === 'course' ? courses : contests).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && <ErrorBox error={error} />}
      {!rows && !error && (['course', 'contest'].includes(scope) && !scopeRef
        ? <Empty title={`Pick a ${scope} to see its ranking`} />
        : <Loader label="Calculating rankings…" />)}

      {rows && rows.length > 0 && (
        <>
          <div className="grid g3 mb">
            {rows.slice(0, 3).map((r) => (
              <div className="card center" key={r.user_id} style={{ borderColor: r.rank_position === 1 ? 'rgba(250,204,21,.5)' : 'var(--border)' }}>
                <div style={{ fontSize: '2rem' }}>{medal(r.rank_position)}</div>
                <Avatar user={{ full_name: r.full_name, avatar: r.avatar }} size={54} />
                <h3 style={{ marginBottom: 0 }}>{r.full_name}</h3>
                <div className="tiny muted">{r.college || 'SmartODL'}</div>
                <div className="row mt-s" style={{ justifyContent: 'center', gap: 14 }}>
                  <span className="small">💎 {fmtNum(r.points ?? r.total_points)}</span>
                  <span className="small">✅ {r.problems_solved}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead>
                <tr><th>Rank</th><th>User</th><th>Problems Solved</th><th>Points</th><th>Submissions</th><th>Accuracy</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id || r.user_id} style={user && r.user_id === user.id ? { background: 'rgba(79,70,229,.12)' } : undefined}>
                    <td><strong>{medal(r.rank_position)}</strong></td>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar user={{ full_name: r.full_name, avatar: r.avatar }} size={32} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.full_name}{user && r.user_id === user.id ? ' (you)' : ''}</div>
                          <div className="tiny muted">{r.college || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td>{r.problems_solved}</td>
                    <td><strong>{fmtNum(r.points ?? r.total_points)}</strong></td>
                    <td>{r.submissions}</td>
                    <td>{Number(r.accuracy || 0).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {rows && rows.length === 0 && scopeRef && <Empty title="Nobody on this leaderboard yet" hint="Rankings appear as soon as submissions are evaluated." />}
    </div>
  );
}
