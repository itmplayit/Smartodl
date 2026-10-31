import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { quizApi, tokens } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import QRCode from 'qrcode';
import { Badge, Empty, ErrorBox, Loader } from '../components/ui';
// Monaco is several MB — load it only when a coding question actually opens,
// so MCQ-only attempts never pay for the editor.
const CodeEditor = lazy(() => import('../components/CodeEditor'));
import useTypingTelemetry from '../hooks/useTypingTelemetry';
import useProctoring from '../hooks/useProctoring';
import ProctorRecordingCapture from '../quiz/ProctorRecordingCapture';
import { LANGS } from '../utils/constants';
import { clock } from '../utils/format';
import { lcText } from '../utils/lctext';
import { useVerticalSplit, useHorizontalSplit } from '../hooks/useSplitPane';

const asArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : [p]; } catch { return [v]; }
  }
  return [v];
};

const isAnswered = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '');
/** correct_answer arrives as a JSON string from the DB — unwrap it safely. */
const parseJson = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
/** Frozen per-attempt proctor policy (object from the API, or JSON on the row). */
const parseProctorPolicy = (v) => {
  const parsed = parseJson(v);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
};
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const normEq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const codeOf = (value) => (typeof value === 'string' ? value : '');
const langName = (slug) => (LANGS.find((l) => l.slug === slug) || { name: slug }).name;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const starterOf = (q, language) => {
  const map = q && typeof q.starter_code === 'object' && q.starter_code ? q.starter_code : {};
  return map[language] || '';
};
/** True when the editor still holds the untouched starter template. */
const isTemplateOnly = (q, code, language) => {
  const text = codeOf(code).trim();
  return text !== '' && text === starterOf(q, language).trim();
};

/* ============================================================
 *  In-quiz compiler: language picker, Run code, test-case verdict
 *  Code is executed by the sandboxed judge on the server, never here.
 * ============================================================ */
function CodingAnswer({ q, code, language, onCode, onLanguage, onPaste, run, onRun, onReset, split = false }) {
  // results console is resizable from its top edge, like the arena's
  const { size: consoleH, startDrag: dragConsole, reset: resetConsole } = useHorizontalSplit({ initial: 250, min: 96, max: 460 });
  const langs = asArray(q.coding_languages).length ? asArray(q.coding_languages) : ['python'];
  const tests = asArray(q.test_cases);
  const publicTests = tests.filter((t) => !t.hidden);
  const hiddenTests = tests.length - publicTests.length;
  const results = run?.results || [];
  const resultAt = (index) => results.find((r) => r.index === index);
  const running = !!run?.running;
  const ranEveryCase = !!run?.ran && run.total === tests.length;
  const passedAll = ranEveryCase && run.passed === run.total;
  const showConsole = !!run;

  return (
    // `lc-skin` gives the in-quiz compiler the same LeetCode surface, Monaco
    // chrome and pill styling as the Coding Arena. In `split` mode it is the
    // right-hand pane of a two-column arena layout and fills the column; the
    // stacked (non-split) form is kept for narrow screens.
    <div className={split ? 'qz-compiler lc-skin' : 'mt lc-skin'}>
      <div className="qz-compiler-head">
        <span className="small muted">
          🧪 {tests.length} test case{tests.length === 1 ? '' : 's'} · {publicTests.length} visible · {hiddenTests} hidden
          {' · '}pass every case to earn {q.marks} mark{Number(q.marks) === 1 ? '' : 's'}
        </span>
        <span className="tiny muted">Time limit {(Number(q.time_limit_ms) || 2000) / 1000}s · Memory {Math.round((Number(q.memory_limit_kb) || 262144) / 1024)} MB</span>
      </div>

      <div className="code-panel">
        <Suspense fallback={<div className="loading"><div className="spinner" /><p className="muted mt-s">Loading the editor…</p></div>}>
        <CodeEditor
          language={language}
          languages={langs}
          starter={typeof q.starter_code === 'object' && q.starter_code ? q.starter_code : {}}
          code={code}
          onCode={onCode}
          onLanguage={onLanguage}
          onPaste={onPaste}
          height={split ? undefined : "310px"}
          actions={(
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onReset} disabled={running}>↺ Reset</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={onRun} disabled={running || !tests.length}>
                {running ? '⏳ Judging…' : '▶ Run code'}
              </button>
            </div>
          )}
        />
        </Suspense>
        <div className="run-strip">
          <span className="run-count">
            Test cases run: <strong>{ranEveryCase ? `${run.total}/${tests.length}` : `0/${tests.length}`}</strong>
            {ranEveryCase && <> · passed <strong>{run.passed}</strong></>}
            {run?.time_sec ? <> · {Number(run.time_sec).toFixed(3)}s</> : null}
            {run?.memory_mb ? <> · {Number(run.memory_mb).toFixed(1)} MB</> : null}
          </span>
          {!tests.length ? (
            <span className="gate-pill pending">⚠ no test cases configured — graded manually</span>
          ) : ranEveryCase ? (
            passedAll
              ? <span className="gate-pill ok">✓ all test cases run — you can submit</span>
              : <span className="gate-pill bad">✗ all cases run, {run.total - run.passed} failing</span>
          ) : (
            <span className="gate-pill pending">run all test cases to unlock submit</span>
          )}
        </div>
      </div>

      {/* The results pane only exists once the student has run something, so the
          editor owns the whole column until then — same as the arena. `run` is
          set the moment Run code is pressed, so the pane opens with the
          in-progress state and stays for the verdict. */}
      {showConsole && split && (
        <div className="lc-divider-h qz-divider-h" onPointerDown={dragConsole}
             onDoubleClick={resetConsole} title="Drag to resize · double-click to reset" />
      )}
      {showConsole && (
      <div className="qz-console" style={split ? { height: consoleH } : undefined}>
      {run && !running && (
        <div className={`verdict-box ${passedAll ? 'ok' : run.verdict === 'wrong_answer' || run.verdict === 'time_limit_exceeded' || run.verdict === 'runtime_error' || run.verdict === 'memory_limit_exceeded' ? 'bad' : 'warn'}`}>
          <span style={{ fontSize: '1.5rem' }}>{passedAll ? '✅' : run.verdict === 'compilation_error' ? '🧨' : '❌'}</span>
          <div>
            <div className="big">{run.verdict_label}</div>
            <div className="small muted">
              {run.passed} / {run.total} test cases passed
              {run.time_sec ? ` · Time: ${Number(run.time_sec).toFixed(3)} sec` : ''}
              {run.memory_mb ? ` · Memory: ${Number(run.memory_mb).toFixed(1)} MB` : ''}
            </div>
          </div>
          {passedAll && <span className="badge green" style={{ marginLeft: 'auto' }}>+{q.marks} marks if you submit</span>}
        </div>
      )}

      {run?.compile_output && (
        <>
          <h4 className="mt">Compiler output</h4>
          <pre className="code-block err">{run.compile_output}</pre>
        </>
      )}

      {run?.restored && !results.length && (
        <div className="notice small mt-s">ℹ️ Your test cases were already run in an earlier session — individual outputs are not stored. Press “Run code” again to see case-by-case results.</div>
      )}

      {!!tests.length && (
        <div className="case-grid">
          {tests.map((t, i) => {
            const r = resultAt(t.index ?? i);
            const state = !ranEveryCase && !r ? 'pending' : (r && r.passed ? 'ok' : 'bad');
            return (
              <div className={`case-card ${state}`} key={i}>
                <div className="case-head">
                  <strong>Case {i + 1}{t.hidden ? ' 🔒' : ''}</strong>
                  {r ? (
                    <Badge tone={r.passed ? 'green' : 'red'}>{r.passed ? 'Passed' : (run.verdict_label || 'Failed')}</Badge>
                  ) : ranEveryCase ? (
                    <Badge tone="cyan">ran earlier</Badge>
                  ) : (
                    <Badge tone="amber">not run</Badge>
                  )}
                </div>
                {t.hidden ? (
                  <div className="case-line">Hidden test case — input and expected output are not shown.</div>
                ) : (
                  <>
                    {t.input !== undefined && <div className="case-line"><b>Input</b><div className="io">{t.input || '(no input)'}</div></div>}
                    {t.expected_output !== undefined && <div className="case-line"><b>Expected</b><div className="io">{t.expected_output}</div></div>}
                  </>
                )}
                {r && !r.passed && r.stderr && <div className="case-line"><b>Error</b><div className="io">{r.stderr}</div></div>}
                {r && !t.hidden && r.output !== undefined && !r.passed && (
                  <div className="case-line"><b>Your output</b><div className="io">{r.output || '(empty)'}</div></div>
                )}
                {r && <div className="case-line">⏱ {Number(r.time || 0).toFixed(3)}s · {Number(r.memory || 0).toFixed(1)} MB</div>}
              </div>
            );
          })}
        </div>
      )}
      </div>
      )}
    </div>
  );
}

/** Small local preview used only by the preflight room/identity checks. */
function ProctorStreamPreview({ stream, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    video.srcObject = stream || null;
    if (stream) video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      aria-label={label || 'Camera preview'}
      style={{
        width: 'min(460px, 88vw)', aspectRatio: '4 / 3', objectFit: 'cover',
        borderRadius: 14, background: '#111827', border: '1px solid rgba(255,255,255,.2)',
      }}
    />
  );
}

/* ============================================================
 *  Quiz runner — classic question-paper layout, auto-save,
 *  navigator, flagging and the run-before-submit gate.
 * ============================================================ */
export default function QuizAttempt() {
  const { id, attemptId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [state, setState] = useState({ loading: true, error: '' });
  const [answers, setAnswers] = useState({});
  const [langs, setLangs] = useState({});
  const [runs, setRuns] = useState({});
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(true);
  const [result, setResult] = useState(null);
  // question | compiler ratio, dragged by the divider between the two panes
  const arenaRef = useRef(null);
  const { pct: leftPct, startDrag: dragPanes, reset: resetPanes } = useVerticalSplit(arenaRef, { initial: 48, min: 26, max: 72 });
  const [flagged, setFlagged] = useState({});
  // per-question grading for the post-submit answer sheet: { [qid]: { is_correct, marks } }
  const [grades, setGrades] = useState({});
  // live-quiz fairness lock: early submitters don't see the answer sheet
  // until the live session ends (time up / host ends it)
  const [solutionsLocked, setSolutionsLocked] = useState(false);
  // live-quiz tab-switch guard (anti-cheat)
  const [violations, setViolations] = useState(0);
  const [tabWarning, setTabWarning] = useState(false);
  const [tabWarningReason, setTabWarningReason] = useState('tab/window switch');
  const [pendingTabViolations, setPendingTabViolations] = useState(0);
  // live-quiz rule: manual Submit unlocks only after every question has been
  // OPENED at least once (auto-submits — timer / tab-guard / host-end — are
  // never blocked by this rule). Seen ids persist per attempt via localStorage.
  const seenRef = useRef(new Set());
  const [seenCount, setSeenCount] = useState(0);
  const seenHydrated = useRef(false);
  const violationsRef = useRef(0);
  const violationAttemptRef = useRef(attemptId);
  const awayRef = useRef(false);
  const tabAutoSubmittedRef = useRef(false);
  const timeOnQuestion = useRef(0);
  const pending = useRef(new Map());
  const expired = useRef(false);

  /* ------------------------------- load ------------------------------- */
  useEffect(() => {
    (async () => {
      try {
        if (location.state && location.state.started && String(location.state.started.attempt.id) === String(attemptId)
            && location.state.started.quiz && location.state.started.quiz.quiz_type !== undefined
            // Payloads predating policy snapshots must fall through to the
            // detail load below so the attempt's rules get frozen once.
            && 'proctor_policy' in location.state.started) {
          const s = location.state.started;
          // Live-lobby seat: the paper is not open yet. Send the student back
          // to the waiting room, which jumps into the runner the moment the
          // host presses "Start for everyone".
          if (s.lobby || (s.quiz.quiz_type === 'live' && s.quiz.status === 'live' && !s.quiz.live_started_at)) {
            navigate(`/quizzes/${s.quiz.id || s.attempt.quiz_id}/live`, { replace: true });
            return;
          }
          setState({
            loading: false, attempt: s.attempt, quiz: s.quiz, questions: s.questions,
            anticheat: s.anticheat,
            proctorPolicy: parseProctorPolicy(s.proctor_policy || (s.attempt && s.attempt.proctor_policy)),
          });
          hydrate(s.attempt, s.quiz, s.questions, s.answers);
          initTimer(s.attempt, s.quiz);
          return;
        }
        const attemptRes = await quizApi.attempt(attemptId);
        const d = attemptRes.data.data;
        // On the /quizzes/attempts/:attemptId route there is no quiz id in the URL, so take it
        // from the attempt itself — otherwise the countdown would come back as 00:00 after a reload.
        const quizId = (d.attempt && d.attempt.quiz_id) || id;
        const quizRes = quizId ? await quizApi.get(quizId).catch(() => null) : null;
        const quiz = quizRes ? quizRes.data.data : { title: 'Quiz', time_limit_minutes: 0 };
        // Same lobby guard for direct/resumed runner URLs: a seated student
        // belongs in the waiting room until the host's synchronized start.
        const lobbyWait = d.lobby
          || (quiz && quiz.quiz_type === 'live' && quiz.status === 'live' && !(quiz.live && quiz.live.live_started_at));
        if (lobbyWait && d.attempt.status === 'in_progress') {
          navigate(`/quizzes/${quizId}/live`, { replace: true });
          return;
        }
        setState({
          loading: false, attempt: d.attempt, quiz, questions: d.questions,
          anticheat: d.anticheat,
          proctorPolicy: parseProctorPolicy(d.proctor_policy || (d.attempt && d.attempt.proctor_policy)),
        });
        initTimer(d.attempt, quiz);
        hydrate(d.attempt, quiz, d.questions, d.answers);
        if (d.attempt.status !== 'in_progress') {
          setResult({
            score: d.attempt.score, total: d.attempt.total_marks, correct: d.attempt.correct_count,
            wrong: d.attempt.wrong_count, unattempted: d.attempt.unattempted_count,
            accuracy: d.attempt.accuracy, rank: d.attempt.rank_position, passed: d.attempt.passed, review: true,
          });
          setSolutionsLocked(!!d.solutions_locked);
          const g = {};
          (d.answers || []).forEach((a) => { g[a.question_id] = { is_correct: Number(a.is_correct), marks: Number(a.marks_awarded || 0) }; });
          setGrades(g);
        }
      } catch (e) { setState({ loading: false, error: e.message }); }
    })();
    /* eslint-disable-next-line */
  }, [attemptId]);

  /* Anti-cheat is per-developer: when the quiz creator (or an admin) flips a
     switch mid-exam, the settings-changed broadcast makes us re-resolve this
     attempt's effective anti-cheat instead of running stale rules. Only the
     `anticheat` slice is merged — answers, timer and navigation are untouched. */
  useEffect(() => {
    const onSettings = () => {
      quizApi.attempt(attemptId).then((res) => {
        const d = res.data && res.data.data;
        if (!d) return;
        setState((s) => ({
          ...s,
          anticheat: d.anticheat || s.anticheat,
          // The frozen policy is fill-once: a settings broadcast may deliver
          // the snapshot this attempt started under, but must never replace
          // it with whatever the switches say now.
          proctorPolicy: s.proctorPolicy
            || parseProctorPolicy(d.proctor_policy || (d.attempt && d.attempt.proctor_policy)),
        }));
      }).catch(() => {});
    };
    window.addEventListener('smartodl:settings_changed', onSettings);
    return () => window.removeEventListener('smartodl:settings_changed', onSettings);
  }, [attemptId]);

  /** Restore answers + language + "test cases already run" state from the server. */
  const hydrate = (attempt, quiz, questions, stored) => {
    const map = {};
    const runMap = {};
    const langMap = {};
    (stored || []).forEach((a) => {
      let value = a.selected_answer;
      if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* keep raw string */ } }
      map[a.question_id] = value;
      if (a.language) langMap[a.question_id] = a.language;
      const question = (questions || []).find((qq) => qq.id === a.question_id);
      const total = Number(a.tests_total || 0);
      if (question && question.type === 'coding' && Number(a.verified) === 1 && total > 0) {
        runMap[a.question_id] = {
          ran: true, running: false, restored: true, total,
          passed: Number(a.tests_passed || 0),
          allPassed: Number(a.tests_passed || 0) === total,
          verdict: Number(a.tests_passed || 0) === total ? 'accepted' : 'wrong_answer',
          verdict_label: Number(a.tests_passed || 0) === total ? 'Accepted' : 'Wrong Answer',
          results: [],
        };
      }
    });
    (questions || []).forEach((qq) => {
      const language = langMap[qq.id] || asArray(qq.coding_languages)[0] || 'python';
      if (qq.type === 'coding' && !isAnswered(map[qq.id])) map[qq.id] = starterOf(qq, language);
    });
    setAnswers(map);
    setLangs(langMap);
    setRuns(runMap);
  };

  const initTimer = (attempt, quiz) => {
    let deadline = null;
    if (quiz && quiz.end_at) deadline = new Date(quiz.end_at).getTime();
    if (attempt && quiz && quiz.time_limit_minutes) {
      const byLimit = new Date(attempt.started_at).getTime() + quiz.time_limit_minutes * 60000;
      deadline = deadline ? Math.min(deadline, byLimit) : byLimit;
    }
    if (deadline) setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
  };

  /* ------------------------------- timer ------------------------------- */
  useEffect(() => {
    if (remaining === null || result) return undefined;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r === null) return r;
        if (r <= 1) { clearInterval(t); autoSubmit(); return 0; }
        return r - 1;
      });
      timeOnQuestion.current += 1;
    }, 1000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [remaining === null, result]);

  useEffect(() => () => {
    // never lose a debounced keystroke: fire whatever is still queued
    pending.current.forEach((j) => { clearTimeout(j.timer); quizApi.saveAnswer(attemptId, j.payload).catch(() => {}); });
    pending.current.clear();
  }, [attemptId]);

  /* ------------------------- realtime: host ended quiz ------------------------- */
  useEffect(() => {
    const onLive = (e) => {
      const d = e.detail || {};
      const quizId = state.quiz && state.quiz.id;
      if (d.action === 'ended' && quizId && String(d.quiz_id) === String(quizId) && !result) {
        showClosedAttempt(false);
      }
    };
    window.addEventListener('smartodl:live_quiz', onLive);
    return () => window.removeEventListener('smartodl:live_quiz', onLive);
    /* eslint-disable-next-line */
  }, [state.quiz && state.quiz.id, result]);

  /* -------------- anti-cheat: tab guard + fullscreen lockdown -------------- */
  // Admin/developer panels control all of this: enable/disable the tab guard,
  // set the strike limit, choose auto-submit, and toggle the fullscreen
  // lockdown mode for live quizzes.
  const { settings, isOn } = useSettings();
  /* Per-developer anti-cheat: the attempt payload carries the quiz CREATOR's
     effective settings (their personal overrides over the admin defaults).
     Prefer those everywhere; the platform settings are only the fallback
     before the attempt loads. */
  const ac = state.anticheat || null;
  const acHas = (key) => !!(ac && ac[key] !== undefined && ac[key] !== null && ac[key] !== '');
  const acOn = (key, fallback = true) => (acHas(key)
    ? !['0', 'false', 'no', 'off'].includes(String(ac[key]).toLowerCase())
    : isOn(key, fallback));
  const acNum = (key, fallback) => {
    if (acHas(key)) { const v = Number(ac[key]); if (Number.isFinite(v)) return v; }
    return Number(settings[key]) || fallback;
  };
  const tabGuardEnabled = acOn('tab_guard_enabled', true);
  const tabGuardAutoSubmit = acOn('tab_guard_auto_submit', true);
  const lockdownEnabled = acOn('quiz_lockdown_enabled', true);
  // Clipboard blocking is its own switch. It used to be welded to
  // Fullscreen Lockdown, so an invigilator who wanted a fullscreen exam
  // where students may still copy a snippet out of the question had no way
  // to say so.
  const cpBlockEnabled = acOn('quiz_cp_block', true);
  const MAX_TAB_VIOLATIONS = Math.max(1, acNum('tab_guard_max_violations', 3));
  const isLive = !!(state.quiz && state.quiz.quiz_type === 'live');
  /* A module quiz is the opposite of a live quiz in one respect (never a camera,
     never a screen share) but it IS a supervised assessment: the Feature Control
     floor turns the tab guard, fullscreen lockdown, copy-paste block and
     screenshot block ON, and the backend marks that payload with
     anticheat.module_quiz / anticheat.enforced. Before this flag existed those
     four checks were written as `&& isLive`, so on a module quiz they silently
     did nothing — the switches were on in the payload and dead in the browser. */
  const isModuleQuiz = !!(ac && (ac.module_quiz === true || ac.module_quiz === '1'))
    || !!(state.quiz && state.quiz.module_id);
  /* The backend decides which checks are in force for THIS quiz
     (services/quizSupervision.service.js): live always, module quizzes always,
     and normal/practice quizzes when the admin supervision switch is on. The
     payload carries `enforced`/`supervised`, so the runner no longer has to
     guess from quiz_type. */
  const acEnforced = isLive || !!(ac && ac.enforced === true) || !!state.supervised || isModuleQuiz;
  // Live-quiz rules that are now opt-in for normal/practice quizzes.
  const rules = state.rules || (isLive ? { require_all_viewed: true, individualized_order: true } : {});
  const ruleViewAll = isLive || !!rules.require_all_viewed;
  const rulePersonalOrder = isLive || !!rules.individualized_order;
  const guardActive = tabGuardEnabled && !result && acEnforced;
  const lockdownActive = lockdownEnabled && !result && acEnforced;
  const cpBlockActive = cpBlockEnabled && !result && acEnforced;
  const [proctorConsented, setProctorConsented] = useState(false);
  // True between "Allow access" and the end of preflight: live publishing
  // runs in this window so the host can observe the room scan / identity
  // check instead of trusting a self-ticked checkbox after the fact.
  const [proctorSetupStarted, setProctorSetupStarted] = useState(false);

  /* ---------------------------- live proctoring ----------------------------
     Webcam presence + full-screen share. Both default to OFF in the admin
     panel: pointing a camera at a student is an institutional decision, not
     something an upgrade should switch on. Like the lockdown it only ever
     applies to LIVE quizzes, never to practice. */
  /* Advanced proctoring is a separate administrator/global layer. Its
     individual switches do nothing unless the master switch is on. Several
     checks inherently need a camera or screen, so enabling one of those
     checks makes the corresponding permission part of this attempt even if
     the creator's basic webcam/screen switch was off. */
  /* The frozen per-attempt policy decides what THIS attempt consented to;
     the live admin switches can only narrow it. Enabling Advanced
     Proctoring halfway through a paper therefore changes nothing for
     students already running (no surprise camera/mic/second-phone demand,
     no live view they never agreed to), while switching it off stops the
     advanced transports immediately. */
  const proctorPolicy = parseProctorPolicy(
    state.proctorPolicy || (state.attempt && state.attempt.proctor_policy),
  );
  const policyAdv = (proctorPolicy && proctorPolicy.advanced) || {};
  const policyLive = !!(proctorPolicy && proctorPolicy.live && isLive && !result);
  const policyOn = (key) => policyLive && !!policyAdv[key];
  const currentAdvancedMaster = isOn('proctor_advanced_enabled', false);
  const advOn = (policyKey, settingKey) => policyOn(policyKey)
    && currentAdvancedMaster && isOn(settingKey, false);

  const proctorBody = advOn('body', 'proctor_body_detection_enabled');
  const proctorHeadPose = advOn('head_pose', 'proctor_head_pose_enabled');
  const liveSnapshot = advOn('snapshot', 'proctor_live_snapshot_enabled');
  const liveWebrtc = advOn('webrtc', 'proctor_live_webrtc_enabled');
  const proctorSecondCamera = advOn('second_camera', 'proctor_second_camera_enabled');
  const proctorRoomScan = advOn('room_scan', 'proctor_room_scan_enabled');
  const proctorIdentity = advOn('identity', 'proctor_identity_check_enabled');
  const proctorMic = advOn('mic', 'proctor_mic_monitoring_enabled');
  const proctorDualMonitor = advOn('dual_monitor', 'proctor_dual_monitor_enabled');

  // The attempt snapshot prevents newly-enabled checks from appearing mid-exam,
  // while the current admin switch can withdraw a check immediately. Only
  // currently effective checks keep their sensors or preflight steps alive.
  // Saved recording is deliberately independent of the Advanced Proctoring
  // master switch (the policy/backend both preserve this contract). It still
  // requires that recording was enabled when this live attempt was snapshotted.
  const proctorRecording = policyOn('recording') && isOn('proctor_recording_enabled', false);
  const advancedCameraNeeded = proctorBody || proctorHeadPose || liveSnapshot || liveWebrtc
    || proctorRoomScan || proctorIdentity || proctorRecording;
  const advancedScreenNeeded = liveSnapshot || liveWebrtc || proctorRecording;

  /* Camera / screen share on a NON-live quiz is allowed only when the admin
     turned on "Allow webcam/screen proctoring on normal + practice quizzes";
     the backend then marks the payload camera_allowed/screen_allowed. The
     consent screen below is unchanged, so nothing starts silently. */
  const proctorPermitted = isLive || !!(ac && (ac.camera_allowed === true || ac.screen_allowed === true));
  const proctorBasicCamera = acOn('proctor_camera_enabled', false) && !result && proctorPermitted;
  const proctorCamera = (proctorBasicCamera || advancedCameraNeeded) && !result && proctorPermitted;
  const proctorScreen = (acOn('proctor_screen_enabled', false) || advancedScreenNeeded) && !result && proctorPermitted;
  // Phone/book inference is part of the explicit basic Webcam option. An
  // advanced feature that happens to need a camera (e.g. identity only) must
  // not silently turn on a different object-detection check.
  const proctorObjects = proctorBasicCamera;
  const proctorOn = proctorCamera || proctorScreen || proctorMic || proctorSecondCamera || proctorDualMonitor;
  const [proctorBusy, setProctorBusy] = useState(false);
  const [preflightStep, setPreflightStep] = useState(null); // room | second | identity
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [roomScanLeft, setRoomScanLeft] = useState(10);
  const [secondSession, setSecondSession] = useState(null);
  const [secondUrl, setSecondUrl] = useState('');
  const [secondQr, setSecondQr] = useState('');
  const [secondStatus, setSecondStatus] = useState(null);
  const [secondRequest, setSecondRequest] = useState({ n: 0, rotate: false });
  const [secondBusy, setSecondBusy] = useState(false);
  const [secondError, setSecondError] = useState('');
  const [showSecondRepair, setShowSecondRepair] = useState(false);
  const [identityHoldLeft, setIdentityHoldLeft] = useState(0);
  // `submit` is declared further down, so the hook gets a ref rather than the
  // function itself — a direct reference here would be a temporal-dead-zone
  // error on first render.
  const submitRef = useRef(null);
  const proctor = useProctoring({
    attemptId,
    cameraRequired: proctorCamera,
    screenRequired: proctorScreen,
    objectsRequired: proctorObjects,
    bodyRequired: proctorBody,
    headPoseRequired: proctorHeadPose,
    faceCheckRequired: proctorBasicCamera,
    micRequired: proctorMic,
    dualMonitorRequired: proctorDualMonitor,
    snapshotRequired: liveSnapshot,
    active: proctorOn && proctorConsented,
    publishActive: proctorSetupStarted && !proctorConsented && !result,
    onAutoSubmit: () => { if (submitRef.current) submitRef.current(true); },
    // The quiz creator's limit, so the real ceiling is on screen before the first flush.
    violationLimit: Math.max(0, acNum('proctor_max_violations', 0)),
    initialViolations: String(state.attempt?.id) === String(attemptId)
      ? Number(state.attempt?.proctor_violations || 0) : 0,
  });
  const [resumeBusy, setResumeBusy] = useState(false);
  const proctorRef = useRef(proctor);
  useEffect(() => { proctorRef.current = proctor; }, [proctor]);

  /* -------- tell the student what was detected --------
     proctor.lastIssue was being computed and returned by the hook and then
     used by absolutely nothing, so a student could have a phone flagged
     repeatedly and never see a word about it. Silent accusation is the worst
     of both worlds: no deterrence during the exam, and a nasty surprise in
     the report afterwards. */
  const [proctorWarn, setProctorWarn] = useState(null);
  const lastWarnKey = useRef('');
  useEffect(() => {
    const issue = proctor.lastIssue;
    if (!issue || !proctorOn || result) return undefined;
    const key = `${issue.type}:${issue.at}`;
    if (lastWarnKey.current === key) return undefined;
    lastWarnKey.current = key;
    const TEXT = {
      phone_detected: '📱 A phone was seen on camera — please remove it. This has been recorded.',
      book_detected: '📕 A book or notes were seen on camera — please remove them. This has been recorded.',
      device_detected: '💻 Another device was seen on camera — please remove it. This has been recorded.',
      no_face: '🙂 Your face is not visible on camera — please sit directly in front of the screen.',
      multiple_faces: '👥 More than one face was seen on camera — you must sit alone.',
      camera_dark: '🌑 The camera is covered or the room is too dark — please increase the lighting.',
      camera_frozen: '🧊 The camera image is frozen — please restart the camera correctly.',
      body_missing: '🧍 Your body is not visible on camera — please return to your seat and stay in frame.',
      multiple_people: '👥 More than one person was seen on camera — you must sit alone.',
      body_out_of_frame: '🧍 Please adjust the camera so your head and upper body stay fully in frame.',
      looking_away: '👀 Please keep looking at the screen during the quiz.',
      voice_detected: '🎙️ Voice-level sound was detected. Please remain silent and alone.',
      multiple_displays_detected: '🖥️ More than one display was detected. Please use only the shared screen.',
      second_camera_disconnected: '📱 Your mobile second camera disconnected — please reconnect it.',
    };
    const msg = TEXT[issue.type];
    if (!msg) return undefined;
    setProctorWarn({ msg, at: issue.at });
    const t = setTimeout(() => setProctorWarn(null), 7000);
    return () => clearTimeout(t);
  }, [proctor.lastIssue, proctorOn, result]);
  // Only nag about the camera once the silent re-acquire has had a fair go —
  // a USB blink should heal itself without a wall in the student's face.
  const [camDownSince, setCamDownSince] = useState(0);
  useEffect(() => {
    if (!proctorCamera || !proctorConsented || result) { setCamDownSince(0); return; }
    if (proctor.cameraState === 'on') { setCamDownSince(0); return; }
    setCamDownSince((t) => t || Date.now());
  }, [proctor.cameraState, proctorCamera, proctorConsented, result]);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!camDownSince) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, [camDownSince]);
  const cameraGateDue = !!camDownSince && Date.now() - camDownSince > 20000;

  const resumeCameraShare = async () => {
    setResumeBusy(true);
    try {
      const okNow = await proctor.resumeCamera();
      if (!okNow) toast.error(proctor.cameraError || 'The camera could not be started — please try again.');
    } finally { setResumeBusy(false); }
  };
  const resumeScreenShare = async () => {
    setResumeBusy(true);
    try {
      const okNow = await proctor.resumeScreen();
      if (!okNow) toast.error('You must choose the entire screen — please try again.');
    } finally { setResumeBusy(false); }
  };

  const preflightCompletingRef = useRef(false);
  const secondWasConnectedRef = useRef(false);
  const secondOutageReportedRef = useRef(false);
  // Preflight remains scoped to the frozen attempt, but an administrator can
  // withdraw any step immediately; disabled checks are removed from the flow.
  const preflightOrder = [
    proctorRoomScan ? 'room' : null,
    proctorSecondCamera ? 'second' : null,
    proctorIdentity ? 'identity' : null,
  ].filter(Boolean);

  const finishPreflight = async () => {
    setPreflightStep(null);
    if ((liveSnapshot || liveWebrtc) && !proctorSetupStarted) {
      await proctorRef.current.reportEvent('live_view_started', liveWebrtc ? 'webrtc' : 'snapshot').catch(() => {});
    }
    setProctorSetupStarted(false);
    setProctorConsented(true);
  };

  const movePreflight = async (from) => {
    const next = preflightOrder[preflightOrder.indexOf(from) + 1] || null;
    if (next) setPreflightStep(next);
    else await finishPreflight();
  };

  const completePreflight = async (step) => {
    if (preflightCompletingRef.current) return;
    preflightCompletingRef.current = true;
    setPreflightBusy(true);
    try {
      if (step === 'room') await proctorRef.current.reportEvent('room_scan_completed', '10 second room scan');
      if (step === 'identity') await proctorRef.current.reportEvent('identity_check_completed', 'student self-check');
      await movePreflight(step);
    } catch (_) {
      toast.error('That proctoring check could not be recorded — please try again.');
    } finally {
      preflightCompletingRef.current = false;
      setPreflightBusy(false);
    }
  };

  const startProctoring = async () => {
    setProctorBusy(true);
    try {
      const okAll = await proctor.start();
      if (okAll) {
        if (preflightOrder.length) {
          // Permissions were just granted from the consent screen: live
          // publishing starts NOW so the host can observe the room scan
          // and identity check while they happen.
          setProctorSetupStarted(true);
          if (liveSnapshot || liveWebrtc) {
            proctorRef.current.reportEvent(
              'live_view_started', liveWebrtc ? 'webrtc (preflight)' : 'snapshot (preflight)',
            ).catch(() => {});
          }
          setPreflightStep(preflightOrder[0]);
        } else await finishPreflight();
      } else {
        setProctorSetupStarted(false);
        toast.error(proctor.cameraError || proctor.screenError || proctor.micError
          || 'The required proctoring permissions were not granted — allow access and try again.');
      }
    } finally { setProctorBusy(false); }
  };

  /** Ask for a (fresh) pairing link. Rotation invalidates the old token. */
  const requestSecondSession = (rotate = false) => {
    setSecondError('');
    if (rotate) { setSecondQr(''); setSecondUrl(''); setSecondStatus(null); }
    setSecondRequest((r) => ({ n: r.n + 1, rotate: !!rotate }));
  };

  /* Identity hold: face + ID stay on camera long enough for the host's
     live view (publishing already runs during preflight) to actually
     show them before the student can move on. */
  useEffect(() => {
    if (preflightStep !== 'identity') return undefined;
    setIdentityHoldLeft(5);
    const id = setInterval(() => setIdentityHoldLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(id);
  }, [preflightStep]);

  /* Room-scan countdown. The student rotates the camera slowly enough for
     the host's live view (when enabled) and for the laptop camera itself to
     change scene; completion is an event, not a stored recording. */
  useEffect(() => {
    if (preflightStep !== 'room') return undefined;
    setRoomScanLeft(10);
    proctorRef.current.reportEvent('room_scan_started').catch(() => {});
    const id = setInterval(() => setRoomScanLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(id);
  }, [preflightStep]);

  /* Create the phone pairing link/QR when the second-camera step (or the
     mid-exam repair panel) opens. A failed creation used to strand the
     student on "Preparing pairing link…" forever: the effect never re-ran.
     It now surfaces an error with an explicit retry, and the student can
     rotate to a fresh QR — which also kills a leaked/expired old token
     (e.g. after a server restart wiped the in-memory session). */
  const pairingOpen = proctorSecondCamera && (preflightStep === 'second' || showSecondRepair);
  useEffect(() => {
    if (!pairingOpen) return undefined;
    if (secondSession && !secondRequest.rotate) return undefined;
    let cancelled = false;
    (async () => {
      setSecondBusy(true);
      setSecondError('');
      try {
        const { data } = await quizApi.secondCameraSession(attemptId, secondRequest.rotate);
        const payload = data.data || {};
        if (!payload.session || !payload.path) throw new Error('Second-camera pairing could not be created.');
        const url = `${window.location.origin}${payload.path}`;
        if (cancelled) return;
        setSecondSession(payload.session);
        setSecondUrl(url);
        const qr = await QRCode.toDataURL(url, { width: 220, margin: 1 });
        if (!cancelled) setSecondQr(qr);
        setSecondRequest((r) => ({ ...r, rotate: false }));
      } catch (e) {
        if (!cancelled) setSecondError(e.message || 'Second-camera pairing could not be created.');
      } finally {
        if (!cancelled) setSecondBusy(false);
      }
    })();
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [pairingOpen, attemptId, secondSession, secondRequest.n, secondRequest.rotate]);

  /* Poll the phone during pairing; the backend records the connected event
     when its first ephemeral frame arrives. */
  useEffect(() => {
    if (preflightStep !== 'second') return undefined;
    let stopped = false;
    const check = async () => {
      try {
        const { data } = await quizApi.secondCameraStatus(attemptId);
        const status = data.data || null;
        setSecondStatus(status);
        // "Ever connected" is not enough: one frame followed by closing the
        // phone page must not clear the step. The phone has to be live NOW.
        if (!stopped && status && status.connected) {
          stopped = true;
          secondWasConnectedRef.current = true;
          await completePreflight('second');
        }
      } catch (_) { /* the next poll retries */ }
    };
    check();
    const id = setInterval(check, 3000);
    return () => { stopped = true; clearInterval(id); };
    /* eslint-disable-next-line */
  }, [preflightStep, attemptId]);

  /* Keep watching the paired phone during the paper. One event per outage. */
  useEffect(() => {
    if (!proctorSecondCamera || !proctorConsented || result) return undefined;
    let cancelled = false;
    const check = async () => {
      try {
        const { data } = await quizApi.secondCameraStatus(attemptId);
        if (cancelled) return;
        const status = data.data || null;
        setSecondStatus(status);
        if (status && status.connected) {
          secondWasConnectedRef.current = true;
          secondOutageReportedRef.current = false;
        } else if (secondWasConnectedRef.current && !secondOutageReportedRef.current) {
          secondOutageReportedRef.current = true;
          try {
            await proctorRef.current.reportEvent('second_camera_disconnected', 'no phone frame for 30 seconds');
          } catch (_) {
            // Not recorded — allow the next poll to try once more instead
            // of swallowing the outage for the rest of the paper.
            secondOutageReportedRef.current = false;
          }
        }
      } catch (_) { /* retry on the next poll */ }
    };
    check();
    const id = setInterval(check, showSecondRepair ? 3000 : 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [proctorSecondCamera, proctorConsented, result, attemptId, showSecondRepair]);

  /* Host-issued warnings use the same high-visibility banner as detections. */
  useEffect(() => {
    let timer = null;
    const onWarning = (e) => {
      const d = (e && e.detail) || {};
      if (String(d.attempt_id) !== String(attemptId)) return;
      setProctorWarn({
        msg: `⚠ Host warning: ${String(d.message || 'Please follow the proctoring instructions.')}`,
        at: d.at || Date.now(),
      });
      clearTimeout(timer);
      timer = setTimeout(() => setProctorWarn(null), 10000);
    };
    window.addEventListener('smartodl:proctor_warning', onWarning);
    return () => { clearTimeout(timer); window.removeEventListener('smartodl:proctor_warning', onWarning); };
  }, [attemptId]);

  // ICE servers come from the authenticated attempt endpoint — never from
  // public settings, where a TURN credential would be world-readable.
  const [iceServers, setIceServers] = useState(DEFAULT_ICE_SERVERS);
  useEffect(() => {
    if (!liveWebrtc || !attemptId) return undefined;
    let cancelled = false;
    let timer = null;
    const load = async () => {
      try {
        const { data } = await quizApi.proctorIce(attemptId);
        const d = data.data || {};
        if (cancelled) return;
        if (Array.isArray(d.ice_servers) && d.ice_servers.length) setIceServers(d.ice_servers);
        if (d.expires_at) {
          const refreshIn = Math.max(30000, new Date(d.expires_at).getTime() - Date.now() - 60000);
          timer = setTimeout(load, refreshIn);
        }
      } catch (_) { /* public STUN fallback stays in place */ }
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [liveWebrtc, attemptId]);
  const rtcPeersRef = useRef(new Map());
  const rtcCandidatesRef = useRef(new Map());

  /* WebRTC publisher: the host creates recvonly camera/screen transceivers.
     Slot 0 is always camera; slot 1 carries the screen only while that
     student is focused in the host monitor, so an entire class does not push
     full-screen video into one browser at once. */
  useEffect(() => {
    if (!liveWebrtc || !(proctorConsented || proctorSetupStarted) || result || typeof RTCPeerConnection === 'undefined') return undefined;
    const peers = rtcPeersRef.current;
    const queues = rtcCandidatesRef.current;

    const send = (sessionId, payload) => quizApi.proctorSignal(attemptId, {
      session_id: sessionId,
      ...payload,
    }).catch(() => {});

    const setSenderTrack = async (sender, track) => {
      if (!sender || sender.track === track) return;
      await sender.replaceTrack(track).catch(() => {});
    };
    const tuneSender = async (sender, kind) => {
      if (!sender || !sender.getParameters || !sender.setParameters) return;
      try {
        const params = sender.getParameters();
        const base = params.encodings && params.encodings.length ? params.encodings : [{}];
        params.encodings = base.map((enc, i) => (i > 0 ? enc : {
          ...enc,
          maxBitrate: kind === 'camera' ? 350000 : 1500000,
          maxFramerate: kind === 'camera' ? 15 : 10,
          ...(kind === 'camera' ? { scaleResolutionDownBy: 2 } : {}),
        }));
        await sender.setParameters(params);
      } catch (_) { /* sender tuning is best-effort bandwidth hygiene */ }
    };
    const applyTracks = async (pc) => {
      const streams = proctorRef.current.getStreams();
      const transceivers = pc.getTransceivers();
      const jobs = [];
      // A recvonly OFFER creates answerer transceivers whose desired
      // direction is NOT sendonly — replaceTrack alone then negotiates
      // BOTH m-lines inactive and no media ever flows (verified in a real
      // Chromium loopback: answer carried a=inactive and no a=msid).
      // Declaring sendonly before createAnswer is what makes the camera —
      // and a focused screen — actually sendable. An unfocused screen slot
      // keeps its direction: pre-answer it answers inactive; after a
      // focused negotiation, replaceTrack(null) pauses it and a later
      // refocus resumes on the same peer.
      const wantSendonly = (transceiver) => {
        try { if (transceiver && transceiver.direction !== 'sendonly') transceiver.direction = 'sendonly'; }
        catch (_) { /* stopped transceiver — host retry recreates the peer */ }
      };
      if (transceivers[0]) {
        wantSendonly(transceivers[0]);
        jobs.push(setSenderTrack(
          transceivers[0].sender,
          (streams.camera && streams.camera.getVideoTracks()[0]) || null,
        ));
      }
      if (transceivers[1]) {
        if (pc._smartodlFocusScreen) wantSendonly(transceivers[1]);
        jobs.push(setSenderTrack(
          transceivers[1].sender,
          pc._smartodlFocusScreen
            ? ((streams.screen && streams.screen.getVideoTracks()[0]) || null)
            : null,
        ));
      }
      await Promise.all(jobs);
    };

    const onSignal = async (e) => {
      const d = (e && e.detail) || {};
      if (String(d.attempt_id) !== String(attemptId) || d.from !== 'host') return;
      const sessionId = String(d.session_id || '');
      if (!sessionId) return;
      try {
        if (d.kind === 'offer' && d.sdp) {
          const old = peers.get(sessionId);
          if (old) old.close();
          const pc = new RTCPeerConnection({ iceServers });
          // Focus travels WITH the offer: the screen track is attached
          // before createAnswer, so its m-line is negotiated sendable from
          // the start. (Attaching it later to a transceiver that was
          // answered with no track needs renegotiation, which the old
          // focus-only replaceTrack silently failed to do.)
          pc._smartodlFocusScreen = !!d.focus_screen;
          peers.set(sessionId, pc);
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              send(sessionId, {
                kind: 'candidate',
                candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
              });
            }
          };
          pc.onconnectionstatechange = () => {
            if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
              // A later host retry creates a fresh offer/session.
              if (pc.connectionState !== 'disconnected') peers.delete(sessionId);
            }
          };
          await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
          await applyTracks(pc);
          const queued = queues.get(sessionId) || [];
          queues.delete(sessionId);
          for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => {});
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const tuned = pc.getTransceivers();
          await tuneSender(tuned[0] && tuned[0].sender, 'camera');
          await tuneSender(tuned[1] && tuned[1].sender, 'screen');
          await send(sessionId, { kind: 'answer', sdp: answer.sdp });
        } else if (d.kind === 'candidate' && d.candidate) {
          const pc = peers.get(sessionId);
          if (pc && pc.remoteDescription) await pc.addIceCandidate(d.candidate).catch(() => {});
          else {
            const queue = queues.get(sessionId) || [];
            queue.push(d.candidate);
            queues.set(sessionId, queue.slice(-30));
          }
        } else if (d.kind === 'focus') {
          const pc = peers.get(sessionId);
          if (pc) {
            pc._smartodlFocusScreen = !!d.focus_screen;
            await applyTracks(pc);
          }
        } else if (d.kind === 'bye') {
          const pc = peers.get(sessionId);
          if (pc) pc.close();
          peers.delete(sessionId);
          queues.delete(sessionId);
        }
      } catch (_) {
        // Signalling failure leaves the event/snapshot proctoring intact.
      }
    };

    window.addEventListener('smartodl:proctor_signal', onSignal);
    const refresh = setInterval(() => {
      peers.forEach((pc) => { applyTracks(pc).catch(() => {}); });
    }, 5000);
    return () => {
      window.removeEventListener('smartodl:proctor_signal', onSignal);
      clearInterval(refresh);
      peers.forEach((pc, sessionId) => {
        send(sessionId, { kind: 'bye' });
        pc.close();
      });
      peers.clear();
      queues.clear();
    };
    // The OR keeps one stable publishing session across the
    // preflight→paper handover instead of tearing every peer down.
  }, [liveWebrtc, proctorConsented || proctorSetupStarted, result, attemptId, iceServers]);
  // "Open every question before submitting" now applies to any quiz that opted
  // in (live keeps it unconditionally).
  const liveTotal = ruleViewAll ? (state.questions || []).length : 0;
  const allSeen = !ruleViewAll || liveTotal === 0 || seenCount >= liveTotal;

  // Questions viewed before a reload must remain marked as seen.
  useEffect(() => {
    if (!ruleViewAll || !attemptId || seenHydrated.current) return undefined;
    seenHydrated.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(`lquiz-seen-${attemptId}`) || '[]');
      if (Array.isArray(saved)) saved.forEach((x) => seenRef.current.add(String(x)));
      if (seenRef.current.size) setSeenCount(seenRef.current.size);
    } catch (_) { /* storage unavailable — session-only tracking still works */ }
    return undefined;
  }, [ruleViewAll, attemptId]);

  // The question currently on screen is now marked as seen.
  useEffect(() => {
    if (!ruleViewAll) return undefined;
    const qq = (state.questions || [])[current];
    if (qq && !seenRef.current.has(String(qq.id))) {
      seenRef.current.add(String(qq.id));
      setSeenCount(seenRef.current.size);
      try { localStorage.setItem(`lquiz-seen-${attemptId}`, JSON.stringify(Array.from(seenRef.current))); } catch (_) { /* ignore */ }
    }
    return undefined;
  }, [current, ruleViewAll, state.questions, attemptId]);

  // Persist each guard strike first, then reconcile to the server's atomic
  // counter. The previous client-only increment was lost on reload and ignored
  // the canonical count returned by the endpoint.
  const recordViolation = useCallback(async (reason = 'tab/window switch') => {
    if (!attemptId || String(state.attempt?.id) !== String(attemptId) || result) return;
    setTabWarningReason(reason);
    setTabWarning(true);
    setPendingTabViolations((n) => n + 1);
    try {
      const res = await quizApi.violation(attemptId);
      const count = Number(res?.data?.data?.violations);
      if (Number.isFinite(count) && count >= 0) {
        const canonical = Math.max(violationsRef.current, count);
        violationsRef.current = canonical;
        setViolations(canonical);
        if (MAX_TAB_VIOLATIONS > 0 && canonical >= MAX_TAB_VIOLATIONS) {
          if (tabGuardAutoSubmit && !tabAutoSubmittedRef.current) {
            tabAutoSubmittedRef.current = true;
            toast.error(`${MAX_TAB_VIOLATIONS} violations — the quiz is being submitted automatically`);
            if (submitRef.current) submitRef.current(true);
          } else if (!tabGuardAutoSubmit) {
            toast.error(`The violation limit (${MAX_TAB_VIOLATIONS}) has been exceeded — this is being reported to the host`);
          }
        }
      }
    } catch (_) {
      toast.error('Violation count could not be synced. Check your connection; the host count updates only after the server confirms it.');
    } finally {
      setPendingTabViolations((n) => Math.max(0, n - 1));
    }
  }, [attemptId, state.attempt?.id, result, MAX_TAB_VIOLATIONS, tabGuardAutoSubmit, toast]);

  // Blur and visibilitychange both fire for the same tab departure. Track the
  // away/return edge so one switch produces exactly one persisted strike;
  // focus/visibility restoration rearms the detector for the next switch.
  useEffect(() => {
    if (!guardActive && !lockdownActive) return undefined;
    const markAway = () => {
      if (awayRef.current) return;
      awayRef.current = true;
      recordViolation('tab/window switch');
    };
    const onVisibility = () => {
      if (document.hidden) markAway();
      else awayRef.current = false;
    };
    const onBlur = () => markAway();
    const onFocus = () => { if (!document.hidden) awayRef.current = false; };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [guardActive, lockdownActive, recordViolation]);

  // Restore the persisted tab/guard count when an attempt is opened or resumed.
  useEffect(() => {
    if (String(violationAttemptRef.current) !== String(attemptId)) {
      violationAttemptRef.current = attemptId;
      violationsRef.current = 0;
      awayRef.current = false;
      tabAutoSubmittedRef.current = false;
      setViolations(0);
      setPendingTabViolations(0);
    }
    if (String(state.attempt?.id) !== String(attemptId)) return;
    const initial = Number(state.attempt?.tab_violations || 0);
    if (Number.isFinite(initial) && initial >= 0 && initial > violationsRef.current) {
      violationsRef.current = initial;
      setViolations(initial);
    }
  }, [attemptId, state.attempt?.id, state.attempt?.tab_violations]);

  // Fullscreen lockdown: keep the quiz fullscreen for the whole attempt.
  // Leaving fullscreen (Esc) is a violation and re-shows the lock gate.
  const [showLockGate, setShowLockGate] = useState(false);
  /* Can this document actually go fullscreen? An iframe without
   * allow="fullscreen" reports `fullscreenEnabled === false`, and calling
   * requestFullscreen there always rejects. Gating the quiz on fullscreen in
   * that case would show a lock screen the student can never get past, so we
   * skip the fullscreen requirement and rely on the other guards instead. */
  const fsSupported = typeof document !== 'undefined'
    && !!document.fullscreenEnabled
    && !!document.documentElement.requestFullscreen;

  useEffect(() => {
    if (!lockdownActive || !fsSupported) return undefined;
    const onFsChange = () => {
      if (document.fullscreenElement) setShowLockGate(false);
      else { setShowLockGate(true); recordViolation('fullscreen exit'); }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    if (!document.fullscreenElement) setShowLockGate(true);
    // Lock the Escape key (Chrome/Edge kiosk feature) so the student cannot
    // press Esc to leave fullscreen — the only way out is the browser itself.
    try { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']); } catch (_) { /* unsupported */ }
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (_) { /* ignore */ }
      // unlock when the attempt ends / the student navigates away
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    /* eslint-disable-next-line */
  }, [lockdownActive, fsSupported, recordViolation]);

  const enterLockdown = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setShowLockGate(false);
    } catch (_) {
      // The host refused fullscreen (embedded iframe without allow="fullscreen",
      // an enterprise policy, or an unsupported browser). Blocking here would
      // brick the attempt with no way forward, so let the student continue —
      // the tab guard, copy-paste block and violation counter all still apply.
      setShowLockGate(false);
      toast.info('Fullscreen is not available in this window — the quiz continues with tab monitoring still active.');
    }
  };

  /* ── Clipboard block — owned by `quiz_cp_block` ──────────────────────
   *
   * Split out of Fullscreen Lockdown, which used to mean two unrelated
   * things at once. The two switches are now independent:
   *   quiz_cp_block         → clipboard, drag-drop, right-click, selection
   *   quiz_lockdown_enabled → stay in fullscreen, no devtools/refresh
   *
   * Still NOT tied to `guardActive`: Tab Guard is detection only and must
   * never touch the student's input (that regression is in the audit).
   *
   * preventDefault happens in the CAPTURE phase so the telemetry listener
   * further down sees `e.defaultPrevented` and records a blocked-paste
   * attempt — a cancelled paste leaves no characters to measure, and that
   * count is real evidence for AI detection. */
  useEffect(() => {
    if (!cpBlockActive) return undefined;
    let warned = false;
    const stop = (e) => {
      e.preventDefault();
      if (!warned) {
        warned = true;
        toast.info('📋 Copy-paste is disabled in this quiz by the administrator');
      }
    };
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      const clipboard = ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x'].includes(k))
        || (e.shiftKey && k === 'insert');            // the old Shift+Insert paste
      if (clipboard) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('copy', stop, true);
    document.addEventListener('cut', stop, true);
    document.addEventListener('paste', stop, true);
    document.addEventListener('drop', stop, true);
    document.addEventListener('contextmenu', stop, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('copy', stop, true);
      document.removeEventListener('cut', stop, true);
      document.removeEventListener('paste', stop, true);
      document.removeEventListener('drop', stop, true);
      document.removeEventListener('contextmenu', stop, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [cpBlockActive, toast]);

  /* ── Escape prevention — owned by `quiz_lockdown_enabled` ─────────────
   * Devtools, refresh, view-source and print. These are about keeping the
   * student inside the exam, not about the clipboard, so they stay with the
   * fullscreen switch. Safe Exam Mode blocks a wider set on top of this. */
  useEffect(() => {
    if (!lockdownActive) return undefined;
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      const blocked = e.key === 'F12'                                       // devtools
        || e.key === 'F5'                                                   // refresh
        || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k))         // devtools combos
        || ((e.ctrlKey || e.metaKey) && ['u', 'p'].includes(k))             // view-source / print
        || ((e.ctrlKey || e.metaKey) && k === 'r');                         // refresh
      if (blocked) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lockdownActive]);

  // Extra friction: if the student somehow triggers a reload/close (browser
  // button, Ctrl+W etc.), the browser shows a "leave page?" confirm dialog.
  useEffect(() => {
    if (!lockdownActive && !guardActive) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [lockdownActive, guardActive]);

  /* ------------------- 🛑 SAFE EXAM MODE (quiz-creator controlled) -------------------
     Safe-Exam-Browser-style kiosk layer for live quizzes AND module quizzes:
     • hooks & swallows shortcut keys  — F5, F12, Ctrl+R/W/T/N/P/S/U, Alt, etc.
     • blocks right-click, drag, refresh & close (beforeunload warning)
     • DevTools-open heuristic (window suddenly got much wider than the page)
     Fullscreen re-lock is handled by the lockdown gate below. */
  const safeModeOn = acOn('exam_safe_mode', true);
  const safeWarnedRef = useRef(false);
  useEffect(() => {
    if (!safeModeOn || !acEnforced || result) return undefined;
    const safeWarn = (what) => {
      if (!safeWarnedRef.current) {
        safeWarnedRef.current = true;
        toast.error(`🛑 Safe Exam Mode: ${what} is blocked`);
        setTimeout(() => { safeWarnedRef.current = false; }, 4000);
      }
    };
    const HOOKED_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f10', 'f11', 'f12'];
    const HOOKED_COMBO = ['r', 'w', 't', 'n', 'p', 's', 'u', 'g', 'h', 'j']; // with Ctrl/Cmd
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      // F-keys (F5 refresh, F12 devtools…)
      if (HOOKED_KEYS.includes(k)) { e.preventDefault(); e.stopPropagation(); safeWarn(e.key.toUpperCase()); return; }
      // Alt — eats the key so the browser menu / Alt+Tab trigger doesn't fire
      if (k === 'alt') { e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Shift+I/J/C = devtools · Ctrl+Esc = start menu
        if (e.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) { e.preventDefault(); e.stopPropagation(); safeWarn('DevTools'); return; }
        if (HOOKED_COMBO.includes(k)) { e.preventDefault(); e.stopPropagation(); safeWarn(`Ctrl+${k.toUpperCase()}`); return; }
      }
      // print / find / save native dialogs
      if ((e.ctrlKey || e.metaKey) && ['f'].includes(k) && e.shiftKey) { e.preventDefault(); }
    };
    const onCtx = (e) => { e.preventDefault(); safeWarn('Right-click'); };
    const onDrag = (e) => { e.preventDefault(); };
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = 'Exam in progress — leaving will be recorded.'; return e.returnValue; };
    // DevTools heuristic: browser window much wider than the page viewport
    let dtShown = false;
    const dtTimer = setInterval(() => {
      const gap = window.outerWidth - window.innerWidth;
      if (gap > 170 && !dtShown) { dtShown = true; toast.error('🛑 Close DevTools — this is being recorded'); }
      if (gap <= 170) dtShown = false;
    }, 1500);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('dragstart', onDrag, true);
    window.addEventListener('drop', onDrag, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      clearInterval(dtTimer);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onCtx, true);
      window.removeEventListener('dragstart', onDrag, true);
      window.removeEventListener('drop', onDrag, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    /* eslint-disable-next-line */
  }, [safeModeOn, acEnforced, result]);

  /* ------------------- presence heartbeat (host monitor) ------------------- */
  // Tells the server the student is still on the quiz (every 15s) and fires a
  // "leaving" signal when the page is closed or they navigate away — the host
  // monitor then shows the student as "🚪 left".
  const heartbeatActive = !result && !state.loading && isLive;
  useEffect(() => {
    if (!heartbeatActive || !attemptId) return undefined;
    const pingNow = () => quizApi.ping(attemptId).catch(() => {});
    pingNow();
    const t = setInterval(() => pingNow(), 15000);
    const onVisible = () => { if (!document.hidden) pingNow(); };
    const onPageHide = () => {
      // best-effort "left" signal while the page unloads (keepalive request)
      try {
        const token = tokens.access() || '';
        fetch(`${window.location.origin}/api/quiz-attempts/${attemptId}/ping`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ leaving: 1 }),
        }).catch(() => {});
      } catch (_) { /* ignore */ }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [heartbeatActive, attemptId]);

  /* ------------- per-question timer (admin sets seconds per question) -------
     Each question can have its own countdown. When it hits zero the question
     is LOCKED (no more answering) and the runner jumps to the next one.
     The deadline lives in localStorage per attempt+question, so refreshing
     does not reset the clock. */
  const [qSecondsLeft, setQSecondsLeft] = useState(null);
  const [qTimeUp, setQTimeUp] = useState(false);
  const lockedQsRef = useRef(new Set());
  useEffect(() => {
    const list = (state && state.questions) || [];
    const qq = list[current];
    const lim = qq ? Number(qq.time_limit_seconds) || 0 : 0;
    // Per-question limits used to be live-only. A module quiz is a supervised
    // assessment as well, so the same countdown and question lock apply there.
    if (!qq || !lim || !acEnforced || result) { setQSecondsLeft(null); setQTimeUp(false); return undefined; }
    if (lockedQsRef.current.has(qq.id)) { setQSecondsLeft(0); setQTimeUp(true); return undefined; }
    const key = `odl-qtimer-${attemptId}-${qq.id}`;
    let deadline = 0;
    try { deadline = Number(window.localStorage.getItem(key)) || 0; } catch (_) { /* storage blocked */ }
    const now = Date.now();
    if (!deadline || deadline < now - 86400000) {
      deadline = now + lim * 1000;
      try { window.localStorage.setItem(key, String(deadline)); } catch (_) { /* ignore */ }
    }
    let fired = false;
    const tick = () => {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setQSecondsLeft(left);
      if (left <= 0) {
        setQTimeUp(true);
        lockedQsRef.current.add(qq.id);
        if (!fired) {
          fired = true;
          toast.error(`⏰ Time for Q${current + 1} has ended!`);
          if (current < list.length - 1) setCurrent((c) => Math.min(c + 1, list.length - 1));
        }
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [attemptId, current, state, acEnforced, result]);

  /* ---- AI detection telemetry (see AI-DETECTION-AUDIT.md) ----
     Previously this counted KEYSTROKES and compared them against pasted
     CHARACTERS — mismatched units. Monaco's auto-indent and auto-closing
     brackets insert characters with no keystroke, so the paste share was
     inflated on every coding answer, and Backspace counted as "typed" let a
     student dilute a real paste. It also listened to every INPUT on the page,
     so pasting into an unrelated field polluted the exam's ratio.

     Now: the same shared hook the Coding Arena uses, character deltas per
     question, listeners scoped to the answer area, plus keystroke rhythm. */
  const writeDetectOn = acOn('ai_classifier_quiz_enabled', true);
  const telemetry = useTypingTelemetry(writeDetectOn);
  const { notePaste, noteBlockedPaste, noteKey, noteInsert } = telemetry;

  // per-question baseline: a loaded draft or starter template is not typing
  const prevLenRef = useRef(new Map());
  const noteAnswerContent = useCallback((q, value) => {
    if (!writeDetectOn || !q) return;
    if (q.type !== 'short_answer' && q.type !== 'coding') return;
    const next = String(value ?? '');
    const prev = prevLenRef.current.get(q.id);
    prevLenRef.current.set(q.id, next.length);
    if (prev === undefined) return;            // first sighting = baseline only
    const delta = next.length - prev;
    if (delta > 0) noteInsert(delta);
  }, [writeDetectOn, noteInsert]);

  /* A starter template or a restored draft is not the student typing —
     re-baseline so the swap is never booked as authored characters. */
  const rebaseAnswer = useCallback((q, value) => {
    if (q) prevLenRef.current.set(q.id, String(value ?? '').length);
  }, []);

  /* Only fields inside the question paper / compiler count. */
  const inAnswerArea = (t) => !!t
    && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')
    && !!t.closest('.exam-paper, .qz-arena, .lc-skin, .code-panel');

  useEffect(() => {
    if (!writeDetectOn || result) return undefined;
    const onKey = (e) => {
      if (!inAnswerArea(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Tab')) noteKey();
    };
    // bubble phase, so a paste cancelled by lockdown is seen as blocked
    // rather than banked as characters that never arrived
    const onPaste = (e) => {
      if (!inAnswerArea(e.target)) return;
      const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (!text) return;
      if (e.defaultPrevented) noteBlockedPaste();
      else notePaste(text.length);
    };
    const onDrop = (e) => {
      if (!inAnswerArea(e.target)) return;
      const text = (e.dataTransfer && e.dataTransfer.getData('text')) || '';
      if (!text) return;
      if (e.defaultPrevented) noteBlockedPaste();
      else notePaste(text.length);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('paste', onPaste);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('drop', onDrop);
    };
  }, [writeDetectOn, result, noteKey, notePaste, noteBlockedPaste]);

  /* ------------- screenshot (PrintScreen) block — quiz-creator controlled -------------
     The OS-level capture can't be stopped by any website, but we intercept the
     PrintScreen key, blank the clipboard afterwards and count it as a strike. */
  const shotBlockOn = acOn('screenshot_block_enabled', true);
  useEffect(() => {
    if (!shotBlockOn || !acEnforced || result) return undefined;
    const onShot = (e) => {
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        e.stopPropagation();
        toast.error('📸 Screenshot not allowed — violation recorded');
        try { if (navigator.clipboard) navigator.clipboard.writeText('Screenshot blocked by SmartODL').catch(() => {}); } catch (_) { /* ignore */ }
        recordViolation('screenshot shortcut');
      }
    };
    document.addEventListener('keydown', onShot, true);
    return () => document.removeEventListener('keydown', onShot, true);
    /* eslint-disable-next-line */
  }, [shotBlockOn, acEnforced, result, recordViolation]);

  /* --------------------------- keyboard shortcuts --------------------------- */
  // A–D / 1–4 → pick (or toggle) option · ←/→ → previous/next question.
  // Ignored while typing in inputs, textareas or the code editor.
  useEffect(() => {
    if (result || state.loading) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const qs = state.questions || [];
      const qq = qs[current];
      if (!qq) return;
      const opts = asArray(qq.options);
      const lower = e.key.toLowerCase();
      const idx = 'abcd'.includes(lower) && e.key.length === 1 ? 'abcd'.indexOf(lower) : ('12345678'.includes(e.key) ? Number(e.key) - 1 : -1);
      if (opts.length && idx >= 0 && idx < opts.length) {
        e.preventDefault();
        if (!lockedQsRef.current.has(qq.id)) { // per-question timer expired → shortcuts disabled
          if (qq.type === 'multiple') toggleMultiple(qq, opts[idx]);
          else if (qq.type !== 'short_answer' && qq.type !== 'coding') answer(qq, opts[idx]);
        }
        return;
      }
      if (e.key === 'ArrowLeft' && current > 0) { setCurrent((c) => Math.max(0, c - 1)); timeOnQuestion.current = 0; }
      if (e.key === 'ArrowRight' && current < qs.length - 1) { setCurrent((c) => Math.min(qs.length - 1, c + 1)); timeOnQuestion.current = 0; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ------------------------------ saving ------------------------------ */

  /**
   * The host ended the live quiz (or the window expired) while this page was open.
   * The attempt is already graded on the server — show the answer sheet instead of
   * pretending the connection broke.
   */
  const showClosedAttempt = async (silent = false) => {
    try {
      const { data } = await quizApi.attempt(attemptId);
      const d = data.data;
      if (!d.attempt || d.attempt.status === 'in_progress') return false;
      setRemaining(null);
      setState((s) => ({ ...s, attempt: d.attempt }));
      hydrate(d.attempt, state.quiz, d.questions, d.answers);
      setSolutionsLocked(!!d.solutions_locked);
      setResult({
        score: d.attempt.score, total: d.attempt.total_marks, correct: d.attempt.correct_count,
        wrong: d.attempt.wrong_count, unattempted: d.attempt.unattempted_count, accuracy: d.attempt.accuracy,
        rank: d.attempt.rank_position, passed: d.attempt.passed, review: true, host_closed: true,
      });
      if (!silent) toast.info('The host ended this live quiz — your attempt was graded automatically');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    } catch (_) { return false; }
  };

  const saveNow = async (payload) => {
    try {
      await quizApi.saveAnswer(attemptId, payload);
      setSaved(true);
    } catch (e) {
      if (e.status === 401) return;
      if (e.status === 400 && /already submitted|not open|has been ended|has ended/i.test(e.message || '')) {
        setSaved(true);
        await showClosedAttempt(false);
        return;
      }
      toast.error('Could not save your answer — check your connection');
      setSaved(false);
    }
  };

  /** Debounced server save: keystrokes in the code editor are cheap on the server. */
  const queueSave = (payload, delay = 700) => {
    setSaved(false);
    const existing = pending.current.get(payload.question_id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      pending.current.delete(payload.question_id);
      saveNow(payload);
    }, delay);
    pending.current.set(payload.question_id, { timer, payload });
  };

  const flushSaves = async () => {
    const jobs = Array.from(pending.current.values());
    pending.current.clear();
    await Promise.all(jobs.map((j) => { clearTimeout(j.timer); return saveNow(j.payload); }));
  };

  const payloadFor = (q, value) => {
    let stored = value;
    // A coding question starts pre-filled with its template. Persisting that
    // made the server see a saved answer for a question the student never
    // touched, so the host monitor counted it as answered. Submit already
    // normalises template-only code to '', so autosave does the same and the
    // two paths agree. The editor re-fills the template on resume, because an
    // empty stored answer is what triggers it.
    if (q.type === 'coding'
      && isTemplateOnly(q, value, langs[q.id] || asArray(q.coding_languages)[0] || 'python')) {
      stored = '';
    }
    const p = { question_id: q.id, selected_answer: stored, time_spent_seconds: timeOnQuestion.current };
    if (q.type === 'coding') p.language = langs[q.id] || asArray(q.coding_languages)[0] || 'python';
    return p;
  };

  /** Editing the code invalidates the test run — the server resets it too, so the UI must agree. */
  const onCodeChange = (q, value) => {
    if (runs[q.id] && codeOf(answers[q.id]) !== value) {
      setRuns((r) => { const next = { ...r }; delete next[q.id]; return next; });
    }
    answer(q, value, 800);
  };

  const answer = (q, value, delay = 0) => {
    noteAnswerContent(q, value);
    setAnswers((a) => ({ ...a, [q.id]: value }));
    if (delay) queueSave(payloadFor(q, value), delay);
    else {
      const existing = pending.current.get(q.id);
      if (existing) { clearTimeout(existing.timer); pending.current.delete(q.id); }
      setSaved(false);
      saveNow(payloadFor(q, value));
    }
  };

  const toggleMultiple = (q, option) => {
    const list = Array.isArray(answers[q.id]) ? [...answers[q.id]] : [];
    const i = list.indexOf(option);
    if (i >= 0) list.splice(i, 1); else list.push(option);
    answer(q, list);
  };

  /* --------------------------- in-quiz compiler --------------------------- */
  const runTests = async (q) => {
    const code = codeOf(answers[q.id]);
    if (!code.trim()) { toast.error('Write some code first'); return; }
    await flushSaves();
    setRuns((r) => ({ ...r, [q.id]: { ...(r[q.id] || {}), running: true } }));
    try {
      const { data } = await quizApi.runCode(attemptId, {
        question_id: q.id,
        language: langs[q.id] || asArray(q.coding_languages)[0] || 'python',
        source_code: code,
      });
      const d = data.data;
      setRuns((r) => ({
        ...r,
        [q.id]: {
          ran: true, running: false, passed: d.passed, total: d.total, allPassed: d.all_passed,
          verdict: d.verdict, verdict_label: d.verdict_label, results: d.results || [],
          compile_output: d.compile_output, time_sec: d.time_sec, memory_mb: d.memory_mb,
        },
      }));
      if (d.all_passed) toast.success(`All ${d.total} test cases passed 🎉`);
      else toast.info(`${d.passed}/${d.total} test cases passed — check the failing cases below`);
    } catch (e) {
      setRuns((r) => ({ ...r, [q.id]: { ...(r[q.id] || {}), running: false } }));
      toast.error(e.message);
    }
  };

  const resetCode = async (q) => {
    const starter = (typeof q.starter_code === 'object' && q.starter_code) || {};
    const language = langs[q.id] || asArray(q.coding_languages)[0] || 'python';
    const template = starter[language] || '';
    if (codeOf(answers[q.id]).trim() && !window.confirm('Replace your code with the starter template?')) return;
    setRuns((r) => { const next = { ...r }; delete next[q.id]; return next; });
    rebaseAnswer(q, template);
    answer(q, template);
  };

  const changeLanguage = (q, language) => {
    setLangs((l) => ({ ...l, [q.id]: language }));
    setRuns((r) => { const next = { ...r }; delete next[q.id]; return next; });
    const starter = (typeof q.starter_code === 'object' && q.starter_code) || {};
    const currentCode = codeOf(answers[q.id]).trim();
    const replace = !currentCode || Object.values(starter).some((v) => v.trim() === currentCode);
    if (replace) {
      const next = starter[language] || '';
      rebaseAnswer(q, next);   // language swap is not the student typing
      setAnswers((a) => ({ ...a, [q.id]: next }));
      queueSave({ question_id: q.id, selected_answer: next, language, time_spent_seconds: timeOnQuestion.current }, 0);
    } else {
      queueSave({ question_id: q.id, selected_answer: codeOf(answers[q.id]), language, time_spent_seconds: timeOnQuestion.current }, 0);
    }
  };

  /* ------------------------------- submit ------------------------------- */
  const autoSubmit = async () => {
    expired.current = true;
    toast.info('Time is up — submitting automatically');
    await submit(true);
  };

  const submit = async (auto = false) => {
    if (submitting) return;
    const questions = state.questions || [];

    if (!auto) {
      // Manual submission is not allowed until every question has been opened once.
      if (ruleViewAll && liveTotal > 0 && seenCount < liveTotal) {
        toast.error(`\u{1F512} You can submit only after viewing all ${liveTotal} questions once (${seenCount}/${liveTotal} viewed so far). Open every question through the navigator or with \u2190/\u2192.`);
        return;
      }
      // Gate: every coding answer that was written must have its full test suite run first.
      const blocking = questions.find((q) => q.type === 'coding' && codeOf(answers[q.id]).trim()
        && !isTemplateOnly(q, answers[q.id], langs[q.id] || asArray(q.coding_languages)[0] || 'python')
        && asArray(q.test_cases).length > 0 && !runs[q.id]?.ran);
      if (blocking) {
        const index = questions.findIndex((q) => q.id === blocking.id);
        setCurrent(index);
        toast.error(`Run all test cases for Question ${index + 1} before submitting`);
        return;
      }
      const skipped = questions.length - questions.filter((q) => isQuestionDone(q)).length;
      const failing = questions.filter((q) => q.type === 'coding' && runs[q.id]?.ran && runs[q.id].passed !== runs[q.id].total).length;
      const notes = [
        skipped ? `${skipped} question${skipped === 1 ? '' : 's'} still unanswered` : '',
        failing ? `${failing} coding question${failing === 1 ? '' : 's'} failing some test cases` : '',
      ].filter(Boolean);
      if (notes.length && !window.confirm(`${notes.join(' and ')}. Submit the quiz anyway?`)) return;
    }

    setSubmitting(true);
    try {
      await flushSaves();
      const payload = {
        answers: questions.map((q) => ({
          question_id: q.id,
          // an untouched starter template is sent as blank, so it counts as unattempted
          selected_answer: q.type === 'coding' && isTemplateOnly(q, answers[q.id], langs[q.id] || asArray(q.coding_languages)[0] || 'python')
            ? null
            : (answers[q.id] ?? null),
          time_spent_seconds: 0,
        })),
        ...telemetry.snapshot(),
        // server-side backstop for the live view-gate (manual submits only)
        ...(auto ? {} : { seen_question_ids: Array.from(seenRef.current) }),
      };
      const { data } = await quizApi.submit(attemptId, payload);
      if (data.data.already_submitted) {
        const shown = await showClosedAttempt(false);
        if (!shown) { toast.info('Already submitted'); navigate('/student/results'); }
        return undefined;
      }
      setResult({ ...data.data, auto });
      toast.success('Quiz submitted and evaluated!');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Re-fetch the graded paper: questions now arrive WITH correct answers +
      // explanations, and answers carry per-question is_correct / marks_awarded —
      // everything the answer sheet needs to show the solutions.
      quizApi.attempt(attemptId).then(({ data: detail }) => {
        const dd = detail.data;
        setSolutionsLocked(!!dd.solutions_locked);
        setState((s) => ({ ...s, questions: dd.questions || s.questions }));
        const g = {};
        (dd.answers || []).forEach((a) => { g[a.question_id] = { is_correct: Number(a.is_correct), marks: Number(a.marks_awarded || 0) }; });
        setGrades(g);
      }).catch(() => {});
    } catch (e) { toast.error(e.message); } finally { setSubmitting(false); }
  };
  // Keep the proctor's auto-submit escape hatch pointing at the latest closure.
  submitRef.current = submit;

  /* ------------------ answer-sheet unlock poll (live quiz) ------------------ */
  // While the fairness lock is on, keep checking the server — the moment the
  // live session ends the answer sheet unlocks automatically on this screen.
  useEffect(() => {
    if (!solutionsLocked || !result) return undefined;
    const t = setInterval(async () => {
      try {
        const { data } = await quizApi.attempt(attemptId);
        const dd = data.data;
        if (!dd.solutions_locked) {
          clearInterval(t);
          setSolutionsLocked(false);
          setState((s) => ({ ...s, questions: dd.questions || s.questions, attempt: dd.attempt || s.attempt }));
          const g = {};
          (dd.answers || []).forEach((a) => { g[a.question_id] = { is_correct: Number(a.is_correct), marks: Number(a.marks_awarded || 0) }; });
          setGrades(g);
          toast.success('The live quiz has ended — the answer sheet is now unlocked! 📄');
        }
      } catch (_) { /* keep waiting */ }
    }, 5000);
    return () => clearInterval(t);
  }, [solutionsLocked, result, attemptId]);

  const questions = state.questions || [];
  const languageOf = (q) => langs[q.id] || asArray(q.coding_languages)[0] || 'python';
  /** Coding questions count as answered once the student writes or runs something (not the raw template). */
  const isQuestionDone = (q) => (q.type === 'coding'
    ? (isAnswered(answers[q.id]) && !isTemplateOnly(q, answers[q.id], languageOf(q))) || !!runs[q.id]?.ran
    : isAnswered(answers[q.id]));
  const answeredCount = useMemo(() => questions.filter((q) => isQuestionDone(q)).length, [answers, questions, langs, runs]);
  const codingQuestions = questions.filter((q) => q.type === 'coding' && asArray(q.test_cases).length > 0);
  const testsOutstanding = codingQuestions.filter((q) => codeOf(answers[q.id]).trim()
    && !isTemplateOnly(q, answers[q.id], langs[q.id] || asArray(q.coding_languages)[0] || 'python')
    && !runs[q.id]?.ran).length;

  if (state.loading) return <Loader label="Preparing your quiz…" />;
  if (state.error) return <div className="container section"><ErrorBox error={state.error} /></div>;
  if (!questions.length) return <div className="container section"><Empty title="This quiz has no questions yet" /></div>;

  /* ------------------------------ result ------------------------------ */
  if (result) {
    const percent = result.total ? (Number(result.score) / Number(result.total)) * 100 : 0;
    return (
      <div className="container section">
        <div className="card center">
          <div style={{ fontSize: '3rem' }}>{result.passed ? '🎉' : '📘'}</div>
          <h1>{result.passed ? 'Passed!' : 'Quiz submitted'}</h1>
          <p className="muted">
            {result.host_closed
              ? 'The host ended this live quiz — your answers were submitted and graded automatically.'
              : result.auto ? 'Your attempt was auto-submitted when the timer expired.' : 'Your answers have been graded instantly.'}
          </p>
          <div className="grid g4 mt">
            {[['Score', `${Number(result.score)} / ${result.total}`], ['Accuracy', `${Number(result.accuracy).toFixed(1)}%`],
              ['Rank', `#${result.rank || '—'}`], ['Correct / Wrong', `${result.correct} / ${result.wrong}`]]
              .map(([l, v]) => <div className="stat" key={l}><div className="v">{v}</div><div className="l">{l}</div></div>)}
          </div>
          <div className="progress mt" style={{ maxWidth: 420, margin: '16px auto' }}><i style={{ width: `${percent}%` }} /></div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/quizzes">More quizzes</Link>
            <Link className="btn btn-ghost" to="/leaderboard">See leaderboard</Link>
            <Link className="btn btn-ghost" to="/student">Dashboard</Link>
          </div>
        </div>

        {solutionsLocked ? (
          <div className="card mt center">
            <div style={{ fontSize: '3rem' }}>⏳</div>
            <h3>The answer sheet is still locked</h3>
            <p className="muted" style={{ maxWidth: 560, margin: '0 auto' }}>
              You submitted early. For fairness, the answer sheet will open only when
              <strong> the live quiz timer ends</strong> or <strong>the host ends the quiz</strong> —
              until then, correct answers remain hidden so that nobody can share them with students who are still attempting the quiz.
            </p>
            <div className="mt"><span className="tag">🔄 Checking automatically every 5 seconds…</span></div>
            <div className="row mt" style={{ justifyContent: 'center' }}>
              <Link className="btn btn-ghost" to="/student">← Go to the dashboard</Link>
            </div>
          </div>
        ) : (
        <div className="card mt">
          <h3>Answer sheet</h3>
          <div className="stack" style={{ gap: 14 }}>
            {questions.map((q, i) => {
              const mine = answers[q.id];
              const run = runs[q.id];
              const grade = grades[q.id];
              const parsedCorrect = parseJson(q.correct_answer);
              const correctArr = parsedCorrect == null || parsedCorrect === '' ? [] : (Array.isArray(parsedCorrect) ? parsedCorrect : [parsedCorrect]);
              return (
                <div className="panel" key={q.id}>
                  <div className="between">
                    <strong className="small">Q{i + 1}. {q.question_text}</strong>
                    <div className="row" style={{ gap: 8 }}>
                      {q.type === 'coding' && run && (
                        <Badge tone={run.passed === run.total ? 'green' : 'red'}>{run.passed}/{run.total} test cases</Badge>
                      )}
                      {!isAnswered(mine) ? <Badge tone="amber">skipped</Badge>
                        : grade ? (
                          <Badge tone={grade.is_correct ? 'green' : 'red'}>
                            {grade.is_correct ? `✓ +${grade.marks}` : `✗ ${grade.marks}`} {grade.marks === 1 || grade.marks === -1 ? 'mark' : 'marks'}
                          </Badge>
                        ) : <Badge tone="cyan">answered</Badge>}
                    </div>
                  </div>
                  {q.code_snippet && <pre className="code-block mt-s">{q.code_snippet}</pre>}
                  {q.type === 'coding' ? (
                    <pre className="code-block mt-s">{(isTemplateOnly(q, mine, langs[q.id] || asArray(q.coding_languages)[0] || 'python') ? '' : codeOf(mine)) || '// no code submitted'}</pre>
                  ) : asArray(q.options).length > 0 ? (
                    <div className="stack mt-s" style={{ gap: 6 }}>
                      {asArray(q.options).map((o, oi) => {
                        const chosen = Array.isArray(mine) ? mine.includes(o) : String(mine) === String(o);
                        const isCorrectOpt = correctArr.some((c) => normEq(c, o));
                        const cls = ['quiz-option'];
                        if (isCorrectOpt) cls.push('correct-answer');
                        else if (chosen) cls.push('wrong-choice');
                        return (
                          <div key={o} className={cls.join(' ')}>
                            <span className="letter">{LETTERS[oi] || oi + 1}</span>{o}
                            {isCorrectOpt && (
                              <span className="tiny" style={{ marginLeft: 'auto', color: 'var(--green)', fontWeight: 700 }}>
                                ✓ Correct answer{chosen ? ' — you got it' : ''}
                              </span>
                            )}
                            {chosen && !isCorrectOpt && (
                              <span className="tiny" style={{ marginLeft: 'auto', color: 'var(--red)', fontWeight: 700 }}>✗ Your answer</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="soft mt-s small">
                      Your answer: <strong>{isAnswered(mine) ? String(mine) : '—'}</strong>
                      {correctArr.length > 0 && (<> • Correct answer: <strong style={{ color: 'var(--green)' }}>{correctArr.join(', ')}</strong></>)}
                    </div>
                  )}
                  {q.explanation && <div className="soft mt-s small">💡 <strong>Explanation:</strong> {q.explanation}</div>}
                </div>
              );
            })}
          </div>
        </div>
        )}
      </div>
    );
  }

  /* ------------------------------- runner ------------------------------- */
  const q = questions[current];
  const qLocked = !!q && (qTimeUp || lockedQsRef.current.has(q.id)); // per-question timer expired
  const opts = asArray(q.options);
  const multi = q.type === 'multiple';
  const mine = answers[q.id];
  const run = runs[q.id];
  const coding = q.type === 'coding';
  const hasTests = coding && asArray(q.test_cases).length > 0;
  const timerTone = remaining !== null && remaining <= 60 ? 'danger' : (remaining !== null && remaining <= 300 ? 'warn' : '');

  /** Shared by the preflight step and the mid-exam re-pair panel. */
  const renderSecondPairing = () => (
    <>
      {secondQr ? (
        <img
          src={secondQr}
          alt="Second-camera pairing QR code"
          style={{ width: 220, height: 220, borderRadius: 16, background: '#fff', padding: 8 }}
        />
      ) : (
        <p className="muted">{secondBusy ? 'Preparing pairing link…' : 'Pairing link is not ready yet.'}</p>
      )}
      {secondError && (
        <div style={{
          maxWidth: 520, margin: '12px auto', padding: '10px 12px', borderRadius: 10,
          background: 'rgba(127,29,29,.9)', border: '1px solid rgba(252,165,165,.5)', color: '#fff',
        }}>
          {secondError}
        </div>
      )}
      <div className="tiny muted" style={{ maxWidth: 520, margin: '12px auto', wordBreak: 'break-all' }}>{secondUrl}</div>
      <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn"
          type="button"
          disabled={!secondUrl}
          onClick={() => {
            if (navigator.clipboard) navigator.clipboard.writeText(secondUrl).catch(() => {});
            toast.success('Second-camera link copied');
          }}
        >
          📋 Copy link
        </button>
        <button
          className="btn"
          type="button"
          disabled={secondBusy}
          onClick={() => requestSecondSession(!!secondQr)}
        >
          {secondBusy ? 'Working…' : (secondQr ? '↻ New QR code' : '↻ Retry pairing')}
        </button>
        <span className={`badge ${(secondStatus && secondStatus.connected) ? 'green' : 'amber'}`} style={{ padding: '7px 11px' }}>
          {(secondStatus && secondStatus.connected) ? '✓ Phone connected' : 'Waiting for phone…'}
        </span>
      </div>
    </>
  );

  return (
    // coding questions need room for two panes, so the 1200px cap is lifted
    <div className={`exam-wrap ${coding ? 'qz-wide' : ''}`} style={cpBlockActive ? { userSelect: 'none', WebkitUserSelect: 'none' } : undefined}>
      <ProctorRecordingCapture
        attemptId={attemptId}
        active={proctorRecording && proctorConsented && !result}
        getStreams={proctor.getStreams}
      />
      {/* ---------------- proctoring consent gate (webcam / screen) ----------------
          Shown BEFORE the lockdown gate: permission prompts cannot be raised
          from inside fullscreen reliably, and the student deserves to read what
          is being monitored before anything is switched on. */}
      {proctorOn && !proctorConsented && !preflightStep && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3300, background: 'rgba(4,7,18,.99)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24,
        }}>
          <div style={{ maxWidth: 560 }}>
            <div style={{ fontSize: '3.4rem' }}>{proctorCamera ? '🎥' : '🖥️'}</div>
            <h1 style={{ marginTop: 8 }}>Proctored Quiz</h1>
            <p className="muted">
              This quiz is <strong>proctored</strong>. To start, you must grant the following
              permissions:
            </p>
            <ul style={{ textAlign: 'left', maxWidth: 420, margin: '14px auto', lineHeight: 1.75 }}>
              {proctorCamera && (
                <li>
                  <strong>Camera</strong> — used continuously to check whether you remain in front of the screen.
                </li>
              )}
              {proctorScreen && (
                <li>
                  <strong>Screen share</strong> — you must share the <em>entire screen</em>, not only
                  one tab or window.
                </li>
              )}
              {proctorObjects && (
                <li>
                  <strong>Phone and book check</strong> — if a phone or notes appear on camera,
                  a note is recorded for the invigilator. A small amount of data is downloaded the first time.
                </li>
              )}
              {(proctorBody || proctorHeadPose) && (
                <li>
                  <strong>Body and head checks</strong> — the browser checks that you remain seated,
                  alone, in frame and facing the screen.
                </li>
              )}
              {proctorMic && (
                <li>
                  <strong>Microphone</strong> — only sound level is analysed for voice activity;
                  conversations are not transcribed or recorded.
                </li>
              )}
              {(liveSnapshot || liveWebrtc) && (
                <li>
                  <strong>Live invigilator view</strong> — the authorised host can view your camera
                  and shared screen during this attempt.
                </li>
              )}
              {proctorRoomScan && <li><strong>Room scan</strong> — before the paper opens, slowly show the room and desk.</li>}
              {proctorSecondCamera && <li><strong>Mobile second camera</strong> — pair your phone so it can view you and your workspace.</li>}
              {proctorIdentity && <li><strong>Identity check</strong> — show your face and ID for host verification.</li>}
              {proctorDualMonitor && <li><strong>Display check</strong> — the browser reports whether more than one display is connected.</li>}
              {proctorRecording && <li><strong>Optional saved recording</strong> — the host may request webcam + full-screen recording during the attempt. Recording starts only after a separate explicit Allow/Decline choice; if allowed, the recording indicator stays visible and only administrators can play it back.</li>}
            </ul>
            <p className="tiny muted" style={{ maxWidth: 500, margin: '0 auto' }}>
              {proctorRecording ? (
                <>🔒 Live checks may send event names. A saved video is <strong>not</strong> started by this consent: if the host requests recording, you will see a separate consent prompt. Only after you choose Allow will webcam + screen video be uploaded to private server storage for the configured retention period; admin-only playback.</>
              ) : (liveSnapshot || liveWebrtc || proctorSecondCamera) ? (
                <>🔒 Live view is enabled for this quiz. Your authorised host can view the enabled camera/screen feeds during the attempt. <strong>No photo, video or screen recording is saved</strong>; snapshot frames remain briefly in server memory, WebRTC goes directly to the host, and event names are recorded for review.</>
              ) : (
                <>🔒 None of your photos, video, or screen recordings are <strong>saved anywhere</strong> or <strong>sent to the server</strong>. Everything is checked only inside your browser; only events (such as “the camera stopped”) are recorded.</>
              )}
            </p>
            <div style={{ margin: '16px 0' }}>
              <button className="btn btn-primary" style={{ fontSize: '1.05rem' }}
                onClick={startProctoring} disabled={proctorBusy}>
                {proctorBusy ? 'Requesting permission…' : '✅ Allow access and start the quiz'}
              </button>
            </div>
            {(proctor.cameraState === 'denied' || proctor.cameraState === 'lost'
              || proctor.screenState === 'denied' || proctor.screenState === 'wrong'
              || proctor.micState === 'denied' || proctor.micState === 'lost') && (
              <p className="tiny" style={{ color: 'var(--red, #ef4444)', maxWidth: 460, margin: '0 auto' }}>
                {proctor.screenState === 'wrong'
                  ? 'You shared only one window or tab — you must choose the entire screen.'
                  : (proctor.cameraError || proctor.screenError || proctor.micError
                     || 'Permission was blocked. Allow it from the 🔒 icon in the address bar and try again.')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---------------- advanced proctoring preflight: room scan ---------------- */}
      {proctorOn && !proctorConsented && proctorRoomScan && preflightStep === 'room' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3310, background: 'rgba(4,7,18,.99)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, overflowY: 'auto',
        }}>
          <div style={{ maxWidth: 620 }}>
            <div style={{ fontSize: '3.2rem' }}>🔄</div>
            <h1 style={{ marginTop: 8 }}>Room scan</h1>
            <p className="muted">
              Slowly rotate the camera to show the room, door, walls and desk. Remove phones,
              books, notes and other people before continuing.
              {(liveSnapshot || liveWebrtc) && ' The authorised host can observe this scan live.'}
            </p>
            <ProctorStreamPreview stream={proctor.getStreams().camera} label="Room scan camera preview" />
            <div style={{ margin: '14px 0' }}>
              <span className="badge amber" style={{ fontSize: '.95rem', padding: '6px 12px' }}>
                {roomScanLeft > 0 ? `Keep scanning… ${roomScanLeft}s` : '✓ Scan time complete'}
              </span>
            </div>
            <button
              className="btn btn-primary"
              style={{ fontSize: '1.05rem' }}
              onClick={() => completePreflight('room')}
              disabled={roomScanLeft > 0 || preflightBusy}
            >
              {preflightBusy ? 'Recording check…' : '✅ Room scan complete'}
            </button>
            <p className="tiny muted mt-s">No room-scan video is saved. Only the completion event is recorded.</p>
          </div>
        </div>
      )}

      {/* ------------- advanced proctoring preflight: mobile second camera ------------- */}
      {proctorOn && !proctorConsented && proctorSecondCamera && preflightStep === 'second' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3310, background: 'rgba(4,7,18,.99)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, overflowY: 'auto',
        }}>
          <div style={{ maxWidth: 620 }}>
            <div style={{ fontSize: '3.2rem' }}>📱</div>
            <h1 style={{ marginTop: 8 }}>Connect a second camera</h1>
            <p className="muted">
              Scan this code with your phone, allow its camera, and place the phone behind or
              beside you so your face, hands, desk and laptop screen are visible.
            </p>
            {renderSecondPairing()}
            <p className="tiny muted mt-s">
              This page will continue automatically when the phone connects. Its images are live-only and are not saved.
            </p>
          </div>
        </div>
      )}

      {/* ---------------- advanced proctoring preflight: identity check ---------------- */}
      {proctorOn && !proctorConsented && proctorIdentity && preflightStep === 'identity' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3310, background: 'rgba(4,7,18,.99)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, overflowY: 'auto',
        }}>
          <div style={{ maxWidth: 640 }}>
            <div style={{ fontSize: '3.2rem' }}>🪪</div>
            <h1 style={{ marginTop: 8 }}>Identity check</h1>
            <p className="muted">
              Look directly at the camera and hold your institute ID beside your face. This check
              records that you completed the self-check; no identity photo is saved.
              {(liveSnapshot || liveWebrtc)
                ? ' If the live camera feed is connected, the authorised host can visually review this check.'
                : ' No live camera view is enabled, so the host cannot visually verify you from this check.'}
            </p>
            <div className="row wrap" style={{ gap: 16, justifyContent: 'center', alignItems: 'center' }}>
              <ProctorStreamPreview stream={proctor.getStreams().camera} label="Identity check camera preview" />
              <div style={{ minWidth: 150 }}>
                {(user && user.avatar) ? (
                  <img
                    src={user.avatar}
                    alt="Your profile"
                    style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: '50%', border: '2px solid rgba(255,255,255,.25)' }}
                  />
                ) : <div style={{ fontSize: '3rem' }}>👤</div>}
                <div style={{ marginTop: 8 }}><strong>{(user && (user.full_name || user.name)) || 'Student'}</strong></div>
                <div className="tiny muted">Account profile</div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <span className="badge amber" style={{ fontSize: '.9rem', padding: '6px 12px' }}>
                {identityHoldLeft > 0 ? `Keep your face and ID visible… ${identityHoldLeft}s` : '✓ Ready to continue'}
              </span>
            </div>
            <button
              className="btn btn-primary"
              style={{ fontSize: '1.05rem', marginTop: 12 }}
              onClick={() => completePreflight('identity')}
              disabled={preflightBusy || identityHoldLeft > 0}
            >
              {preflightBusy ? 'Recording check…' : '✅ My face and ID are visible'}
            </button>
          </div>
        </div>
      )}

      {/* --------- camera died and would not come back on its own --------- */}
      {proctorCamera && proctorConsented && !result && cameraGateDue && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3240, background: 'rgba(4,7,18,.99)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24,
        }}>
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: '3.4rem' }}>🎥</div>
            <h1 style={{ marginTop: 8 }}>The camera has stopped</h1>
            <p className="muted">
              The camera connection was lost and could not be restored automatically.
              One violation has been recorded. Please <strong>restart the camera</strong> and continue
              the quiz.
            </p>
            <div style={{ margin: '12px 0' }}>
              <span className="badge red" style={{ fontSize: '.9rem', padding: '6px 12px' }}>
                Proctoring violations: {proctor.violations}
                {proctor.maxViolations > 0 ? ` / ${proctor.maxViolations}` : ''}
              </span>
            </div>
            <button className="btn btn-primary" style={{ fontSize: '1.05rem' }}
              onClick={resumeCameraShare} disabled={resumeBusy}>
              {resumeBusy ? 'Looking for the camera…' : '🎥 Restart the camera'}
            </button>
            {proctor.cameraError && (
              <p className="tiny" style={{ color: 'var(--amber, #f59e0b)', maxWidth: 460, margin: '10px auto 0' }}>
                {proctor.cameraError}
              </p>
            )}
            {proctor.maxViolations > 0 && (
              <p className="tiny muted">
                This count combines camera and screen-sharing violations.
              </p>
            )}
            <p className="tiny muted">Your timer is still running, so please act quickly.</p>
          </div>
        </div>
      )}

      {/* --------- screen share dropped mid-exam: ask for it back ---------
          Stopping the share used to be a dead end — it counted once and then
          stayed off for the rest of the paper, which made the whole check
          pointless after a single click of "Stop sharing". getDisplayMedia()
          needs a user gesture, so the only way back is to put a button in
          front of the student. The attempt and its timer keep running. */}
      {proctorScreen && proctorConsented && !result && proctor.screenState !== 'on' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3250, background: 'rgba(4,7,18,.99)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24,
        }}>
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: '3.4rem' }}>🖥️</div>
            <h1 style={{ marginTop: 8 }}>Screen sharing has stopped</h1>
            <p className="muted">
              This quiz can be attempted only while the entire screen is shared. One violation
              has been recorded. Please <strong>start sharing again</strong> and continue the quiz.
            </p>
            <div style={{ margin: '12px 0' }}>
              <span className="badge red" style={{ fontSize: '.9rem', padding: '6px 12px' }}>
                Proctoring violations: {proctor.violations}
                {proctor.maxViolations > 0 ? ` / ${proctor.maxViolations}` : ''}
              </span>
            </div>
            <button className="btn btn-primary" style={{ fontSize: '1.05rem' }}
              onClick={resumeScreenShare} disabled={resumeBusy}>
              {resumeBusy ? 'Requesting permission…' : '🖥️ Start screen sharing again'}
            </button>
            <p className="tiny muted mt-s">
              When choosing, select <strong>“Entire Screen”</strong> —
              a single tab or window will not work.
            </p>
            {proctor.maxViolations > 0 && (
              <p className="tiny muted">
                This count combines camera and screen-sharing violations.
              </p>
            )}
            <p className="tiny muted">Your timer is still running, so please act quickly.</p>
          </div>
        </div>
      )}

      {/* --------------- proctoring warning banner --------------- */}
      {proctorWarn && (
        <div
          role="alert"
          style={{
            // Above every gate (consent 3300 / screen 3250 / camera 3240 /
            // lockdown 3200) — a warning hidden behind an overlay is no
            // warning at all.
            position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)',
            zIndex: 3400, width: 'calc(100vw - 24px)', maxWidth: 560, maxHeight: 'min(30vh, 170px)',
            overflowY: 'auto', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10,
            background: 'rgba(120,26,26,.97)', color: '#fff',
            border: '1px solid rgba(255,120,120,.5)', boxShadow: '0 8px 28px rgba(0,0,0,.45)',
            fontSize: 'clamp(.78rem, 2.6vw, .92rem)', lineHeight: 1.35, textAlign: 'center', overflowWrap: 'anywhere',
          }}
        >
          {proctorWarn.msg}
        </div>
      )}

      {/* --------------- proctoring status pill (while the attempt runs) --------------- */}
      {proctorOn && proctorConsented && !result && (
        <div style={{
          position: 'fixed', right: 14, bottom: 14, zIndex: 2600,
          display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px',
          borderRadius: 999, background: 'rgba(4,7,18,.82)', border: '1px solid rgba(255,255,255,.14)',
          fontSize: '.78rem', backdropFilter: 'blur(6px)', pointerEvents: 'none',
        }}>
          {proctorCamera && (
            <span title={`Camera: ${proctor.cameraState}`}>
              {proctor.cameraState === 'on' ? '🎥' : '⚠️'} cam
            </span>
          )}
          {proctorScreen && (
            <span title={`Screen share: ${proctor.screenState}`}>
              {proctor.screenState === 'on' ? '🖥️' : '⚠️'} screen
            </span>
          )}
          {proctorObjects && (
            <span title={{
              loading: 'The phone and book detector is downloading…',
              ready: 'Phone and book detection is active',
              failed: 'The detector could not be loaded — the other checks are still running',
            }[proctor.objectState] || 'Phone and book detection is starting'}>
              {{ loading: '⏳', ready: '📱', failed: '⚠️' }[proctor.objectState] || '⏳'} obj
            </span>
          )}
          {proctorBody && (
            <span title={`Body detection: ${proctor.bodyState}`}>
              {proctor.bodyState === 'ok' ? '🧍' : '⚠️'} body
            </span>
          )}
          {proctorMic && (
            <span title={`Microphone: ${proctor.micState}`}>
              {proctor.micState === 'on' ? '🎙️' : '⚠️'} mic
            </span>
          )}
          {proctorSecondCamera && (
            <span title={`Mobile second camera: ${(secondStatus && secondStatus.connected) ? 'connected' : 'not connected'}`}>
              {(secondStatus && secondStatus.connected) ? '📱' : '⚠️'} 2nd cam
            </span>
          )}
          {(liveSnapshot || liveWebrtc) && <span title="The authorised host can view this attempt live. Nothing is being saved.">🔴 live view</span>}
          <span className="muted">· {proctor.violations}/{proctor.maxViolations}</span>
        </div>
      )}

      {/* --------- second camera dropped mid-exam: offer a way back ---------
          A phone that sleeps, loses network, or loses its pairing after a
          server restart used to be unrecoverable without reloading the
          paper. This panel lets the student re-open the pairing QR (or
          rotate to a fresh one) without leaving the attempt. */}
      {proctorSecondCamera && proctorConsented && !result && !showSecondRepair
        && secondStatus && !secondStatus.connected
        && (secondStatus.ever_connected || secondWasConnectedRef.current) && (
        <div style={{
          position: 'fixed', left: 14, bottom: 14, zIndex: 2601, maxWidth: 340,
          padding: '10px 12px', borderRadius: 12, background: 'rgba(120,53,15,.96)', color: '#fff',
          border: '1px solid rgba(252,211,77,.5)', boxShadow: '0 8px 28px rgba(0,0,0,.4)', fontSize: '.85rem',
        }}>
          <strong>📱 Second camera disconnected.</strong>
          <div style={{ margin: '6px 0' }}>Please reconnect your phone so it can keep watching your workspace.</div>
          <button type="button" className="btn btn-sm" onClick={() => setShowSecondRepair(true)}>
            Reconnect phone
          </button>
        </div>
      )}
      {showSecondRepair && proctorSecondCamera && proctorConsented && !result && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3260, background: 'rgba(4,7,18,.98)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, overflowY: 'auto',
        }}>
          <div style={{ maxWidth: 620 }}>
            <div style={{ fontSize: '3rem' }}>📱</div>
            <h1 style={{ marginTop: 8 }}>Reconnect second camera</h1>
            <p className="muted">
              Scan the code again with your phone and keep it positioned so your face, hands,
              desk and laptop screen are visible. If the old link says it has expired, use
              “New QR code”.
            </p>
            {renderSecondPairing()}
            <div style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-primary" onClick={() => setShowSecondRepair(false)}>
                {secondStatus && secondStatus.connected ? '✅ Connected — back to the quiz' : 'Back to the quiz'}
              </button>
            </div>
            <p className="tiny muted mt-s">Your timer is still running. Phone images are live-only and are not saved.</p>
          </div>
        </div>
      )}

      {/* --------------- fullscreen lock gate (live quiz lockdown) --------------- */}
      {/* One gate at a time: proctoring consent must be cleared before the
          fullscreen prompt, otherwise both overlays stack and the student
          reads two sets of instructions through each other. */}
      {showLockGate && lockdownActive && !(proctorOn && !proctorConsented)
        && !(proctorScreen && proctorConsented && !result && proctor.screenState !== 'on')
        && !(proctorCamera && proctorConsented && !result && cameraGateDue) && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3200, background: 'rgba(4,7,18,.99)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 'clamp(10px, 3vw, 24px)',
          boxSizing: 'border-box', overflow: 'hidden', overscrollBehavior: 'contain',
        }}>
          <div style={{ width: 'min(100%, 520px)', maxHeight: 'calc(100dvh - 24px)', margin: 'auto' }}>
            <div style={{ fontSize: 'clamp(2rem, 8vh, 3rem)', lineHeight: 1.1 }}>🔒</div>
            <h1 style={{ margin: '8px 0', fontSize: 'clamp(1.25rem, 4.8vw, 1.8rem)' }}>Secure Lockdown Mode</h1>
            <p className="muted">
              {isLive ? 'This is a secure live quiz.'
                : isModuleQuiz ? 'This is a supervised module quiz.'
                  : 'This is a supervised quiz.'} It must be
              attempted in <strong>fullscreen lockdown</strong> —
              tab switching, refreshing, copy-paste, right-clicking, and other applications are not allowed.
              Leaving fullscreen records a violation.
              {isModuleQuiz && <><br /><strong>No camera and no screen share are used in a module quiz.</strong></>}
            </p>
            <div style={{ margin: '12px 0' }}>
              <span className="badge red" style={{ fontSize: '.9rem', padding: '6px 12px' }}>
                Violations so far: {violations} / {MAX_TAB_VIOLATIONS}
              </span>
            </div>
            <button className="btn btn-primary" style={{ fontSize: '1.05rem' }} onClick={enterLockdown}>
              🔓 Enter fullscreen &amp; continue
            </button>
            <p className="tiny muted mt-s">The lockdown will be removed automatically as soon as the quiz is submitted.</p>
          </div>
        </div>
      )}

      {/* --------------- tab-switch warning (live quiz guard) --------------- */}
      {tabWarning && guardActive && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(4,7,18,.97)',
          display: 'grid', placeItems: 'center', textAlign: 'center', padding: 'clamp(10px, 3vw, 24px)',
          boxSizing: 'border-box', overflow: 'hidden', overscrollBehavior: 'contain',
        }}>
          <div style={{ width: 'min(100%, 460px)', maxHeight: 'calc(100dvh - 24px)', margin: 'auto' }}>
            <div style={{ fontSize: 'clamp(2rem, 8vh, 2.8rem)', lineHeight: 1.1 }}>🚫</div>
            <h1 style={{ margin: '8px 0', fontSize: 'clamp(1.25rem, 4.8vw, 1.8rem)' }}>
              {tabWarningReason === 'tab/window switch' ? 'Tab switch detected!'
                : tabWarningReason === 'fullscreen exit' ? 'Fullscreen exit detected!'
                  : 'Screenshot shortcut blocked'}
            </h1>
            <p className="muted">
              {tabWarningReason === 'tab/window switch'
                ? 'Switching tabs or windows during a live quiz is not allowed.'
                : tabWarningReason === 'fullscreen exit'
                  ? 'Leaving fullscreen during a live quiz is not allowed.'
                  : 'Screenshot shortcuts are blocked during this live quiz.'}
              {' '}This guard violation is visible to the host.
            </p>
            <div style={{ margin: '14px 0' }}>
              <span className="badge red" style={{ fontSize: '.95rem', padding: '7px 14px' }}>
                Violation {violations + pendingTabViolations} / {MAX_TAB_VIOLATIONS}
              </span>
            </div>
            {pendingTabViolations > 0 && <p className="tiny muted" style={{ margin: '6px 0' }}>Syncing count…</p>}
            <p className="small muted" style={{ margin: '8px 0' }}>
              {tabGuardAutoSubmit
                ? (MAX_TAB_VIOLATIONS - violations <= 1
                  ? '⚠ Final warning — the next guard violation will submit the quiz automatically!'
                  : `${MAX_TAB_VIOLATIONS - violations} more guard violation(s) will submit the quiz automatically.`)
                : 'This guard violation is reported to the host; the quiz will not auto-submit.'}
            </p>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setTabWarning(false)}>↩ Return to the quiz</button>
          </div>
        </div>
      )}

      {/* ------------------------------ exam header ------------------------------ */}
      <div className="exam-bar">
        <div className="exam-title">
          <span className="exam-seal">📜</span>
          <div style={{ minWidth: 0 }}>
            <div className="tiny muted">
              {state.quiz?.title || 'Quiz'}
              {(state.quiz?.host_name || state.quiz?.created_by_name)
                && <> · hosted by {state.quiz.host_name || state.quiz.created_by_name}</>}
            </div>
            <h2>Question paper · Section A</h2>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 12 }}>
          <span className={`exam-timer ${timerTone}`}>
            <span className="lab">Time left</span>
            {clock(remaining ?? 0)}
          </span>
          <span className="tag">{answeredCount}/{questions.length} answered</span>
          {rulePersonalOrder && <span className="tag" title="Question numbers are individualized and stable for your attempt">🔀 Personal order</span>}
          {isModuleQuiz && (
            <span className="tag" title="Module quiz — anti-cheat on, but never a camera or a screen share">
              📚 Module quiz · no camera
            </span>
          )}
          {lockdownActive && (
            <span className="tag" title="Fullscreen lockdown — you must stay in fullscreen; refresh and devtools are blocked">🔒 Lockdown</span>
          )}
          {cpBlockActive && (
            <span className="tag" title="Copy, cut, paste and right-click are disabled for this quiz">📋 Copy-paste off</span>
          )}
          {(guardActive || lockdownActive) && (
            <span className={`tag ${violations > 0 ? 'badge red' : ''}`} title="A violation is recorded when you switch tabs or leave fullscreen">
              👁 Violations {violations}/{MAX_TAB_VIOLATIONS}
            </span>
          )}
          {ruleViewAll && (
            <span className="tag" title="Rule: Submit unlocks only after every question has been opened once">
              {allSeen ? '\u{1F441} All viewed \u2713' : `\u{1F441} ${seenCount}/${liveTotal} viewed`}
            </span>
          )}
          {!saved && <span className="tiny muted">Saving…</span>}
          {saved && <span className="tiny muted">💾 Saved</span>}
          <button className="btn btn-primary" disabled={submitting || (isLive && !allSeen)} onClick={() => submit(false)}
            title={isLive && !allSeen ? `Open all ${liveTotal} questions first (${seenCount}/${liveTotal} viewed so far)` : testsOutstanding ? 'Run every coding question’s test cases first' : 'Submit the quiz'}>
            {submitting ? 'Submitting…' : ruleViewAll && !allSeen ? `🔒 View all questions (${seenCount}/${liveTotal})` : testsOutstanding ? `🔒 Submit (${testsOutstanding} to run)` : 'Submit quiz'}
          </button>
        </div>
      </div>

      <div className="exam-progress">
        <i style={{ width: `${((current + 1) / questions.length) * 100}%` }} />
      </div>

      {testsOutstanding > 0 && (
        <div className="notice warn mb small">
          ⚠ {testsOutstanding} coding question{testsOutstanding === 1 ? '' : 's'} still need{testsOutstanding === 1 ? 's' : ''} all test cases run before you can submit.
        </div>
      )}

      <div className="quiz-split">
        {/* ------------------------------ the paper ------------------------------ */}
        <div className="exam-paper">
          <div className="paper-head">
            <div className="q-number">
              <span className="num">{current + 1}</span>
              <div>
                <div className="meta">{q.type.replace('_', ' ')} question</div>
                <div className="small muted">
                  {q.marks} mark{Number(q.marks) === 1 ? '' : 's'}
                  {Number(q.negative_marks) > 0 ? ` · ${q.negative_marks} negative` : ' · no negative marking'}
                  {coding && hasTests ? ` · ${asArray(q.test_cases).length} test cases` : ''}
                  {Number(q.time_limit_seconds) > 0 ? ` · ⏱ ${q.time_limit_seconds}s limit` : ''}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {qSecondsLeft !== null && (
                <span className="badge" style={{
                  fontSize: '1rem', padding: '6px 12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: qTimeUp || qSecondsLeft < 10 ? 'var(--red)' : qSecondsLeft < 30 ? 'var(--amber, #f59e0b)' : 'var(--green)',
                  background: 'rgba(127,127,127,.12)', border: '1px solid currentColor',
                }}>
                  ⏱ {qTimeUp ? '0:00 — time up' : `${Math.floor(qSecondsLeft / 60)}:${String(qSecondsLeft % 60).padStart(2, '0')}`}
                </span>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => setFlagged((f) => ({ ...f, [q.id]: !f[q.id] }))}>
                {flagged[q.id] ? '🚩 Marked for review' : '⚑ Mark for review'}
              </button>
            </div>
          </div>

          {qLocked && (
            <div className="soft" style={{ padding: '8px 14px', marginTop: 10, border: '1px solid var(--red)', color: 'var(--red)', fontWeight: 700, borderRadius: 10 }}>
              ⏰ Time for this question has ended — the answer can no longer be changed
            </div>
          )}

          {coding ? (
            /* ------ Coding Arena layout: question left, compiler right ------
               Same two-pane split as /coding/:slug so a coding question feels
               identical whether it is practised in the arena or answered in a
               quiz. Collapses to a single column under 1100px (see CSS). */
            <div className="qz-arena" ref={arenaRef}
              style={{ gridTemplateColumns: `${leftPct}fr 6px ${100 - leftPct}fr` }}>
              <div className="qz-arena-left">
                <div className="q-text">{q.question_text}</div>
                {q.question_image && <img src={q.question_image} alt="" style={{ maxWidth: '100%', borderRadius: 10, marginTop: 6 }} />}
                {q.code_snippet && <pre className="code-block">{q.code_snippet}</pre>}

                {/* Visible test cases read as worked examples here, the way
                    LeetCode shows Example 1/2 beside the description — the
                    right pane then only carries run results. */}
                {asArray(q.test_cases).filter((t) => !t.hidden).map((t, i) => (
                  <div key={i} className="qz-example">
                    <h4>Example {i + 1}</h4>
                    <div className="lc-example">
                      <div><strong>Input:</strong> <code className="lc-code-inline">{t.input || '(no input)'}</code></div>
                      <div><strong>Output:</strong> <code className="lc-code-inline">{t.expected_output}</code></div>
                    </div>
                  </div>
                ))}
                {asArray(q.test_cases).some((t) => t.hidden) && (
                  <p className="tiny muted" style={{ marginTop: 14 }}>
                    🔒 {asArray(q.test_cases).filter((t) => t.hidden).length} hidden test case
                    {asArray(q.test_cases).filter((t) => t.hidden).length === 1 ? '' : 's'} also run on submit —
                    check edge cases, constraints and output formatting.
                  </p>
                )}
              </div>
              <div className="lc-divider qz-divider" onPointerDown={dragPanes}
                   onDoubleClick={resetPanes} title="Drag to resize · double-click to reset" />
              <div className="qz-arena-right">
                <CodingAnswer
                  q={q}
                  code={codeOf(mine)}
                  language={langs[q.id] || asArray(q.coding_languages)[0] || 'python'}
                  onCode={(value) => onCodeChange(q, value)}
                  onPaste={notePaste}
                  onLanguage={(language) => changeLanguage(q, language)}
                  run={run}
                  onRun={() => runTests(q)}
                  onReset={() => resetCode(q)}
                  split
                />
              </div>
            </div>
          ) : (
            <>
              <div className="q-text">{q.question_text}</div>
              {q.question_image && <img src={q.question_image} alt="" style={{ maxWidth: '100%', borderRadius: 10, marginTop: 6 }} />}
              {q.code_snippet && <pre className="code-block">{q.code_snippet}</pre>}

              {opts.length > 0 && (
                <div className="mt">
                  {multi && <div className="tiny muted mb-s">More than one option is correct — select all that apply.</div>}
                  {opts.map((o, oi) => {
                    const chosen = multi ? (Array.isArray(mine) && mine.includes(o)) : String(mine) === String(o);
                    return (
                      <button key={o} type="button" disabled={qLocked} className={`quiz-option ${chosen ? 'selected' : ''}`}
                        style={qLocked ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                        onClick={() => !qLocked && (multi ? toggleMultiple(q, o) : answer(q, o))}>
                        <span className="letter">{LETTERS[oi] || oi + 1}</span>
                        <span>{o}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === 'short_answer' && (
                <label className="field mt">Your answer
                  <input className="input" placeholder="Type a short answer…" disabled={qLocked}
                    value={typeof mine === 'string' ? mine : ''} onChange={(e) => !qLocked && answer(q, e.target.value, 500)} />
                </label>
              )}
            </>
          )}

          <div className="paper-foot">
            <button className="btn btn-ghost" disabled={current === 0} onClick={() => { setCurrent((c) => c - 1); timeOnQuestion.current = 0; }}>← Previous</button>
            <div className="row wrap" style={{ gap: 10, marginLeft: 'auto' }}>
              <span className="tiny muted">{isQuestionDone(q) ? '✓ answered' : '○ not answered'}</span>
              {isAnswered(mine) && <button className="btn btn-ghost btn-sm" onClick={() => answer(q, multi ? [] : '')}>Clear answer</button>}
              {current === questions.length - 1 ? (
                <button className="btn btn-primary" disabled={submitting || (isLive && !allSeen)} title={isLive && !allSeen ? `Open all ${liveTotal} questions first (${seenCount}/${liveTotal})` : undefined} onClick={() => submit(false)}>{isLive && !allSeen ? `🔒 View all questions (${seenCount}/${liveTotal})` : 'Submit quiz'}</button>
              ) : (
                <button className="btn btn-primary" onClick={() => { setCurrent((c) => c + 1); timeOnQuestion.current = 0; }}>Save &amp; Next →</button>
              )}
            </div>
          </div>
        </div>

        {/* ------------------------------ navigator ------------------------------ */}
        <div className="stack">
          <div className="nav-panel">
            <div className="between mb-s">
              <h3 style={{ fontSize: 1 + 'rem', margin: 0 }}>Question navigator</h3>
              <span className="tiny muted">{questions.length} questions</span>
            </div>
            <div className="nav-grid">
              {questions.map((qq, i) => {
                const done = isQuestionDone(qq);
                return (
                  <button key={qq.id} onClick={() => { setCurrent(i); timeOnQuestion.current = 0; }}
                    className={`nav-cell ${i === current ? 'current' : ''} ${done ? 'done' : ''} ${flagged[qq.id] ? 'flag' : ''}`}
                    title={`Question ${i + 1}${flagged[qq.id] ? ' · marked for review' : ''}${ruleViewAll ? (seenRef.current.has(String(qq.id)) ? ' · viewed \u2713' : ' · not viewed yet') : ''}`}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="divider" />
            <div className="nav-legend">
              <span><i className="done" /> Answered</span>
              <span><i /> Not answered</span>
              <span><i className="now" /> Current question</span>
              <span><i className="flag" /> Marked for review</span>
            </div>
            <div className="divider" />
            <div className="stack tiny" style={{ gap: 6 }}>
              <span>Answered: <strong>{answeredCount}</strong> / {questions.length}</span>
              <span>Remaining: <strong>{questions.length - answeredCount}</strong></span>
              {ruleViewAll && <span>Questions viewed: <strong>{seenCount}</strong> / {liveTotal}</span>}
              {codingQuestions.length > 0 && (
                <span>Test cases run: <strong>{codingQuestions.filter((c) => runs[c.id]?.ran).length}</strong> / {codingQuestions.length}</span>
              )}
            </div>
          </div>
          <div className="soft small">💾 Every answer is saved to the server as you work — a refresh or a dropped connection will not lose your progress.</div>
          <div className="soft small">⌨️ <strong>Shortcuts:</strong> A–D or 1–4 select option • ←/→ switch question</div>
        </div>
      </div>
    </div>
  );
}
