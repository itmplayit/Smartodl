import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { codingApi, communityApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';
const CodeEditor = lazy(() => import('../components/CodeEditor'));
import useImmersiveChrome from '../hooks/useImmersiveChrome';
import useTypingTelemetry from '../hooks/useTypingTelemetry';
import { useVerticalSplit, useHorizontalSplit } from '../hooks/useSplitPane';
import Discussions from '../components/Discussions';
import { Badge, DiffBadge, ErrorBox, Loader, Modal, Tabs } from '../components/ui';
import { LANGS, STARTER } from '../utils/constants';
import { toList } from '../utils/format';
import { lcText, lcLines } from '../utils/lctext';

const STATUS_LABEL = {
  accepted: 'Accepted', wrong_answer: 'Wrong Answer', compilation_error: 'Compilation Error',
  runtime_error: 'Runtime Error', time_limit_exceeded: 'Time Limit Exceeded',
  memory_limit_exceeded: 'Memory Limit Exceeded', internal_error: 'Internal Error', running: 'Running…',
};

export default function ProblemDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const contestId = Number(searchParams.get('contest')) || null;
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const [error, setError] = useState('');
  const [premiumLocked, setPremiumLocked] = useState(false);
  const [lang, setLang] = useState('python');
  const [code, setCode] = useState(STARTER.python);
  const [outTab, setOutTab] = useState('problem');
  const [botTab, setBotTab] = useState('result');
  /* The Testcase / Test Result pane starts hidden so the editor owns the full
     column; it appears after Run/Submit, or when the student opens Custom
     input, and collapses again on Reset. */
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);
  // Shared with the in-quiz compiler. The inline handlers this replaces bound
  // to `window` without ever cleaning up, so navigating away mid-drag left the
  // listeners attached and the body cursor stuck on col-resize.
  const arenaRef = useRef(null);
  const { pct: leftPct, startDrag: startV, reset: resetV } = useVerticalSplit(arenaRef, { initial: 50, min: 25, max: 75 });
  const { size: botH, startDrag: startH, reset: resetH } = useHorizontalSplit({ initial: 220, min: 120, max: 480 });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [subs, setSubs] = useState([]);
  const [unlocking, setUnlocking] = useState(false);

  // LeetCode devotes the whole viewport to the problem — hide the site chrome.
  useImmersiveChrome(true, { lockScroll: true });

  /* --------- copy-paste block (problem-creator controlled) --------- */
  const { isOn } = useSettings();
  /* Per-developer anti-cheat: getProblem carries the problem CREATOR's
     effective settings (their overrides over the admin defaults). Prefer
     those; the platform settings are only the fallback before load. */
  const ac = (problem && problem.anticheat) || null;
  const acOn = (key, fallback = true) => (ac && ac[key] !== undefined && ac[key] !== null && ac[key] !== ''
    ? !['0', 'false', 'no', 'off'].includes(String(ac[key]).toLowerCase())
    : isOn(key, fallback));
  const cpBlock = acOn('coding_arena_cp_block', true);
  /* Forward-declared so the copy-paste block (defined above the telemetry
     hook) can report cancelled attempts without a circular dependency. */
  const blockedRef = useRef(() => {});
  useEffect(() => {
    if (!cpBlock) return undefined;
    let warned = false;
    const stop = (e) => {
      e.preventDefault();
      // A cancelled paste leaves no characters to measure, which is exactly
      // why the arena used to score everyone at 0. Record the attempt.
      if (e.type === 'paste' || e.type === 'drop') blockedRef.current();
      if (!warned) { warned = true; toast.info('📋 Copy-paste is disabled for this problem by its creator'); }
    };
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['v', 'x'].includes(k)) { e.preventDefault(); blockedRef.current(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'c') { e.preventDefault(); }
      if (k === 'insert' || ((e.shiftKey) && k === 'insert')) { e.preventDefault(); blockedRef.current(); }
    };
    document.addEventListener('copy', stop);
    document.addEventListener('cut', stop);
    document.addEventListener('paste', stop);
    document.addEventListener('drop', stop);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('copy', stop);
      document.removeEventListener('cut', stop);
      document.removeEventListener('paste', stop);
      document.removeEventListener('drop', stop);
      document.removeEventListener('keydown', onKey);
    };
    /* eslint-disable-next-line */
  }, [cpBlock]);

  /* ---- AI detection: typing analytics (problem-creator controlled) ----
   *
   * Pasted characters are measured from the editor's real paste event, never
   * inferred. The previous version compared each insertion against a buffer of
   * counted keystrokes and booked the difference as "pasted", which produced
   * false positives for students who simply type well:
   *
   *   - Monaco auto-closes brackets and quotes  → 2 chars from 1 key
   *   - Enter auto-indents                      → "\n    " from 1 key
   *   - Tab inserts 4 spaces                    → 4 chars from 1 key
   *   - accepting a completion                  → a whole word from 1 key
   *   - Reset / language switch replaced the buffer without updating `prev`,
   *     so the next single keystroke looked like a few-hundred-char insert
   *
   * Each of those inflated `pasted`, and the server turns
   * pasted/(pasted+typed) straight into the AI-use score.
   *
   * Now: every inserted character counts as typed, and a real paste moves its
   * characters from `typed` to `pasted`. Drag-and-drop is caught separately
   * because it raises no paste event. */
  const detectOn = acOn('ai_classifier_arena_enabled', true);
  const telemetry = useTypingTelemetry(detectOn);
  const { notePaste, noteBlockedPaste, noteKey, noteContent, rebase: rebaseStats } = telemetry;
  useEffect(() => { blockedRef.current = noteBlockedPaste; }, [noteBlockedPaste]);

  /* Drag-and-drop inserts text without firing a paste event.
     NOTE the capture flag: the copy-paste block registers its own canceller
     on `drop` in the BUBBLE phase, so a capture-phase listener here used to
     bank the characters a moment before the block threw them away — text
     that never reached the editor still pushed the score to 100. Listening
     in the bubble phase, after the block has had its say, fixes that:
     e.defaultPrevented tells us whether the drop actually landed. */
  useEffect(() => {
    if (!detectOn) return undefined;
    const onDrop = (e) => {
      const text = (e.dataTransfer && e.dataTransfer.getData('text')) || '';
      if (!text) return;
      if (e.defaultPrevented) noteBlockedPaste();
      else notePaste(text.length);
    };
    document.addEventListener('drop', onDrop);
    return () => document.removeEventListener('drop', onDrop);
  }, [detectOn, notePaste, noteBlockedPaste]);

  /* Keystroke rhythm. Printable keys only — modifiers and navigation are not
     content. This is the stream that still works when pasting is blocked. */
  useEffect(() => {
    if (!detectOn) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Tab')) noteKey();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [detectOn, noteKey]);

  const handleCode = (v) => {
    noteContent(v);
    setCode(v);
  };

  /* -------- screenshot (PrintScreen) block — problem-creator controlled -------- */
  const shotOn = acOn('screenshot_block_enabled', true);
  useEffect(() => {
    if (!shotOn) return undefined;
    const onShot = (e) => {
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        e.stopPropagation();
        toast.error('📸 Screenshot not allowed');
        try { if (navigator.clipboard) navigator.clipboard.writeText('Screenshot blocked by SmartODL').catch(() => {}); } catch (_) { /* ignore */ }
      }
    };
    document.addEventListener('keydown', onShot, true);
    return () => document.removeEventListener('keydown', onShot, true);
  }, [shotOn]);

  /* ------------- solve timer (admin sets minutes per problem) -------------
     The deadline is stored in localStorage per problem+user, so refreshing the
     page does NOT reset the clock. At zero the current code auto-submits. */
  const limitMin = Number((problem || {}).time_limit_minutes) || 0;
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [timeUp, setTimeUp] = useState(false);
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (!problem || !limitMin || problem.solved) { setSecondsLeft(null); return undefined; }
    const key = `odl-timer-${problem.id}-${user ? user.id : 'guest'}`;
    let deadline = 0;
    try { deadline = Number(window.localStorage.getItem(key)) || 0; } catch (_) { /* storage blocked */ }
    const now = Date.now();
    if (!deadline || deadline < now - 86400000) {
      deadline = now + limitMin * 60000;
      try { window.localStorage.setItem(key, String(deadline)); } catch (_) { /* ignore */ }
    }
    const tick = () => {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setTimeUp(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [problem && problem.id, limitMin, problem && problem.solved]);

  useEffect(() => {
    if (!timeUp || autoSubmitted.current) return;
    autoSubmitted.current = true;
    toast.error('⏰ Time up! Your current code is being submitted automatically');
    doSubmit();
    /* eslint-disable-next-line */
  }, [timeUp]);
  const fmtTimer = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  useEffect(() => {
    (async () => {
      try {
        const { data } = await codingApi.problem(id, contestId ? { contest_id: contestId } : undefined);
        const p = data.data;
        setProblem(p);
        const starters = p.starter_code || {};
        const initial = starters[lang] || STARTER[lang] || '';
        setCode(initial);
        rebaseStats(initial);
      } catch (e) {
        setError(e.message);
        if (e.details && e.details.code === 'PREMIUM_REQUIRED') setPremiumLocked(true);
      }
    })();
    /* eslint-disable-next-line */
  }, [id, contestId]);

  const loadSubs = () => {
    if (!user) return;
    codingApi.mySubmissions({ problem_id: id, limit: 10 }).then(({ data }) => setSubs(data.data)).catch(() => {});
  };
  useEffect(loadSubs, [user, id]);

  const changeLang = (next) => {
    setLang(next);
    const starters = (problem && problem.starter_code) || {};
    const tpl = starters[next] || STARTER[next] || '';
    setCode(tpl);
    rebaseStats(tpl);   // template swap is not the student typing
    setResult(null);
  };

  const doRun = async () => {
    setBotTab('result');
    setConsoleOpen(true);
    if (!user) { toast.error('Please login to run your code'); return navigate('/login', { state: { from: `/coding/${id}${contestId ? `?contest=${contestId}` : ''}` } }); }
    setRunning(true); setOutTab('output');
    try {
      const { data } = await codingApi.run({ language: lang, source_code: code, stdin: customInput, problem_id: problem.id, ...(contestId ? { contest_id: contestId } : {}) });
      // Mode 'sample' is LeetCode-style behaviour: when custom input was empty, the code ran
      // against the problem's sample test cases and produced a per-case pass/fail result.
      setResult({ kind: data.data.mode === 'sample' ? 'practice' : 'run', ...data.data });
    } catch (e) { toast.error(e.message); } finally { setRunning(false); }
  };

  const doSubmit = async () => {
    if (!user) { toast.error('Please login to submit your solution'); return navigate('/login', { state: { from: `/coding/${id}${contestId ? `?contest=${contestId}` : ''}` } }); }
    setSubmitting(true); setBotTab('result'); setConsoleOpen(true);
    try {
      const { data } = await codingApi.submit({
        problem_id: problem.id, language: lang, source_code: code, ...(contestId ? { contest_id: contestId } : {}),
        ...telemetry.snapshot(),
      });
      setResult({ kind: 'submit', ...data.data });
      if (data.data.status === 'accepted') {
        // show the "Solved" badge immediately — no page reload needed
        setProblem((p) => ({ ...p, solved: true }));
        toast.success(`Accepted ✓ +${data.data.score} points`);
      }
      else toast.error(STATUS_LABEL[data.data.status] || 'Not accepted yet');
      loadSubs();
    } catch (e) { toast.error(e.message); } finally { setSubmitting(false); }
  };

  const unlockHint = async () => {
    if (!user) { toast.error('Log in to unlock the hint'); return; }
    const cost = problem.hint ? problem.hint.hint_cost : 10;
    if (!window.confirm(`Unlock the hint? ${cost} points will be deducted.`)) return;
    setUnlocking(true);
    try {
      const { data } = await communityApi.unlockHint(problem.id);
      const d = data.data;
      setProblem((p) => ({ ...p, hints: d.hints, hint: { ...p.hint, hint_unlocked: true } }));
      toast.success(d.already ? 'The hint was already unlocked' : `Hint unlocked (-${d.cost} pts)`);
    } catch (e) { toast.error(e.message); } finally { setUnlocking(false); }
  };

  if (premiumLocked) return (
    <div className="container section" style={{ maxWidth: 640 }}>
      <div className="card center" style={{ padding: 34 }}>
        <div style={{ fontSize: 46 }} aria-hidden="true">⭐</div>
        <h2>Premium coding problem</h2>
        <p className="muted small">This problem is available only to subscribed students and developers.
        As soon as a plan is active, the statement, editor, Run Code, and Submit will all unlock.</p>
        <div className="row mt" style={{ justifyContent: 'center', gap: 8 }}>
          <Link className="btn btn-primary" to="/pricing">🚀 Get a plan and unlock</Link>
          <Link className="btn btn-ghost" to="/coding">← Free problems</Link>
        </div>
      </div>
    </div>
  );
  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!problem) return <Loader label="Loading problem…" />;

  const examples = problem.examples || [];
  const verdict = result && (result.kind === 'submit' || result.kind === 'practice') ? result : null;
  const runResult = result && result.kind === 'run' ? result : null;
  const isPractice = result && result.kind === 'practice';

  return (
    <div className="lc-full">
      <div className="between lc-top">
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-sm btn-ghost" to="/coding">← Arena</Link>
        </div>
        {/* LeetCode centres Run / Submit in the problem top bar */}
        <div className="lc-actions">
          <button className="btn btn-sm lc-run" title="Run code" disabled={running || timeUp} onClick={doRun}>
            {running ? '⏳ Running…' : '▶ Run'}
          </button>
          <button className="btn btn-sm lc-submit" disabled={submitting || timeUp} onClick={doSubmit}>
            {submitting ? 'Submitting…' : '⤴ Submit'}
          </button>
        </div>
        <div className="row" style={{ gap: 8 }} />
      </div>

      {secondsLeft !== null && !problem.solved && (
        <div className="between" style={{
          padding: '10px 16px', marginBottom: 14, borderRadius: 10, fontWeight: 700,
          background: timeUp ? 'rgba(239,68,68,.15)' : 'rgba(79,70,229,.12)',
          border: `1px solid ${timeUp || secondsLeft < 60 ? '#ef4444' : secondsLeft < 300 ? '#f59e0b' : '#22c55e'}`,
        }}>
          <span className="small">{timeUp ? '⏰ Time up — submission locked' : '⏱ Solve time limit (set by admin)'}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '1.15rem', color: timeUp || secondsLeft < 60 ? '#ef4444' : secondsLeft < 300 ? '#f59e0b' : '#22c55e' }}>
            {timeUp ? '00:00' : fmtTimer(secondsLeft)}
          </span>
        </div>
      )}

      <div className={`arena ${rightHidden ? 'right-hidden' : ''}`} ref={arenaRef}
        style={rightHidden ? undefined : { gridTemplateColumns: `${leftPct}fr 6px ${100 - leftPct}fr` }}>
        {/* ------------------------ description ------------------------ */}
        <div className="arena-left">
          <div className="lc-tabs">
            <button className={`lc-tab ${outTab === 'problem' ? 'active' : ''}`} onClick={() => setOutTab('problem')}>📄 Description</button>
            {problem.editorial_available && (
              <button className={`lc-tab ${outTab === 'editorial' ? 'active' : ''}`} onClick={() => setOutTab('editorial')}>📘 Editorial</button>
            )}
            <button className={`lc-tab ${outTab === 'subs' ? 'active' : ''}`} onClick={() => { setOutTab('subs'); loadSubs(); }}>🗂 Submissions</button>
            <button className={`lc-tab ${outTab === 'discuss' ? 'active' : ''}`} onClick={() => setOutTab('discuss')}>💬 Discuss</button>
            <button type="button" className="lc-tab-icon" aria-label={rightHidden ? 'Show code panel' : 'Hide code panel'} title={rightHidden ? 'Show code panel' : 'Hide code panel'} onClick={() => setRightHidden((v) => !v)}>{rightHidden ? '⛶' : '❮'}</button>
          </div>

          {outTab === 'editorial' && (
            <div className="arena-scroll">
              {problem.explanation
                ? <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{problem.explanation}</pre>
                : <div className="empty">An editorial has not been written for this problem yet.</div>}
            </div>
          )}

          {outTab === 'discuss' && (
            <div className="arena-scroll" style={{ padding: '14px 0' }}>
              {Number.isInteger(problem?.id) ? <Discussions parentType="problem" parentId={problem.id} /> : null}
            </div>
          )}

          {outTab === 'problem' && (
            <div className="arena-scroll">
              {/* LeetCode puts the numbered title and the meta pills inside the
                  Description pane, not in a strip above the split. */}
              <h1 className="lc-title">{problem.id}. {problem.title}</h1>
              <div className="lc-meta">
                <span className={`lc-diff lc-diff-${String(problem.difficulty || '').toLowerCase()}`}>
                  {String(problem.difficulty || '').replace(/^./, (c) => c.toUpperCase())}
                </span>
                {problem.solved && <span className="lc-chip lc-chip-solved">✓ Solved</span>}
                <span className="lc-chip">{problem.points} points</span>
                {problem.category_name && <span className="lc-chip">{problem.category_name}</span>}
                <span className="lc-chip">Acceptance {Number(problem.acceptance_rate).toFixed(1)}%</span>
              </div>
              <p className="lc-doc" style={{ whiteSpace: 'pre-wrap' }}>{lcText(problem.description)}</p>

              {problem.input_format && (<><h3>Input format</h3><p className="lc-doc muted small" style={{ whiteSpace: 'pre-wrap' }}>{lcText(problem.input_format)}</p></>)}
              {problem.output_format && (<><h3>Output format</h3><p className="lc-doc muted small" style={{ whiteSpace: 'pre-wrap' }}>{lcText(problem.output_format)}</p></>)}
              {problem.constraints && (<><h3>Constraints</h3><ul className="lc-list">{lcLines(problem.constraints).map((l, i) => <li key={i}>{lcText(l)}</li>)}</ul></>)}

              {examples.map((ex, i) => (
                <div key={ex.id} className="mt">
                  <h4>Example {i + 1}:</h4>
                  <div className="lc-example">
                    <div><strong>Input:</strong> <code className="lc-code-inline">{ex.input}</code></div>
                    <div><strong>Output:</strong> <code className="lc-code-inline">{ex.expected_output}</code></div>
                    {ex.explanation ? <div><strong>Explanation:</strong> <span className="small muted">{ex.explanation}</span></div> : null}
                  </div>
                </div>
              ))}

              {problem.hint && problem.hint.has_hint && !problem.hint.hint_unlocked
                && !(user && ['owner', 'admin', 'developer'].includes(user.role)) && (
                <div className="mt">
                  <h3>Hints</h3>
                  <div className="soft" style={{ padding: 16 }}>
                    <div className="between wrap" style={{ gap: 12 }}>
                      <span className="small">💡 Stuck? Unlock a hint for only <strong>{problem.hint.hint_cost} points</strong>.</span>
                      <button className="btn btn-sm btn-primary" disabled={unlocking} onClick={unlockHint}>
                        {unlocking ? 'Unlocking…' : '🔓 Unlock hint'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {problem.hints && (<><h3>Hints</h3><pre className="code-block">{problem.hints}</pre></>)}

              {examples.length > 0 && (
                <div className="soft mt-s small">
                  ℹ️ The example{examples.length > 1 ? 's' : ''} above cover{(examples.length > 1 ? '' : 's')} public tests only.
                  Submission runs {problem.test_cases_count} tests in total ({problem.hidden_test_cases_count} of them hidden).
                </div>
              )}
              {problem.tags && (
                <div className="row wrap mt" style={{ gap: 6 }}>
                  {toList(problem.tags).map((t) => <span className="tag" key={t}>#{t}</span>)}
                </div>
              )}
            </div>
          )}

          {outTab === 'subs' && (
            <div className="arena-scroll">
              {subs.length === 0 && <div className="empty">No submissions for this problem yet</div>}
              {subs.map((s) => (
                <div className="panel" key={s.id}>
                  <div className="between">
                    <div className="row" style={{ gap: 8 }}>
                      <span className={`badge ${s.status === 'accepted' ? 'green' : s.status === 'wrong_answer' ? 'red' : 'amber'}`}>
                        {STATUS_LABEL[s.status] || s.status}
                      </span>
                      <span className="tag">{s.language}</span>
                    </div>
                    <span className="tiny muted">{new Date(s.submitted_at).toLocaleString()}</span>
                  </div>
                  <div className="row wrap tiny muted mt-s" style={{ gap: 12 }}>
                    <span>{s.test_cases_passed}/{s.total_test_cases} tests passed</span>
                    <span>{Number(s.execution_time).toFixed(3)} s</span>
                    <span>{Number(s.memory_used) > 0 ? `${Number(s.memory_used).toFixed(1)} MB` : '—'}</span>
                    <span>{s.score} points</span>
                  </div>
                  <details className="mt-s">
                    <summary className="small" style={{ cursor: 'pointer' }}>View code</summary>
                    <pre className="code-block mt-s">{s.source_code}</pre>
                  </details>
                </div>
              ))}
            </div>
          )}

          <div className="lc-left-foot">
            <span title="Acceptance rate">👍 {Number(problem.acceptance_rate).toFixed(1)}%</span>
            <button type="button" className="click lc-foot-action" onClick={() => setOutTab('discuss')}>💬 Discuss</button>
            <span>⭐ {problem.points} pts</span>
            <span>⏱ {problem.time_limit_ms} ms · 💾 {(problem.memory_limit_kb / 1024).toFixed(0)} MB</span>
            <span className="online">● judge online</span>
          </div>
        </div>

        {!rightHidden && <div className="lc-divider" onPointerDown={startV} onDoubleClick={resetV} title="Drag to resize · double-click to reset" />}

        {/* --------------------------- editor --------------------------- */}
        <div className="arena-right">
          <div className="lc-code-head">
            <span className="title"><span className="lc-glyph">{'</>'}</span> Code</span>
            <span className="tiny muted">{lang}</span>
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>🛡 sandboxed judge</span>
          </div>
          {cpBlock && (
            <span className="gate-pill pending" style={{ display: 'inline-block', marginBottom: 8 }}>
              📋 copy-paste blocked by administrator
            </span>
          )}
          <Suspense fallback={<div className="loading"><div className="spinner" /><p className="muted mt-s">Loading the editor…</p></div>}>
          <CodeEditor language={lang} code={code} onCode={handleCode} onLanguage={changeLang} onPaste={notePaste}
            actions={(
              <>
                <button className="btn btn-sm btn-ghost" onClick={() => { setBotTab('testcase'); setConsoleOpen(true); }}>⌨ Custom input</button>
                <button className="btn btn-sm btn-ghost" disabled={running} onClick={() => { const tpl = ((problem.starter_code || {})[lang]) || STARTER[lang] || ''; setCode(tpl); rebaseStats(tpl); setResult(null); setConsoleOpen(false); }}>↺ Reset</button>
              </>
            )}
          />
          </Suspense>
          {consoleOpen && (
          <>
          <div className="lc-divider-h" onPointerDown={startH} onDoubleClick={resetH} title="Drag to resize · double-click to reset" />
          <div className="lc-bottom" style={{ height: botH }}>
            <div className="lc-tabs">
              <button className={`lc-tab ${botTab === 'testcase' ? 'active' : ''}`} onClick={() => setBotTab('testcase')}>✅ Testcase</button>
              <button className={`lc-tab ${botTab === 'result' ? 'active' : ''}`} onClick={() => setBotTab('result')}>{'>_'} Test Result</button>
              <button type="button" className="lc-tab-icon console-close" style={{ marginLeft: 'auto' }}
                onClick={() => setConsoleOpen(false)} title="Hide this panel" aria-label="Hide the test panel">✕</button>
            </div>
            <div className="lc-body">
          {botTab === 'result' && (
            <div>
              {!result && <div className="lc-empty">You must run your code first</div>}

              {runResult && (
                <>
                  <div className="between">
                    <Badge tone={runResult.status === 'accepted' ? 'green'
                      : ['wrong_answer', 'runtime_error', 'compilation_error', 'time_limit_exceeded', 'memory_limit_exceeded', 'internal_error'].includes(runResult.status) ? 'red'
                      : 'amber'}>
                      {STATUS_LABEL[runResult.status] || runResult.status || 'Done'}
                    </Badge>
                    <span className="tiny muted">Time {runResult.execution_time != null ? Number(runResult.execution_time).toFixed(3) : '—'} s • Memory {Number(runResult.memory) > 0 ? `${Number(runResult.memory).toFixed(1)} MB` : '—'}</span>
                  </div>
                  {runResult.output !== undefined && (
                    <><h4 className="mt">stdout</h4><pre className="code-block">{runResult.output || '(no output)'}</pre></>
                  )}
                  {runResult.compile_output && (<><h4 className="mt">Compiler output</h4><pre className="code-block err">{runResult.compile_output}</pre></>)}
                  {runResult.stderr && (<><h4 className="mt">stderr</h4><pre className="code-block err">{runResult.stderr}</pre></>)}
                </>
              )}

              {verdict && (
                <>
                  <div className={`verdict-box ${verdict.status === 'accepted' ? 'ok' : 'bad'}`}>
                    <div style={{ fontSize: '2rem' }}>{verdict.status === 'accepted' ? '✅' : '❌'}</div>
                    <div>
                      <strong style={{ fontSize: '1.1rem' }}>{STATUS_LABEL[verdict.status] || verdict.status}{verdict.status === 'accepted' ? ' ✓' : ''}</strong>
                      <div className="small">
                        {verdict.test_cases_passed} / {verdict.total_test_cases} Test Cases Passed,
                        {' '}Time: {Number(verdict.execution_time).toFixed(2)} sec,
                        {' '}Memory: {Number(verdict.memory_used) > 0 ? `${Number(verdict.memory_used).toFixed(0)} MB` : '—'}
                      </div>
                      {verdict.kind === 'submit' && verdict.status === 'accepted' && <div className="small">+{verdict.score} points awarded</div>}
                      {verdict.kind === 'practice' && <div className="small">⌨ Practice run against the sample test cases — no score or points are awarded (like LeetCode Run Code). Use the "Custom input" tab to test your own input.</div>}
                    </div>
                  </div>

                  {verdict.compile_output && (<><h4 className="mt">Compiler output</h4><pre className="code-block err">{verdict.compile_output}</pre></>)}
                  {verdict.stderr && (<><h4 className="mt">Runtime error</h4><pre className="code-block err">{verdict.stderr}</pre></>)}

                  <h4 className="mt">Test case results</h4>
                  <div className="stack" style={{ gap: 8 }}>
                    {(verdict.test_results || []).map((t, i) => (
                      <div className="panel" key={i}>
                        <div className="between">
                          <div className="row" style={{ gap: 8 }}>
                            <span className={`badge ${t.passed ? 'green' : 'red'}`}>{t.passed ? '✓ Passed' : '✗ Failed'}</span>
                            <span className="tag">{t.hidden ? `🔒 Hidden test ${i + 1}` : `Public test ${i + 1}`}</span>
                            {!t.hidden && <span className="tiny muted">{STATUS_LABEL[t.status] || t.status}</span>}
                          </div>
                          <span className="tiny muted">{Number(t.time).toFixed(3)} s</span>
                        </div>
                        {!t.hidden && (
                          <div className="grid g2 mt-s">
                            <div className="tiny muted">Got: <pre className="code-block" style={{ marginTop: 4 }}>{String(t.got || '').slice(0, 400) || '(empty)'}</pre></div>
                            <div className="tiny muted">Expected: <pre className="code-block" style={{ marginTop: 4 }}>{String(t.expected_output || '').slice(0, 400)}</pre></div>
                          </div>
                        )}
                        {t.hidden && !t.passed && <div className="tiny muted mt-s">Hidden test data is not revealed. Check edge cases, constraints and output formatting.</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
            </div>
            {botTab === 'testcase' && (
              <div className="lc-body" style={{ borderTop: '1px solid var(--line)' }}>
                <p className="small muted">Test the code with your own input. <strong>If you leave it blank, the problem's sample test cases will be used (like LeetCode)</strong>, so it will not crash:</p>
                <textarea className="textarea lc-testcase" aria-label="Custom test input" rows={5} value={customInput} onChange={(e) => setCustomInput(e.target.value)} placeholder={"Enter input here, for example:\n5\n1 2 3 4 5"} />
                <div className="row mt-s" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setCustomInput('')}>Clear</button>
                  <button className="btn btn-sm btn-primary" disabled={running || timeUp} onClick={doRun}>▶ Run with this input</button>
                </div>
              </div>
            )}
          </div>
          </>
          )}
          <div className="soft tiny mt-s">
            🛡 Your code runs in an isolated sandbox worker ({LANGS.find((l) => l.slug === lang)?.name} {LANGS.find((l) => l.slug === lang)?.version}).
            Time limit {problem.time_limit_ms} ms, memory limit {(problem.memory_limit_kb / 1024).toFixed(0)} MB.
          </div>
          {problem.my_submission && (
            <div className="card mt-s">
              <div className="between">
                <span className="small">Last submission</span>
                <span className={`badge ${problem.my_submission.status === 'accepted' ? 'green' : 'red'}`}>{STATUS_LABEL[problem.my_submission.status] || problem.my_submission.status}</span>
              </div>
            </div>
          )}
        </div>
      </div>


    </div>
  );
}
