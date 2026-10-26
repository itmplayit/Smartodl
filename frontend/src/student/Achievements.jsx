import { useEffect, useState } from 'react';
import { miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Empty, ErrorBox, Loader } from '../components/ui';
import { timeAgo } from '../utils/format';

export default function Achievements() {
  const { user } = useAuth();
  const [all, setAll] = useState(null);
  const [mine, setMine] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [a, d] = await Promise.all([miscApi.achievements(), miscApi.studentDashboard()]);
      setAll(a.data.data);
      setMine(d.data.data.badges || []);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  if (error) return <div className="container section"><ErrorBox error={error} onRetry={load} /></div>;
  if (!all) return <Loader label="Loading achievements…" />;

  const earnedIds = mine.map((m) => m.id);

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Rewards</span><h2>Achievements & badges</h2>
          <p className="muted small">Badges unlock automatically as you learn, code and compete.</p></div>
        <div className="card center" style={{ minWidth: 160 }}>
          <div style={{ fontSize: '1.8rem' }}>🎖</div>
          <div style={{ fontWeight: 800, fontSize: '1.4rem' }}>{earnedIds.length} / {all.length}</div>
          <div className="tiny muted">badges earned</div>
        </div>
      </div>

      {mine.length > 0 && (
        <div className="card mb">
          <h3>Your recent unlocks</h3>
          <div className="row wrap" style={{ gap: 10 }}>
            {mine.map((b) => (
              <div className="soft row" key={b.id} style={{ gap: 10 }}>
                <span style={{ fontSize: '1.5rem' }}>{b.icon || '🏅'}</span>
                <div>
                  <strong className="small">{b.name}</strong>
                  <div className="tiny muted">{timeAgo(b.awarded_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid g3">
        {all.map((a) => {
          const owned = earnedIds.includes(a.id);
          return (
            <div className="card" key={a.id} style={{ opacity: owned ? 1 : 0.62, borderColor: owned ? 'rgba(34,197,94,.45)' : undefined }}>
              <div className="between mb-s">
                <span style={{ fontSize: '1.8rem' }}>{a.icon || '🏅'}</span>
                {owned ? <span className="badge green">✓ Unlocked</span> : <span className="badge">Locked</span>}
              </div>
              <h3 style={{ fontSize: '1rem' }}>{a.name}</h3>
              <p className="tiny muted">{a.description}</p>
              <div className="divider" />
              <div className="row wrap tiny muted" style={{ gap: 10 }}>
                <span>🎯 {a.criteria_type}: {a.criteria_value}</span>
                <span>💎 {a.points_reward} points</span>
                <span className="tag">{a.rarity || 'common'}</span>
              </div>
            </div>
          );
        })}
      </div>
      {all.length === 0 && <Empty title="No achievements configured" hint="An admin can create them from the admin panel." />}
      <div className="soft small mt">💡 Achievements are evaluated automatically after every quiz submission and accepted coding submission.</div>
    </div>
  );
}
