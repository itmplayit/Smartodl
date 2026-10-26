import { useEffect, useState } from 'react';
import { miscApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Avatar, Empty, Loader } from '../components/ui';
import { fmtNum } from '../utils/format';

const SCOPES = [['global', '🌍 Global'], ['weekly', '🗓 Weekly'], ['monthly', '📅 Monthly']];

export default function LeaderboardManager() {
  const toast = useToast();
  const [scope, setScope] = useState('global');
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const { data } = await miscApi.leaderboard({ scope, limit: 100 }); setRows(data.data); setMeta(data.meta); }
    catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [scope]);

  const refresh = async () => {
    setBusy(true);
    try { await miscApi.refreshLeaderboard(); toast.success('Leaderboard recalculated from live data'); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Rankings</span><h2>Leaderboard administration</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Rankings are derived from real submissions, quiz scores and points — recalculate any time.</p></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={load}>🔄 Reload</button>
          <button className="btn btn-primary" disabled={busy} onClick={refresh}>{busy ? 'Recalculating…' : '♻️ Recalculate now'}</button>
        </div>
      </div>

      <div className="tabs">
        {SCOPES.map(([k, label]) => (
          <button key={k} className={`tab ${scope === k ? 'active' : ''}`} onClick={() => setScope(k)}>{label}</button>
        ))}
      </div>

      {!rows && <Loader label="Loading leaderboard…" />}
      {rows && rows.length === 0 && <Empty title="Leaderboard is empty" hint="Press Recalculate now to build it from the current data." />}

      {rows && rows.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Rank</th><th>User</th><th>Role</th><th>Points</th><th>Problems solved</th><th>Submissions</th><th>Accuracy</th><th>Quizzes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.rank_position <= 3 ? ['🥇', '🥈', '🥉'][r.rank_position - 1] : `#${r.rank_position}`}</strong></td>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <Avatar user={{ full_name: r.full_name, avatar: r.avatar }} size={30} />
                      <div><div style={{ fontWeight: 600 }}>{r.full_name}</div><div className="tiny muted">{r.college || '—'}</div></div>
                    </div>
                  </td>
                  <td><span className="tag">{r.role}</span></td>
                  <td><strong>{fmtNum(r.points ?? r.total_points)}</strong></td>
                  <td>{r.problems_solved}</td>
                  <td>{r.submissions}</td>
                  <td>{Number(r.accuracy || 0).toFixed(1)}%</td>
                  <td>{r.quizzes_completed ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.my_rank && (
        <div className="soft small mt">Your own standing: rank #{meta.my_rank.rank_position} with {fmtNum(meta.my_rank.points)} points.</div>
      )}
      <div className="soft small mt">🧮 Recalculation writes fresh global, weekly and monthly snapshots; contest and course leaderboards are computed live from their own data.</div>
    </div>
  );
}
