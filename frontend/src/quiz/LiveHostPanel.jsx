import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { miscApi, quizApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import { Badge, Countdown, Empty, Loader, StatusBadge, StatCard } from '../components/ui';
import JsonImportPrompt from '../components/JsonImportPrompt';
import Switch from '../components/Switch';
import { downloadJson, readJsonFile, safeJsonFilename, transferCount } from '../utils/jsonTransfer';
import { downloadBlobResponse } from '../utils/fileDownload';
import AiScoreBadge from '../components/AiScoreBadge';
import LiveProctorMonitor from './LiveProctorMonitor';

/** Live quiz control room: real-time participant count, progress and end control. */

/**
 * Proctoring at a glance for one participant.
 *
 * `camera_never_started` is called out separately and loudly: it means the
 * browser never reported a camera on a proctored quiz, which is a very
 * different thing from "the camera was on and nothing happened". Without
 * surfacing it, a student who blocks proctoring looks cleaner than an honest
 * one whose webcam hiccuped.
 */
function ProctorCell({ row }) {
  const flags = String(row.proctor_flags || '').split(',').filter(Boolean);
  const violations = Number(row.proctor_violations || 0);
  const cam = Number(row.proctor_camera);
  const scr = Number(row.proctor_screen);
  const never = flags.some((f) => f.endsWith('_never_started'));

  if (!cam && !scr && !violations) return <span className="tiny muted" title="Proctoring off, or this attempt predates it">—</span>;

  const objectOnly = flags.length > 0 && flags.every((f) => f.endsWith('_detected'));
  return (
    <div className="row wrap" style={{ gap: 4 }}>
      {never && <span className="badge red" title="No proctoring report was ever received from this student's browser">🚫 never started</span>}
      {!never && cam ? <span className="tiny" title="Camera reported">🎥</span> : null}
      {!never && scr ? <span className="tiny" title="Screen share reported">🖥</span> : null}
      {violations > 0 && !never && (
        <span className={`badge ${violations >= 3 ? 'red' : 'amber'}`} title={flags.join(', ')}>⚠ {violations}</span>
      )}
      {objectOnly && violations === 0 && (
        <span className="badge" title={`${flags.join(', ')} — advisory only, does not count as a violation`}>👀 review</span>
      )}
    </div>
  );
}

export default function LiveHostPanel({ scope = 'admin' }) {
  const { id } = useParams();
  const toast = useToast();
  const { user, can, hasRole } = useAuth();
  const { isOn } = useSettings();
  const savedRecordingEnabled = isOn('proctor_recording_enabled', false);
  /* Anti-cheat used to be admin-only, which meant the instructor actually
     running the exam had to call an admin to turn lockdown on. A developer
     granted `manage_anticheat` can now do it from here — and the switches
     belong to the quiz CREATOR, so each developer's quizzes run with their
     own anti-cheat choices instead of one platform-wide row. */
  const canGuardPermission = hasRole('admin') || can('manage_anticheat');
  const [quiz, setQuiz] = useState(null);
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [monitorError, setMonitorError] = useState(''); // visible monitor failure
  const [lastUpdated, setLastUpdated] = useState(null);  // proof the refresh worked
  const [tick, setTick] = useState(0);
  const [picker, setPicker] = useState(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const importInputRef = useRef(null);
  // tab-guard (anti-cheat) configuration — editable by admins and by
  // developers holding `manage_anticheat`, scoped to the quiz creator's own
  // settings; everyone else sees it read-only.
  const [guard, setGuard] = useState(null);
  const guardOwnerId = quiz ? Number(quiz.created_by) || null : null;
  const canGuard = canGuardPermission
    && (!guardOwnerId || hasRole('admin') || Number(user && user.id) === guardOwnerId);
  const base = scope === 'admin' ? '/admin' : '/developer';

  useEffect(() => {
    if (!quiz) return;
    const off = (v, dflt) => (v === undefined || v === null || v === '' ? dflt : ['0', 'false', 'no', 'off'].includes(String(v).toLowerCase()));
    const apply = (s) => setGuard({
      enabled: !off(s.tab_guard_enabled, false),
      max: Math.max(1, Number(s.tab_guard_max_violations) || 3),
      autoSubmit: !off(s.tab_guard_auto_submit, false),
      lockdown: !off(s.quiz_lockdown_enabled, false),
    });
    // Preferred: the quiz creator's EFFECTIVE anti-cheat (their overrides
    // over the admin defaults). Hosts without `manage_anticheat` cannot call
    // that endpoint, so fall back to the platform defaults from
    // /settings/public for their read-only view — the old behaviour.
    const fromPublic = () => miscApi.publicSettings()
      .then(({ data }) => apply(data.data || {})).catch(() => {});
    if (canGuardPermission) {
      miscApi.antiCheat(guardOwnerId || undefined)
        .then(({ data }) => apply((data.data && data.data.effective) || {}))
        .catch(fromPublic);
    } else {
      fromPublic();
    }
    /* eslint-disable-next-line */
  }, [quiz && quiz.id, guardOwnerId]);

  // Saved through the anti-cheat-scoped endpoint: admins pass straight
  // through, developers need `manage_anticheat`, and neither can reach the
  // rest of Website Settings from here. The write lands on the quiz
  // CREATOR's own anti-cheat settings (an admin hosting someone else's quiz
  // configures that developer, not the whole platform).
  const saveGuard = async (patch) => {
    const previous = guard;
    const next = { ...guard, ...patch };
    setGuard(next);
    const opts = guardOwnerId && Number(user && user.id) !== guardOwnerId ? { user_id: guardOwnerId } : {};
    try {
      await miscApi.updateAntiCheat({
        tab_guard_enabled: next.enabled ? '1' : '0',
        tab_guard_max_violations: String(next.max),
        tab_guard_auto_submit: next.autoSubmit ? '1' : '0',
        quiz_lockdown_enabled: next.lockdown ? '1' : '0',
      }, opts);
      toast.success('👁 Tab guard settings saved for this quiz\u2019s creator — live quizzes follow them instantly');
    } catch (e) {
      // The switch already moved optimistically; put it back so the UI never
      // claims a setting that the server rejected.
      setGuard(previous);
      toast.error(e.message);
    }
  };

  const loadPicker = async () => {
    try {
      const { data } = await quizApi.list({ limit: 50 });
      setPicker(data.data);
    } catch (e) { setError(e.message); }
  };

  const load = async () => {
    setRefreshing(true);
    try {
      const { data } = await quizApi.get(id);
      setQuiz(data.data);
      setError(''); // a successful read clears any earlier failure
      // live monitor is best-effort: if this single call fails (e.g. transient
      // error or an older schema), keep showing the page with the last data
      // instead of replacing the whole control room with an error box.
      if (['live', 'completed'].includes(data.data.status)) {
        try {
          const { data: l } = await quizApi.live(id);
          setLive(l.data);
          setMonitorError('');
          setLastUpdated(new Date());
        } catch (e) {
          // SURFACE the failure — a silent catch made the Refresh button
          // look "dead" while the monitor call was actually failing.
          setMonitorError(e && e.message ? e.message : 'monitor request failed');
        }
      } else {
        setMonitorError('');
        setLastUpdated(new Date());
      }
    } catch (e) { setError(e.message); } finally { setRefreshing(false); }
  };

  useEffect(() => { if (id) load(); else loadPicker(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (tick && id) load(); /* eslint-disable-next-line */ }, [tick]);

  const startLive = async (restart = false) => {
    const minutes = window.prompt(restart ? 'Re-open the lobby — duration in minutes' : 'Duration in minutes', quiz.time_limit_minutes || 10);
    if (!minutes) return;
    setBusy(true);
    try {
      await quizApi.startLive(id, { time_limit_minutes: Number(minutes) });
      toast.success(restart ? 'Lobby re-opened — students were notified again 📡' : 'Live lobby open — students can join now 📡');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  // Synchronized launch: every student already seated starts at the same instant.
  const startForAll = async () => {
    if (!window.confirm('Start the quiz for EVERYONE now? All joined students begin at the same moment and the timer starts together.')) return;
    setBusy(true);
    try {
      await quizApi.liveStartAll(id);
      toast.success('🚀 Quiz started for everyone — timers running in sync!');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const copyJoinLink = async () => {
    const url = `${window.location.origin}/quizzes/${id}/live`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Student join link copied — share it in your class chat');
    } catch (_) {
      window.prompt('Copy this link and share it with your students:', url);
    }
  };

  const endLive = async () => {
    if (!window.confirm('End the live quiz now? All running attempts are auto-submitted and graded.')) return;
    setBusy(true);
    try {
      const { data } = await quizApi.endLive(id);
      toast.success(`Ended — ${data.data.auto_submitted} attempt(s) auto-submitted`);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const exportJson = async (target) => {
    setTransferBusy(true);
    try {
      const { data } = target ? await quizApi.exportOne(target.id) : await quizApi.exportAll();
      const filename = target
        ? `${safeJsonFilename(target.title, 'live-quiz')}.json`
        : `smartodl-live-quizzes-${new Date().toISOString().slice(0, 10)}.json`;
      downloadJson(data.data, filename);
      toast.success(`${target ? 1 : transferCount(data.data)} quiz package(s) exported`);
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  /* Ranked standings as a real .xlsx — the sheet the host hands to the exam
     office. Built server-side so it always matches what the monitor shows. */
  const [excelBusy, setExcelBusy] = useState(false);
  const exportExcel = async () => {
    setExcelBusy(true);
    try {
      const res = await quizApi.resultsExcel(id);
      const name = downloadBlobResponse(res, `quiz-${id}-leaderboard.xlsx`);
      toast.success(`Leaderboard exported — ${name}`);
    } catch (e) { toast.error(e.message); } finally { setExcelBusy(false); }
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTransferBusy(true);
    try {
      const pack = await readJsonFile(file, 'quizzes');
      if (!window.confirm(`Import ${transferCount(pack)} live/normal quiz package(s) as new non-private drafts?`)) return;
      const { data } = await quizApi.importJson(pack);
      toast.success(`${data.data.imported_count} quiz(es) imported — open Quiz Management to review drafts`);
      await loadPicker();
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  if (error) return <div className="container section"><Empty title="Quiz not found" hint={error} /></div>;

  /* ------------------- no quiz selected: hosting overview ------------------- */
  if (!id) {
    if (!picker) return <Loader label="Loading quizzes…" />;
    const liveNow = picker.filter((z) => z.status === 'live');
    const ready = picker.filter((z) => z.status !== 'live' && Number(z.question_count || z.actual_question_count) > 0);
    return (
      <div className="container section">
        <div className="section-head between wrap">
          <div><span className="eyebrow">Live hosting</span><h2>Control room</h2>
            <p className="muted small">Open the live lobby, let students join, then start the quiz for everyone at the same moment.</p></div>
          {can('create_quiz') && <div className="row wrap" style={{ gap: 8 }}>
            <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
            <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={() => importInputRef.current?.click()}>⬆ Import Quiz JSON</button>
            <JsonImportPrompt defaultPrompt="live" />
            <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={() => exportJson(null)}>⬇ Export all JSON</button>
          </div>}
        </div>

        <div className="grid g4 mb">
          <StatCard icon="📡" label="Live right now" value={liveNow.length} hint="Quizzes students can join" />
          <StatCard icon="🧠" label="Ready to host" value={ready.length} hint="Quizzes with questions" />
          <StatCard icon="📴" label="Total quizzes" value={picker.length} hint="Across the platform" />
          <StatCard icon="⏱" label="Refresh" value="5s" hint="On the monitor screen" />
        </div>

        <div className="card mb">
          <h3>🔴 Live now</h3>
          {liveNow.length === 0 && <Empty title="No live quiz running" hint="Pick a quiz below and press Start live." />}
          <div className="stack" style={{ gap: 10 }}>
            {liveNow.map((z) => (
              <div className="between panel" key={z.id}>
                <div>
                  <Link className="link" style={{ fontWeight: 600 }} to={`${base}/live/${z.id}`}>{z.title}</Link>
                  <div className="tiny muted">{z.participant_count ?? 0} participants • {z.question_count || z.actual_question_count} questions</div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className={`tag ${z.end_at && new Date(z.end_at) < new Date() ? '' : 'tag-danger'}`}>
                    {z.end_at && new Date(z.end_at) < new Date() ? '⏰ window closed' : '🔴 joinable now'}
                  </span>
                  {can('create_quiz') && <button className="btn btn-sm btn-ghost" type="button" disabled={transferBusy} onClick={() => exportJson(z)}>⬇ JSON</button>}
                  <Link className="btn btn-sm btn-danger" to={`${base}/live/${z.id}`}>📊 Monitor</Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>📋 Pick a quiz to host</h3>
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead><tr><th>Quiz</th><th>Type</th><th>Questions</th><th>Time</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {picker.map((z) => (
                  <tr key={z.id}>
                    <td><strong>{z.title}</strong><div className="tiny muted">{(z.description || '').slice(0, 60)}</div></td>
                    <td><span className="tag">{z.quiz_type}</span></td>
                    <td>{z.question_count || z.actual_question_count}</td>
                    <td className="small">{z.time_limit_minutes} min</td>
                    <td><StatusBadge value={z.status} /></td>
                    <td><div className="row wrap" style={{ gap: 6 }}>
                      {can('create_quiz') && <button className="btn btn-sm btn-ghost" type="button" disabled={transferBusy} onClick={() => exportJson(z)}>⬇ JSON</button>}
                      <Link className="btn btn-sm btn-primary" to={`${base}/live/${z.id}`}>Open control room</Link>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {picker.length === 0 && <Empty title="No quizzes yet" hint="Create a quiz first, add questions, then host it live." />}
        </div>

        <div className="soft small mt">
          💡 Hosting flow: <strong>▶ Open live lobby</strong> → students join and wait → <strong>🚀 Start for everyone</strong> launches
          every attempt at the same moment with one shared timer → monitor progress live → <strong>⏹ End quiz &amp; grade</strong>.
          Late joiners share the same deadline, and <strong>🔄 Restart live session</strong> re-opens the lobby for a fresh round.
          <br />🔀 Question order and displayed numbering are assigned separately and remain stable for each student. With N questions,
          the first N participants cannot have the same underlying question at the same displayed question number.
        </div>
      </div>
    );
  }

  if (!quiz) return <Loader label="Opening control room…" />;

  const endsAt = quiz.end_at ? new Date(quiz.end_at).getTime() : null;
  const windowOpen = endsAt === null || endsAt > Date.now();
  const windowClosed = quiz.status === 'live' && !windowOpen;
  // Lobby phase: session is open (students are joining) but the host has not
  // pressed "Start for everyone" yet — nobody's timer is running.
  const lobbyOpen = quiz.status === 'live' && live && !live.quiz.live_started_at;
  const participants = (live && live.participants) || [];
  // Integrity review scores are admin-only; the API omits them entirely for
  // developer hosts and when the global review-score switch is OFF.
  const showIntegrityScore = hasRole('admin') && !!(live && live.quiz && live.quiz.integrity_score_enabled);
  /* Denominators for the monitor. `live.quiz.total_questions` is counted from
     quiz_questions by the API; quizzes.question_count can drift if questions
     were added or removed without syncQuizTotals, so prefer the counted one. */
  const totalQuestions = Number(
    (live && live.quiz && live.quiz.total_questions)
    || quiz.actual_question_count || quiz.question_count || 0,
  );
  const totalMarks = Number(
    (live && live.quiz && live.quiz.total_marks) || quiz.total_marks || 0,
  );
  const submitted = participants.filter((p) => p.status === 'evaluated').length;
  const avgScore = participants.filter((p) => p.status === 'evaluated').reduce((a, p) => a + Number(p.score || 0), 0) / (submitted || 1);

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          <Link className="link small" to={`${base}/quizzes`}>← All quizzes</Link>
          <h2 style={{ marginBottom: 4 }}>📡 {quiz.title}</h2>
          <div className="row wrap" style={{ gap: 8 }}>
            <StatusBadge value={quiz.status} />
            <span className="tag">{quiz.quiz_type}</span>
            <span className="tag">⏱ {quiz.time_limit_minutes} min</span>
            <span className="tag">{totalQuestions} questions</span>
            <span className="tag">🔀 individualized numbering</span>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={load} disabled={refreshing}>{refreshing ? '⏳ Refreshing…' : '🔄 Refresh'}</button>
          {lastUpdated && !monitorError && (
            <span className="tag" style={{ color: '#22c55e' }}>
              ✓ updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {monitorError && (
            <span className="tag" style={{ color: '#ef4444', fontWeight: 600 }}>
              ⚠ monitor error: {monitorError}
            </span>
          )}
          <button className="btn btn-ghost" onClick={copyJoinLink}>🔗 Copy student link</button>
          {can('create_quiz') && <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={() => exportJson(quiz)}>⬇ Export JSON</button>}
          {can('host_quiz') && quiz.status !== 'live' && <button className="btn btn-primary" disabled={busy} onClick={() => startLive(false)}>▶ Open live lobby</button>}
          {lobbyOpen && can('host_quiz') && (
            <button className="btn btn-primary" disabled={busy} onClick={startForAll} style={{ animation: 'pulse 2s infinite' }}>
              🚀 Start for everyone ({participants.length} joined)
            </button>
          )}
          {windowClosed && <button className="btn btn-primary" disabled={busy} onClick={() => startLive(true)}>🔄 Restart live session</button>}
          {quiz.status === 'live' && <button className="btn btn-danger" disabled={busy} onClick={endLive}>⏹ End quiz & grade</button>}
          <Link className="btn btn-ghost" to={`${base}/quizzes/${id}`}>🧠 Questions</Link>
        </div>
      </div>

      <div className="grid g4">
        <StatCard icon="👥" label="Participants" value={live ? live.participant_count : 0} hint="Attempts started" />
        <StatCard icon="✅" label="Submitted" value={submitted} hint={`${participants.length - submitted - ((live && live.left_count) || 0)} running · ${(live && live.left_count) || 0} left 🚪`} />
        <StatCard icon="🎯" label="Average score" value={Number(avgScore).toFixed(1)} hint="Among submitted" />
        <StatCard icon="⏱" label={windowClosed ? 'Window' : 'Time left'}
          value={quiz.status === 'live' ? (windowClosed ? 'closed' : '') : '—'}
          hint={quiz.end_at ? new Date(quiz.end_at).toLocaleTimeString() : ''} />
      </div>

      {quiz.status === 'live' && (
        <div className="card mt center">
          {lobbyOpen ? (
            <>
              <div style={{ fontSize: '2.4rem' }}>🕐</div>
              <h3 style={{ margin: '6px 0 2px' }}>Lobby open — {participants.length} student{participants.length === 1 ? '' : 's'} seated</h3>
              <p className="muted small" style={{ maxWidth: 560, margin: '0 auto' }}>
                Students are joining and waiting. No timer is running yet. When you press
                {' '}<strong>🚀 Start for everyone</strong>, the quiz begins for <em>all of them at the same moment</em> with one shared timer.
              </p>
              {can('host_quiz') && (
                <button className="btn btn-primary mt" disabled={busy} onClick={startForAll} style={{ fontSize: '1.05rem' }}>
                  🚀 Start quiz for everyone {participants.length > 0 ? `(${participants.length} ready)` : ''}
                </button>
              )}
              <div className="tiny muted mt-s">Late joiners after the start get the same shared deadline (no extra time).</div>
            </>
          ) : windowClosed ? (
            <>
              <div className="notice warn small" style={{ maxWidth: 640, margin: '0 auto' }}>
                ⏰ <strong>The live window has closed.</strong> Students who try to join are told to wait for a restart — press
                {' '}<strong>🔄 Restart live session</strong> to open a fresh window (students get a new notification).
              </div>
              <div className="tiny muted mt-s">Attempts that were still running are graded when you press ⏹ End quiz &amp; grade.</div>
            </>
          ) : (
            <>
              <div className="tiny muted">Quiz ends in</div>
              <Countdown target={quiz.end_at} onEnd={load} />
              <div className="tiny muted mt-s">
                🔴 Quiz started for everyone at the same moment — late joiners share this deadline. Auto-refreshing every 5 seconds.
              </div>
            </>
          )}
        </div>
      )}

      {/* ----------------- tab-guard (anti-cheat) controls ----------------- */}
      {/* Shown for every hosted quiz so the controls are visible even before
          the lobby opens; they apply to all live quiz sessions. */}
      {guard && (
        <div className="card mt">
          <div className="between mb-s wrap" style={{ gap: 6 }}>
            <h3 style={{ margin: 0 }}>👁 Tab guard (anti-cheat)</h3>
            <span className="tiny muted">
              {canGuard ? `applies to this quiz\u2019s creator (${(quiz && quiz.created_by_name) || 'the creator'}) — instantly` : 'read-only — only the quiz\u2019s creator (with the “Manage Anti-cheat” permission) or an admin can change this'}
            </span>
          </div>
          <div className="row wrap" style={{ gap: 22, alignItems: 'center' }}>
            <label className="row" style={{ gap: 8, cursor: canGuard ? 'pointer' : 'default', alignItems: 'center' }}>
              <Switch checked={guard.enabled} disabled={!canGuard} onChange={(value) => saveGuard({ enabled: value })} label="Enable tab guard" />
              <span className="small">Guard enabled</span>
            </label>
            <label className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="small">Max guard violations</span>
              <input className="input" type="number" min="1" max="20" defaultValue={guard.max} key={guard.max}
                disabled={!canGuard} style={{ width: 74, padding: '6px 8px' }}
                onBlur={(e) => { const v = Math.min(20, Math.max(1, Number(e.target.value) || 1)); if (v !== guard.max) saveGuard({ max: v }); }} />
            </label>
            <label className="row" style={{ gap: 8, cursor: canGuard ? 'pointer' : 'default', alignItems: 'center' }}>
              <Switch checked={guard.autoSubmit} disabled={!canGuard} onChange={(value) => saveGuard({ autoSubmit: value })} label="Auto-submit at violation limit" />
              <span className="small">Auto-submit at limit</span>
            </label>
            <label className="row" style={{ gap: 8, cursor: canGuard ? 'pointer' : 'default', alignItems: 'center' }}
              title="Fullscreen lockdown: students can't leave fullscreen; refresh and devtools are blocked. Copy-paste is a separate switch in Feature Control.">
              <Switch checked={guard.lockdown} disabled={!canGuard} onChange={(value) => saveGuard({ lockdown: value })} label="Enable fullscreen lockdown" />
              <span className="small">🔒 Fullscreen lockdown</span>
            </label>
            {!guard.enabled && !guard.lockdown && <span className="badge amber">⚠ anti-cheat is OFF — students can switch tabs freely</span>}
          </div>
        </div>
      )}

      <LiveProctorMonitor
        quizId={id}
        participants={participants}
        active={quiz.status === 'live' && !lobbyOpen}
      />
      {quiz.status === 'live' && !savedRecordingEnabled && (
        <div className="soft small mt" role="status">
          ⏺ Saved recording is currently OFF. An administrator must enable <strong>Feature Control → Saved Proctor Recordings</strong> before a new student attempt starts. The Advanced Proctoring master switch is separate.
        </div>
      )}

      <div className="card mt">
        <div className="between mb-s">
          <h3>Live participants</h3>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="tag">auto-refresh 5s</span>
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={exportExcel}
              disabled={excelBusy || participants.length === 0}
              title={participants.length === 0
                ? 'Nobody has joined yet'
                : 'Download the ranked leaderboard as an Excel workbook (scores, accuracy, timings and anti-cheat counters)'}
            >
              {excelBusy ? '⏳ Preparing…' : '⬇ Excel'}
            </button>
          </div>
        </div>
        {participants.length === 0 && <Empty title="No participants yet" hint="Students appear here the moment they join." />}
        {participants.length > 0 && (
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead><tr><th>Student</th><th>Status</th><th>Answered</th><th>Quiz score</th>{showIntegrityScore && <th title="Admin-only review indicator from tab-switch and proctor-violation counts; not a cheating verdict.">⚖ Integrity review</th>}<th>Accuracy</th><th title="Includes tab/window exits, fullscreen exits, and blocked screenshot shortcuts.">⚠ Guard violations</th><th title="Webcam / screen-share proctoring. Shows nothing when proctoring is switched off for this site.">🎥 Proctoring</th><th title="AI detection result, scored when the paper is submitted. Advisory only.">🤖 AI Detect</th><th>Progress</th></tr></thead>
              <tbody>
                {participants.map((p, i) => (
                  <tr key={i}>
                    <td><strong>{p.full_name}</strong></td>
                    <td>
                      {p.status === 'evaluated' ? <Badge tone="green">✓ submitted</Badge>
                        : p.presence === 'left' ? <Badge tone="red">🚪 left the quiz</Badge>
                        : <Badge tone="amber">in progress</Badge>}
                    </td>
                    <td>
                      <strong>{p.answered}</strong>
                      <span className="tiny muted"> / {totalQuestions}</span>
                    </td>
                    <td>
                      {p.status === 'evaluated'
                        ? <><strong>{Number(p.score)}</strong><span className="tiny muted"> / {totalMarks}</span></>
                        : <span className="tiny muted">—</span>}
                    </td>
                    {showIntegrityScore && (
                      <td title="Review indicator only — do not use as an automatic cheating verdict.">
                        {p.integrity_review && p.integrity_review.available
                          ? <strong className={`badge ${p.integrity_review.score >= 80 ? 'green' : p.integrity_review.score >= 50 ? 'amber' : 'red'}`}>{p.integrity_review.score}/100</strong>
                          : <span className="badge muted" title="No active or recorded monitoring evidence for this attempt">Insufficient data</span>}
                      </td>
                    )}
                    <td>
                      {p.status === 'evaluated'
                        ? `${Number(p.accuracy).toFixed(1)}%`
                        : <span className="tiny muted" title="Accuracy is calculated when the paper is submitted">—</span>}
                    </td>
                    <td>
                      {Number(p.tab_violations) > 0
                        ? <span className={`badge ${Number(p.tab_violations) >= 3 ? 'red' : 'amber'}`}>⚠ {p.tab_violations}</span>
                        : <span className="tiny muted">0</span>}
                    </td>
                    <td><ProctorCell row={p} /></td>
                    <td>
                      <AiScoreBadge row={p} detectOnly />
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <div className="progress" title={`${p.answered} of ${totalQuestions} answered`}>
                        <i style={{ width: `${Math.min(100, (Number(p.answered) / Math.max(1, totalQuestions)) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="soft small mt">⚙️ Hosting controls: start the quiz (students get a notification + live badge), watch answers come in, then end it — every running attempt is auto-submitted and ranked instantly.</div>
    </div>
  );
}
