import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { quizApi } from '../services/api';
import { downloadBlobResponse } from '../utils/fileDownload';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, Countdown, DiffBadge, Empty, ErrorBox, Loader, StatusBadge } from '../components/ui';
import PrivateQuizGate, { clearUnlock, getUnlock } from '../components/PrivateQuizGate';

export default function QuizDetail() {
  const { id } = useParams();
  const { user, hasRole } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [needPass, setNeedPass] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);

  /* Staff-only: the table below is capped at the top 10, while the workbook
     carries every attempt plus the columns we don't show publicly. */
  const exportExcel = async () => {
    setExcelBusy(true);
    try {
      const res = await quizApi.resultsExcel(id);
      const name = downloadBlobResponse(res, `quiz-${id}-leaderboard.xlsx`);
      toast.success(`Leaderboard exported — ${name}`);
    } catch (e) { toast.error(e.message); } finally { setExcelBusy(false); }
  };

  const load = async () => {
    try {
      const { data } = await quizApi.get(id);
      setQuiz(data.data);
      if (data.data.status === 'completed' || data.data.show_answers_after) {
        quizApi.results(id).then(({ data: r }) => setResults(r.data)).catch(() => {});
      }
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const start = async (unlockToken) => {
    if (!user) return navigate('/login', { state: { from: `/quizzes/${id}` } });
    const token = (typeof unlockToken === 'string' && unlockToken) || getUnlock(id);
    if (Number(quiz?.is_private) && !token) { setNeedPass(true); return; }
    setBusy(true);
    try {
      const { data } = await quizApi.start(id, token || undefined);
      if (data.data.already_submitted) { toast.info('You already submitted this quiz'); return; }
      navigate(`/quizzes/${id}/attempt/${data.data.attempt.id}`, { state: { started: data.data } });
    } catch (e) {
      if (Number(quiz?.is_private) && e.status === 403) {
        clearUnlock(id);
        setNeedPass(true);
      } else {
        toast.error(e.message);
      }
    } finally { setBusy(false); }
  };

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!quiz) return <Loader label="Loading quiz…" />;

  const last = quiz.last_attempt;
  const windowOpen = !quiz.end_at || new Date(quiz.end_at) > new Date();
  const liveNow = quiz.status === 'live' && windowOpen;
  const liveClosed = quiz.status === 'live' && !windowOpen;
  const scheduledOpen = quiz.status === 'scheduled' && quiz.quiz_type !== 'live'
    && (!quiz.start_at || new Date(quiz.start_at) <= new Date()) && windowOpen;
  const canStart = ((['published', 'live'].includes(quiz.status) && !liveClosed) || scheduledOpen);

  return (
    <div className="container section">
      <div className="split">
        <div>
          <div className="row wrap mb-s" style={{ gap: 8 }}>
            <StatusBadge value={quiz.status} /><DiffBadge value={quiz.difficulty} />
            <span className="tag">{quiz.quiz_type === 'live' ? '📡 live' : '📝 practice'}</span>
            {quiz.category_name && <span className="tag">{quiz.category_name}</span>}
          </div>
          <h1 style={{ fontSize: '1.9rem' }}>{quiz.title}</h1>
          <p className="muted">{quiz.description}</p>
          {(quiz.host_name || quiz.created_by_name) && (
            <p className="small muted" style={{ marginTop: 2 }}>
              {quiz.quiz_type === 'live' ? 'Hosted by' : 'Set by'}{' '}
              <strong style={{ color: 'var(--text)' }}>{quiz.host_name || quiz.created_by_name}</strong>
            </p>
          )}

          {liveNow && (
            <div className="verdict-box ok mt">
              <span style={{ fontSize: '1.4rem' }}>📡</span>
              <div>
                <div className="big">This quiz is live right now</div>
                <div className="small muted">Join from here or open the live page — your own timer starts when you join.</div>
              </div>
              <Link className="btn btn-primary" style={{ marginLeft: 'auto' }} to={`/quizzes/${quiz.id}/live`}>🚀 Join live quiz</Link>
            </div>
          )}
          {liveClosed && (
            <div className="notice warn mt small">
              ⏰ The live window for this session has closed. Ask your instructor to restart it — they can do it from the control room in one click.
            </div>
          )}

          <div className="grid g4 mt">
            {[['Questions', quiz.question_count || quiz.actual_question_count], ['Total marks', quiz.total_marks],
              ['Time limit', `${quiz.time_limit_minutes} min`], ['Passing score', `${quiz.passing_score}%`]]
              .map(([l, v]) => <div className="stat" key={l}><div className="v">{v}</div><div className="l">{l}</div></div>)}
          </div>

          <div className="card mt">
            <h3>Rules & instructions</h3>
            <div className="stack" style={{ gap: 8 }}>
              <span className="small">⏱ The timer starts the moment you begin and auto-submits when it hits zero.</span>
              <span className="small">➖ Negative marking: {Number(quiz.negative_marking) > 0 ? `${quiz.negative_marking} per wrong answer` : 'none'}</span>
              <span className="small">🔀 Questions {quiz.shuffle_questions ? 'are' : 'are not'} shuffled for each attempt.</span>
              <span className="small">🔁 {quiz.allow_reattempt ? 'Re-attempts allowed' : 'Single attempt only'}</span>
              <span className="small">👁 Answers revealed {quiz.show_answers_after ? 'after submission' : 'by the instructor'}</span>
              {quiz.max_participants && <span className="small">👥 Max participants: {quiz.max_participants}</span>}
            </div>
          </div>

          {results && results.length > 0 && (
            <div className="card mt">
              <div className="between mb-s">
                <h3>Ranking</h3>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="tag">{results.length} evaluated</span>
                  {hasRole('admin', 'developer') && (
                    <button className="btn btn-sm btn-ghost" type="button" onClick={exportExcel} disabled={excelBusy}
                      title="Download every attempt as an Excel workbook — the table here only shows the top 10">
                      {excelBusy ? '⏳ Preparing…' : '⬇ Excel'}
                    </button>
                  )}
                </div>
              </div>
              <div className="table-wrap" tabIndex={0}>
                <table className="table">
                  <thead><tr><th>#</th><th>Student</th><th>Score</th><th>Accuracy</th><th>Time</th></tr></thead>
                  <tbody>
                    {results.slice(0, 10).map((r) => (
                      <tr key={r.rank_position}>
                        <td><span className="tag">{r.rank_position <= 3 ? ['🥇', '🥈', '🥉'][r.rank_position - 1] : r.rank_position}</span></td>
                        <td>{r.full_name}</td>
                        <td><strong>{Number(r.score)}</strong>/{r.total_marks}</td>
                        <td>{Number(r.accuracy).toFixed(1)}%</td>
                        <td>{Math.floor(r.time_taken_seconds / 60)}m {r.time_taken_seconds % 60}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="stack" style={{ position: 'sticky', top: 84 }}>
          <div className="card center">
            <div style={{ fontSize: '2.4rem' }}>{quiz.status === 'live' ? '📡' : '🧠'}</div>
            {quiz.status === 'live' && <Countdown target={quiz.end_at} prefix="Time left" />}
            {!user && <p className="small muted">Login required to attempt this quiz.</p>}
            {last && last.status !== 'in_progress' && (
              <div className="soft mb-s">
                <div className="small">Your last attempt</div>
                <div style={{ fontWeight: 800, fontSize: '1.3rem' }}>{Number(last.score)}/{last.total_marks}</div>
                <div className="tiny muted">{Number(last.accuracy).toFixed(1)}% • rank #{last.rank_position || '—'} • {last.status}</div>
                <Link className="btn btn-sm btn-ghost mt-s" to={`/quizzes/attempts/${last.id}`}>View answer sheet</Link>
              </div>
            )}
            {quiz.premium_lock && (
              <>
                <div className="notice" style={{ textAlign: 'left' }}>
                  ⭐ <b>Premium quiz</b> — an active <b>subscription</b> is required to attempt it.
                </div>
                <Link className="btn btn-primary btn-block" to="/pricing">🚀 Get a plan and unlock</Link>
              </>
            )}
            {!quiz.premium_lock && (
            <button className="btn btn-primary btn-block" disabled={busy || !canStart} onClick={start}>
              {busy ? 'Starting…'
                : liveClosed ? 'Live window closed'
                  : !canStart ? `Quiz ${quiz.status}`
                    : last && last.status === 'in_progress' ? '▶ Resume attempt'
                      : liveNow ? '🚀 Join live quiz now' : 'Start quiz'}
            </button>
            )}
            {liveNow && <p className="tiny muted mt-s">🔴 Live right now — joining starts your personal timer.</p>}
            {liveClosed && <p className="tiny muted mt-s">⏰ This live session has closed. Your instructor can restart it — you will get a notification.</p>}
            {quiz.status === 'scheduled' && <p className="tiny muted mt-s">Opens automatically at the scheduled time.</p>}
            {!user && <Link className="btn btn-ghost btn-block mt-s" to="/login">Login</Link>}
          </div>
          <div className="soft small">
            🛡 Your answers are saved as you go. If the timer expires, the attempt is submitted automatically and graded instantly.
          </div>
        </div>
      </div>
      {results && results.length === 0 && <Empty title="No attempts yet" hint="Be the first to take this quiz." />}
      {needPass && <PrivateQuizGate quiz={quiz} onUnlocked={(t) => { setNeedPass(false); start(t); }} />}
    </div>
  );
}
