import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { contestApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Countdown, Empty, ErrorBox, Loader, StatusBadge } from '../components/ui';

export default function Contests() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');

  useEffect(() => {
    setRows(null);
    contestApi.list().then(({ data }) => setRows(data.data)).catch((e) => setError(e.message));
  }, []);

  const list = (rows || []).filter((c) => (tab === 'all' ? true : tab === 'live' ? c.status === 'live' : tab === 'upcoming' ? ['scheduled', 'published'].includes(c.status) : c.status === 'completed'));

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Compete</span><h1>Coding contests</h1>
          <p className="muted small">Timed contests with hidden test data, live leaderboards and points that count toward your rating.</p></div>
      </div>

      <div className="tabs">
        {[['all', 'All'], ['live', '🔴 Live'], ['upcoming', 'Upcoming'], ['completed', 'Past contests']].map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {error && <ErrorBox error={error} />}
      {!rows && !error && <Loader label="Loading contests…" />}
      {rows && list.length === 0 && <Empty title="No contests in this tab" hint="Contest notifications arrive the moment a host publishes one." />}

      <div className="grid g2 mt">
        {list.map((c) => (
          <Link to={`/contests/${c.id}`} key={c.id} className="card hover">
            <div className="between mb-s">
              <div className="row" style={{ gap: 8 }}>
                <StatusBadge value={c.status} />
                <span className="tag">{c.contest_type}</span>
              </div>
              <span className="tiny muted">{c.problem_count} problems</span>
            </div>
            <h3>{c.title}</h3>
            <p className="muted small">{(c.description || '').slice(0, 150)}</p>
            <div className="row wrap tiny muted mt-s" style={{ gap: 12 }}>
              <span>🕘 {c.duration_minutes} min</span>
              <span>👥 {c.participant_count ?? c.registered_count ?? 0} participants</span>
              {c.registered && <span className="badge green">✓ registered</span>}
              <span>Starts {new Date(c.start_at).toLocaleString()}</span>
            </div>
            <div className="divider" />
            {c.status === 'live'
              ? <div className="row" style={{ gap: 10 }}><span className="badge red">● LIVE NOW</span><Countdown target={c.end_at} compact onEnd={() => contestApi.list().then((r) => setRows(r.data.data))} /></div>
              : c.status === 'completed' ? <span className="small muted">Ended — view final standings →</span>
                : <Countdown target={c.start_at} prefix="Starts in" compact />}
            <div className="row mt" style={{ gap: 8 }}>
              <span className="btn btn-sm btn-primary">Open contest</span>
              {!user && <span className="tiny muted">login required to register</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
