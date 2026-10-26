import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { quizApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Countdown, Empty, ErrorBox, Loader, StatusBadge } from '../components/ui';
import PrivateQuizGate, { clearUnlock, getUnlock } from '../components/PrivateQuizGate';

/** Turns a 403 from the join endpoint into an actionable next step. */
const reasonHint = (message = '') => {
  const m = message.toLowerCase();
  if (m.includes('already finished this live session')) return 'The host has to start the session again before you can attempt it a second time.';
  if (m.includes('full')) return 'All seats are taken right now — a seat frees up as soon as somebody submits their paper.';
  if (m.includes('closed')) return 'Ask your instructor to press “Restart live session” in the Live Quiz Hosting screen.';
  if (m.includes('not started') || m.includes('not open')) return 'This quiz is not live yet — you will get a notification the moment the host starts it.';
  if (m.includes('only student')) return 'You are signed in with a staff account. Open the quiz with a student account, or use Live Quiz Hosting to run the session.';
  if (m.includes('requires one of') || m.includes('permission')) return 'Your account role cannot join a quiz attempt — ask the admin for the right role or use a student account.';
  return 'Try again in a moment, or ask your instructor to check the session.';
};

/** Who is running this session: whoever pressed Start, else the quiz creator. */
function HostChip({ quiz }) {
  const name = quiz.host_name || quiz.created_by_name;
  if (!name) return null;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className="live-host-chip" title={`This live quiz is being hosted by ${name}`}>
      <span className="live-host-avatar" aria-hidden="true">{initials}</span>
      <span className="live-host-text">
        <span className="live-host-label">Hosted by</span>
        <strong className="live-host-name">{name}</strong>
      </span>
    </div>
  );
}

/** Student entry point for a live quiz: joins the attempt and hands over to the runner. */
export default function LiveQuiz() {
  const { id } = useParams();
  const { user, loading } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null); // { message, endAt, hint }
  const [joined, setJoined] = useState(null);       // attempt object once a lobby seat is taken
  const autoJoinTried = useRef(false);
  const [tick, setTick] = useState(0);
  const [needPass, setNeedPass] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate('/login', { state: { from: `/quizzes/${id}/live` } }); return; }
    let alive = true;
    quizApi.get(id).then(({ data }) => {
      if (!alive) return;
      setQuiz(data.data);
      setError('');
      // the host restarted (or the window moved) → last join error no longer applies
      setJoinError((prev) => (prev && prev.endAt !== data.data.end_at ? null : prev));
      // an attempt that is still running resumes straight into the runner —
      // EXCEPT during the live lobby phase, where the student stays seated and
      // waits for the host's synchronized start.
      if (data.data.last_attempt && data.data.last_attempt.status === 'in_progress') {
        const liveStarted = data.data.live && data.data.live.live_started_at;
        if (data.data.quiz_type !== 'live' || liveStarted) {
          navigate(`/quizzes/${id}/attempt/${data.data.last_attempt.id}`, { replace: true });
        } else {
          setJoined(data.data.last_attempt);
        }
      }
    }).catch((e) => setError(e.message));
    return () => { alive = false; };
    /* eslint-disable-next-line */
  }, [id, user, loading, tick]);

  // Live quiz lobby: take a seat automatically so the student is ready the
  // instant the host presses "Start for everyone".
  useEffect(() => {
    if (!quiz || quiz.quiz_type !== 'live' || quiz.status !== 'live') return;
    if (quiz.live && quiz.live.live_started_at) return; // already started → manual join below
    if (joinError || joined) return;
    if (Number(quiz.is_private) && !getUnlock(id)) { setNeedPass(true); return; }
    if (quiz.last_attempt && quiz.last_attempt.status === 'in_progress') { setJoined(quiz.last_attempt); return; }
    if (autoJoinTried.current) return;
    autoJoinTried.current = true;
    quizApi.start(id, getUnlock(id) || undefined).then(({ data }) => {
      const payload = data.data;
      if (payload.already_submitted) { toast.info('You have already attempted this quiz'); return; }
      setJoined(payload.attempt);
    }).catch((e) => {
      autoJoinTried.current = false;
      setJoinError({ message: e.message, endAt: quiz ? quiz.end_at : null, hint: reasonHint(e.message) });
    });
    /* eslint-disable-next-line */
  }, [quiz, id]);

  // Keep checking while the session is live, so the host's synchronized start
  // (or a restart / window change) shows up within seconds, no refresh needed.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 4000);
    return () => clearInterval(t);
  }, []);

  // realtime: the moment the host ends/restarts the session, refresh instantly
  useEffect(() => {
    const onLive = (e) => {
      const d = e.detail || {};
      if (String(d.quiz_id) === String(id)) setTick((x) => x + 1);
    };
    window.addEventListener('smartodl:live_quiz', onLive);
    return () => window.removeEventListener('smartodl:live_quiz', onLive);
  }, [id]);

  const join = async (token) => {
    if (quiz && Number(quiz.is_private)) {
      token = (typeof token === 'string' && token) || getUnlock(id);
      if (!token) { setNeedPass(true); return; }
    }
    setJoining(true);
    try {
      const { data } = await quizApi.start(id, token);
      const payload = data.data;
      if (payload.already_submitted) { toast.info('You have already attempted this quiz'); return navigate('/student/results'); }
      // Lobby phase: joining only takes a seat. Stay in the waiting room —
      // entering the runner now would open the paper before the host's
      // synchronized "Start for everyone" (the poll above jumps in then).
      const lobbyWaiting = payload.lobby
        || (payload.quiz && payload.quiz.quiz_type === 'live' && payload.quiz.status === 'live' && !payload.quiz.live_started_at);
      if (lobbyWaiting) { setJoined(payload.attempt); setJoinError(null); return; }
      navigate(`/quizzes/${id}/attempt/${payload.attempt.id}`, { state: { started: payload } });
    } catch (e) {
      if (quiz && Number(quiz.is_private) && e.status === 403) {
        clearUnlock(id);
        setNeedPass(true);
      }
      // keep the reason on screen (toasts disappear) and explain what to do next
      setJoinError({ message: e.message, endAt: quiz ? quiz.end_at : null, hint: reasonHint(e.message) });
      toast.error(e.message);
      setTick((x) => x + 1); // re-read the quiz: the host may have ended or restarted it
    } finally { setJoining(false); }
  };

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!quiz) return <Loader label="Checking the live session…" />;

  // Server clock can differ from the browser, and MySQL time_zone quirks (e.g.
  // XAMPP on IST returning local wall-clock that the driver decodes as UTC)
  // can skew start_at/end_at by a fixed offset. We trust `status === 'live'`
  // from the server as the source of truth. `live.ends_at` from the server
  // (if present) is more reliable than `end_at` because it is emitted with
  // server_time in the same breath, giving us a clock-offset hint.
  const serverTime = quiz.live && quiz.live.server_time ? new Date(quiz.live.server_time).getTime() : null;
  const clockOffset = serverTime ? serverTime - Date.now() : 0;
  const endsRaw = (quiz.live && quiz.live.ends_at) || quiz.end_at;
  const endsAt = endsRaw ? new Date(endsRaw).getTime() - clockOffset : null;
  // A quiz is joinable when the server marked it 'live' AND the window has not
  // ended. A 5-minute grace covers any startup-timezone skews where end_at
  // looks a few minutes in the past right after a host restart.
  const GRACE = 5 * 60 * 1000;
  const windowOpen = endsAt === null || endsAt + GRACE > Date.now();
  const live = quiz.status === 'live' && windowOpen;
  const liveWindowClosed = quiz.status === 'live' && !windowOpen;
  const liveStarted = live && !!(quiz.live && quiz.live.live_started_at); // host pressed "Start for everyone"
  const lobby = live && !liveStarted;                                      // seated, waiting for the synchronized start
  const inProgress = quiz.last_attempt && quiz.last_attempt.status === 'in_progress';

  return (
    <div className="container section">
      <div className="card center" style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ fontSize: '3rem' }}>{lobby ? '🕐' : live ? '📡' : '⏳'}</div>
        <div className="between mb-s"><StatusBadge value={quiz.status} /><span className="tag">{quiz.quiz_type}</span></div>
        <h1 style={{ fontSize: '1.7rem' }}>{quiz.title}</h1>
        <p className="muted small">{quiz.description}</p>
        <HostChip quiz={quiz} />

        {joinError && (
          <div className="notice warn mt small" style={{ textAlign: 'left' }}>
            <strong>Could not join:</strong> {joinError.message}
            <div className="tiny" style={{ marginTop: 4 }}>💡 {joinError.hint}</div>
            <div className="row mt-s" style={{ justifyContent: 'center' }}>
              <button className="btn btn-sm btn-ghost" disabled={joining} onClick={() => { setJoinError(null); join(); }}>🔄 Try again</button>
            </div>
          </div>
        )}

        {live ? (
          <>
            <div className="grid g3 mt">
              {[['Questions', quiz.question_count || quiz.actual_question_count], ['Total marks', quiz.total_marks], ['Time', `${quiz.time_limit_minutes} min`]]
                .map(([l, v]) => <div className="stat" key={l}><div className="v">{v}</div><div className="l">{l}</div></div>)}
            </div>
            {lobby ? (
              joined ? (
                <div className="mt" style={{ padding: '14px 0 4px' }}>
                  <div style={{ fontSize: '2.4rem' }}>✅</div>
                  <h3 style={{ margin: '8px 0 4px' }}>
                      You&apos;re in! Waiting for {quiz.host_name || quiz.created_by_name || 'the host'}…
                    </h3>
                  <p className="muted small" style={{ maxWidth: 470, margin: '0 auto' }}>
                    The quiz starts for <strong>everyone at the same moment</strong> when the host presses Start.
                    Your timer begins then too — this page jumps into the quiz automatically. Stay on this tab!
                  </p>
                  <span className="tag mt" style={{ display: 'inline-block' }}>🔴 Lobby live · updates in ~4s</span>
                </div>
              ) : (
                <>
                  <button className="btn btn-primary btn-block mt" disabled={joining} onClick={join}>
                    {joining ? 'Joining…' : '🚀 Join live quiz now'}
                  </button>
                  <p className="tiny muted mt-s">The timer starts only when the host starts the quiz for everyone — not when you join.</p>
                </>
              )
            ) : (
              <>
                <div className="mt"><Countdown target={quiz.end_at} prefix="Ends in" onEnd={() => setTick((x) => x + 1)} /></div>
                <button className="btn btn-primary btn-block mt" disabled={joining} onClick={join}>
                  {joining ? 'Joining…' : inProgress ? '▶ Resume my attempt' : '🚀 Join live quiz now'}
                </button>
                <p className="tiny muted mt-s">The quiz already started for everyone — you join with the same shared timer.</p>
              </>
            )}
          </>
        ) : liveWindowClosed ? (
          <>
            <div className="notice warn mt small">
              ⏰ The live window for this session has closed. Your instructor can restart it — this page refreshes itself every
              10 seconds, so the join button will come back automatically.
            </div>
            <div className="row mt" style={{ justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={() => setTick((x) => x + 1)}>🔄 Check again</button>
            </div>
          </>
        ) : (
          <Empty title={quiz.status === 'completed' ? 'This live quiz has ended' : 'This live quiz is not currently live'}
            hint={quiz.status === 'completed'
              ? 'Check the results and ranking on the quiz page.'
              : quiz.status === 'live'
                ? 'The live window appears closed — your instructor can restart it. This page refreshes every 10 seconds.'
                : quiz.start_at && new Date(quiz.start_at).getTime() - clockOffset > Date.now()
                  ? `It opens on ${new Date(new Date(quiz.start_at).getTime() - clockOffset).toLocaleString()} — you will also get a notification when the host starts it.`
                  : 'You will get a notification the moment the host starts it — this page updates by itself.'} />
        )}

        {live && (
          <p className="tiny muted mt-s">
            🔴 Live now · this page refreshes every 4 seconds
            {quiz.last_attempt && quiz.last_attempt.status !== 'in_progress'
              ? ' · you already finished this session, the host must start it again for another try'
              : ''}
          </p>
        )}

        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-ghost" to={`/quizzes/${quiz.id}`}>Quiz details</Link>
          <Link className="btn btn-ghost" to="/quizzes">All quizzes</Link>
        </div>
      </div>
      {needPass && <PrivateQuizGate quiz={quiz} onUnlocked={(t) => { setNeedPass(false); autoJoinTried.current = false; join(t); }} />}
    </div>
  );
}
