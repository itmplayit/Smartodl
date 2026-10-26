import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { contestApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar, Badge, Countdown, DiffBadge, Empty, ErrorBox, Loader, StatusBadge } from '../components/ui';

export default function ContestDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [contest, setContest] = useState(null);
  const [board, setBoard] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    try {
      const { data } = await contestApi.get(id);
      setContest(data.data);
      contestApi.leaderboard(id).then(({ data: b }) => setBoard(b.data)).catch(() => {});
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // realtime: standings refresh the moment any submission gets judged
  useEffect(() => {
    let timer = null;
    const onJudged = () => {
      if (!contest) return;
      const nowMs = Date.now();
      const started = !contest.start_at || new Date(contest.start_at).getTime() <= nowMs || contest.status === 'live';
      const finished = contest.status === 'completed' || (contest.end_at && new Date(contest.end_at).getTime() <= nowMs);
      if (!started || finished) return;
      clearTimeout(timer);
      timer = setTimeout(load, 600); // tiny debounce — bursts of submissions
    };
    window.addEventListener('smartodl:submission_judged', onJudged);
    return () => { window.removeEventListener('smartodl:submission_judged', onJudged); clearTimeout(timer); };
    /* eslint-disable-next-line */
  }, [contest && contest.status, id]);

  const register = async () => {
    if (!user) return navigate('/login', { state: { from: `/contests/${id}` } });
    setBusy(true);
    try {
      const { data } = await contestApi.register(id);
      toast.success(data.data.already ? 'You are already registered' : 'Registered! Good luck 🍀');
      await load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!contest) return <Loader label="Loading contest…" />;

  const startsIn = contest.start_at ? new Date(contest.start_at).getTime() - now : 0;
  const hasStarted = startsIn <= 0 || ['live', 'completed'].includes(contest.status);
  const ended = contest.status === 'completed' || (contest.end_at && new Date(contest.end_at).getTime() <= now);

  return (
    <div className="container section">
      <div className="split">
        <div>
          <div className="row wrap mb-s" style={{ gap: 8 }}>
            <StatusBadge value={contest.status} />
            <span className="tag">{contest.contest_type}</span>
            <span className="tag">🕘 {contest.duration_minutes} minutes</span>
            <span className="tag">👥 {contest.participant_count ?? contest.registered_count ?? 0} participants</span>
          </div>
          <h1 style={{ fontSize: '1.9rem' }}>{contest.title}</h1>
          <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{contest.description}</p>

          <div className="grid g4 mt">
            {[['Starts', new Date(contest.start_at).toLocaleString()], ['Ends', new Date(contest.end_at).toLocaleString()],
              ['Problems', contest.problems.length], ['Your status', contest.registered ? 'Registered' : 'Not registered']]
              .map(([l, v]) => <div className="stat" key={l}><div className="v" style={{ fontSize: '1rem' }}>{v}</div><div className="l">{l}</div></div>)}
          </div>

          <div className="card mt">
            <div className="between mb-s">
              <h3>Problem set</h3>
              {!hasStarted && <span className="tag">🔒 titles revealed when the contest starts</span>}
            </div>
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead><tr><th>#</th><th>Problem</th><th>Difficulty</th><th>Points</th><th>Solved by</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {contest.problems.map((p) => (
                    <tr key={p.label + p.position}>
                      <td><span className="tag">{p.label}</span></td>
                      <td>{p.locked ? <span className="muted">🔒 {p.title}</span> : <Link className="link" to={`/coding/${p.id}?contest=${contest.id}`}>{p.title}</Link>}</td>
                      <td>{p.locked ? <span className="tiny muted">—</span> : <DiffBadge value={p.difficulty} />}</td>
                      <td>{p.locked ? '—' : (p.points_override || p.points)}</td>
                      <td>{p.locked ? '—' : p.solved_count}</td>
                      <td>{!p.locked && hasStarted && !ended && contest.registered && <Link className="btn btn-sm btn-primary" to={`/coding/${p.id}?contest=${contest.id}`}>Solve</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {contest.problems.length === 0 && <Empty title="No problems added yet" />}
          </div>

          {ended && contest.editorial && (
            <div className="card mt">
              <h3>📝 Editorial</h3>
              <p className="muted small" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{contest.editorial}</p>
            </div>
          )}
          {!ended && <div className="soft small mt">📝 Editorial will be published after the contest ends.</div>}

          <div className="card mt">
            <h3>Standings</h3>
            {board.length === 0 ? <div className="empty">No submissions yet — the leaderboard fills up as participants solve problems.</div> : (
              <div className="table-wrap" tabIndex={0}>
                <table className="table">
                  <thead><tr><th>Rank</th><th>Participant</th><th>Solved</th><th>Score</th><th>Penalty</th><th>Last submission</th></tr></thead>
                  <tbody>
                    {board.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.rank_position <= 3 ? ['🥇', '🥈', '🥉'][r.rank_position - 1] : `#${r.rank_position}`}</strong></td>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <Avatar user={{ full_name: r.full_name, avatar: r.avatar }} size={30} />
                            <div><div style={{ fontWeight: 600 }}>{r.full_name}</div><div className="tiny muted">{r.college || '—'}</div></div>
                          </div>
                        </td>
                        <td>{r.solved_count}</td>
                        <td><strong>{r.score}</strong></td>
                        <td className="small">{r.penalty_minutes} min</td>
                        <td className="tiny muted">{r.last_submission_at ? new Date(r.last_submission_at).toLocaleTimeString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="stack" style={{ position: 'sticky', top: 84 }}>
          <div className="card center">
            <div style={{ fontSize: '2.4rem' }}>🏆</div>
            {ended ? (
              <>
                <Badge tone="cyan">Contest ended</Badge>
                <p className="small muted">Final standings are available on the left.</p>
              </>
            ) : hasStarted ? (
              <>
                <div className="tiny muted">Ends in</div>
                <Countdown target={contest.end_at} onEnd={load} />
                {contest.registered
                  ? <Link className="btn btn-primary btn-block mt" to={contest.problems[0] && contest.problems[0].id ? `/coding/${contest.problems[0].id}?contest=${contest.id}` : '#'}>Solve problems now</Link>
                  : <button className="btn btn-primary btn-block mt" disabled={busy} onClick={register}>{busy ? 'Registering…' : 'Register & compete'}</button>}
              </>
            ) : (
              <>
                <div className="tiny muted">Starts in</div>
                <Countdown target={contest.start_at} onEnd={load} />
                <button className="btn btn-primary btn-block mt" disabled={busy || contest.registered} onClick={register}>
                  {contest.registered ? '✓ Registered' : busy ? 'Registering…' : user ? 'Register now' : 'Login to register'}
                </button>
              </>
            )}
          </div>
          <div className="soft small">
            ℹ️ Contest rules: each solved problem carries points. Rankings use score, solved count, then earliest solve time. Hidden test cases decide acceptance.
          </div>
          <Link className="btn btn-ghost btn-block" to="/contests">← All contests</Link>
        </div>
      </div>
    </div>
  );
}
