import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { quizApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, DiffBadge, Empty, Loader, Modal, StatusBadge } from '../components/ui';
import JsonImportPrompt from '../components/JsonImportPrompt';
import { DIFFICULTIES, LANGS, QUESTION_TYPES, STARTER } from '../utils/constants';
import { downloadJson, safeJsonFilename } from '../utils/jsonTransfer';

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : (p ? [p] : []); } catch { return v ? [v] : []; } }
  return v ? [v] : [];
};

const EMPTY = {
  type: 'mcq', question_text: '', code_snippet: '', marks: 2, negative_marks: 0, difficulty: 'easy',
  options: ['', '', '', ''], correct_answer: '', explanation: '', time_limit_seconds: '',
  // coding questions only
  coding_languages: ['python', 'c', 'cpp', 'java', 'javascript'],
  starter_code: {}, test_cases: [], time_limit_ms: 2000, memory_limit_kb: 262144,
};


/** Question bank builder: add / edit / delete / reorder + live controls + results. */
export default function QuizBuilder({ scope = 'admin' }) {
  const { id } = useParams();
  const toast = useToast();
  const { can } = useAuth();
  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [langTab, setLangTab] = useState('python');
  const base = scope === 'admin' ? '/admin' : '/developer';

  const load = async () => {
    try {
      const [q, qs, r] = await Promise.all([quizApi.get(id), quizApi.questions(id), quizApi.results(id)]);
      setQuiz(q.data.data);
      setQuestions(qs.data.data);
      setResults(r.data.data || []);
    } catch (e) { toast.error(e.message); setQuestions([]); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, options: ['', '', '', ''], test_cases: [{ input: '', expected_output: '', hidden: false }] }); setLangTab('python'); setOpen(true); };

  const toggleLanguage = (slug) => setForm((f) => ({
    ...f,
    coding_languages: f.coding_languages.includes(slug) ? f.coding_languages.filter((x) => x !== slug) : [...f.coding_languages, slug],
  }));

  const setCase = (i, patch) => setForm((f) => ({
    ...f,
    test_cases: f.test_cases.map((t, x) => (x === i ? { ...t, ...patch } : t)),
  }));

  const openEdit = (q) => {
    setEditing(q);
    const key = asArray(q.correct_answer);
    setForm({
      type: q.type, question_text: q.question_text, code_snippet: q.code_snippet || '',
      marks: q.marks, negative_marks: q.negative_marks || 0, difficulty: q.difficulty,
      options: asArray(q.options).length ? asArray(q.options) : ['', '', '', ''],
      correct_answer: q.type === 'multiple' ? key.join(' | ') : (key[0] || ''),
      explanation: q.explanation || '',
      coding_languages: asArray(q.coding_languages).length ? asArray(q.coding_languages) : EMPTY.coding_languages,
      starter_code: (() => { try { const p = JSON.parse(q.starter_code || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } })(),
      test_cases: asArray(q.test_cases).map((t) => ({ input: t.input || '', expected_output: t.expected_output || '', hidden: !!t.hidden })),
      time_limit_ms: q.time_limit_ms || 2000,
      memory_limit_kb: q.memory_limit_kb || 262144,
      time_limit_seconds: q.time_limit_seconds || '',
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const opts = form.type === 'short_answer' || form.type === 'coding' || form.type === 'multiple' ? form.options.filter((o) => o !== '') : form.options.filter((o) => o !== '');
      const correct = form.type === 'multiple'
        ? form.correct_answer.split('|').map((s) => s.trim()).filter(Boolean)
        : form.type === 'short_answer'
          ? form.correct_answer.split('|').map((s) => s.trim()).filter(Boolean)
          : form.correct_answer;
      const payload = {
        type: form.type,
        question_text: form.question_text,
        code_snippet: form.code_snippet || null,
        marks: Number(form.marks),
        negative_marks: Number(form.negative_marks),
        difficulty: form.difficulty,
        options: ['short_answer', 'coding'].includes(form.type) ? [] : opts,
        correct_answer: correct,
        explanation: form.explanation || null,
        time_limit_seconds: form.time_limit_seconds ? Number(form.time_limit_seconds) : null,
        ...(form.type === 'coding' ? {
          coding_languages: form.coding_languages,
          starter_code: form.starter_code,
          test_cases: form.test_cases
            .filter((t) => t.expected_output !== '' || t.input !== '')
            .map((t) => ({ input: t.input, expected_output: t.expected_output, hidden: !!t.hidden })),
          time_limit_ms: Number(form.time_limit_ms) || 2000,
          memory_limit_kb: Number(form.memory_limit_kb) || 262144,
        } : {}),
      };
      if (editing) await quizApi.updateQuestion(editing.id, payload);
      else await quizApi.addQuestion(id, payload);
      toast.success(editing ? 'Question updated' : 'Question added');
      setOpen(false); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const remove = async (q) => {
    if (!window.confirm('Delete this question?')) return;
    try { await quizApi.removeQuestion(q.id); toast.success('Question deleted'); load(); } catch (e) { toast.error(e.message); }
  };

  const move = async (index, dir) => {
    const next = [...questions];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setQuestions(next);
    try {
      await quizApi.reorderQuestions(next.map((q, i) => ({ id: q.id, position: i + 1 })));
    } catch (e) { toast.error(e.message); }
  };

  const startLive = async () => {
    const minutes = window.prompt('Duration in minutes', quiz.time_limit_minutes || 10);
    if (!minutes) return;
    try { await quizApi.startLive(id, { time_limit_minutes: Number(minutes) }); toast.success('Live quiz started 📡'); load(); }
    catch (e) { toast.error(e.message); }
  };

  const endLive = async () => {
    if (!window.confirm('End the live quiz now? Running attempts are auto-submitted and graded.')) return;
    try {
      const { data } = await quizApi.endLive(id);
      toast.success(`Quiz ended — ${data.data.auto_submitted} attempt(s) auto-submitted`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const publish = async (status) => {
    try { await quizApi.update(id, { status }); toast.success(`Quiz ${status}`); load(); } catch (e) { toast.error(e.message); }
  };

  const exportJson = async () => {
    setTransferBusy(true);
    try {
      const { data } = await quizApi.exportOne(id);
      downloadJson(data.data, `${safeJsonFilename(quiz?.title, 'quiz')}.json`);
      toast.success('Quiz, answers and questions exported to JSON');
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  if (!questions) return <Loader label="Loading question bank…" />;

  const setOption = (i, value) => setForm((f) => {
    const options = [...f.options];
    options[i] = value;
    return { ...f, options };
  });

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          <Link className="link small" to={`${base}/quizzes`}>← All quizzes</Link>
          <h2 style={{ marginBottom: 2 }}>{quiz ? quiz.title : `Quiz #${id}`}</h2>
          <div className="row wrap" style={{ gap: 8 }}>
            {quiz && <StatusBadge value={quiz.status} />}
            {quiz && <span className="tag">{quiz.quiz_type}</span>}
            {quiz && <span className="tag">⏱ {quiz.time_limit_minutes} min</span>}
            <span className="tag">❓ {questions.length} questions</span>
            {quiz && <span className="tag">🎯 {quiz.total_marks} marks</span>}
            {quiz && Number(quiz.negative_marking) > 0 && <span className="tag">➖ {quiz.negative_marking}</span>}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <JsonImportPrompt defaultPrompt="quiz" />
          <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={exportJson}>⬇ Export JSON</button>
          <button className="btn btn-ghost" onClick={() => window.open(`/quizzes/${id}`, '_blank')}>👁 Preview</button>
          {quiz && quiz.status === 'published'
            ? <button className="btn btn-ghost" onClick={() => publish('draft')}>🙈 Unpublish</button>
            : <button className="btn btn-ghost" onClick={() => publish('published')}>🚀 Publish</button>}
          {can('host_quiz') && quiz && quiz.status !== 'live' && <button className="btn btn-primary" onClick={startLive}>📡 Start live</button>}
          {quiz && quiz.status === 'live' && (
            <>
              <Link className="btn btn-ghost" to={`${base}/live/${id}`}>📊 Monitor</Link>
              <button className="btn btn-danger" onClick={endLive}>⏹ End live</button>
            </>
          )}
          <button className="btn btn-primary" onClick={openCreate}>➕ Add question</button>
        </div>
      </div>

      {questions.length === 0 && <Empty title="No questions yet" hint="Add MCQ, multiple-correct, true/false, short answer or coding questions." />}

      <div className="stack">
        {questions.map((q, i) => (
          <div className="card" key={q.id}>
            <div className="between">
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="badge violet">Q{i + 1}</span>
                <span className="tag">{q.type.replace('_', ' ')}</span>
                <DiffBadge value={q.difficulty} />
                <span className="tag">{q.marks} marks</span>
                {Number(q.negative_marks) > 0 && <span className="tag">−{q.negative_marks}</span>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="btn btn-sm btn-ghost" disabled={i === questions.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="btn btn-sm btn-ghost" onClick={() => openEdit(q)}>✏️</button>
                <button className="btn btn-sm btn-ghost" onClick={() => remove(q)}>🗑</button>
              </div>
            </div>
            <p style={{ marginTop: 10, fontWeight: 600 }}>{q.question_text}</p>
            {q.code_snippet && <pre className="code-block">{q.code_snippet}</pre>}
            {asArray(q.options).length > 0 && (
              <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                {asArray(q.options).map((o, oi) => {
                  const key = asArray(q.correct_answer);
                  const isCorrect = key.some((k) => String(k) === String(o));
                  return <span className={`quiz-option ${isCorrect ? 'correct' : ''}`} key={oi} style={{ padding: '6px 12px' }}>{o} {isCorrect ? '✓' : ''}</span>;
                })}
              </div>
            )}
            {q.type === 'coding' && (
              <div className="mt-s">
                <div className="row wrap" style={{ gap: 8 }}>
                  {asArray(q.coding_languages).map((slug) => (
                    <span className="tag" key={slug}>{(LANGS.find((l) => l.slug === slug) || { name: slug }).name}</span>
                  ))}
                  <span className={`tag ${asArray(q.test_cases).length ? '' : 'tag-danger'}`}>🧪 {asArray(q.test_cases).length} test cases</span>
                  <span className="tag">🔒 {asArray(q.test_cases).filter((t) => t.hidden).length} hidden</span>
                  <span className="tag">⏱ {(q.time_limit_ms || 2000) / 1000}s</span>
                </div>
                {asArray(q.test_cases).length === 0 && (
                  <div className="notice warn mt-s small">⚠ No test cases — this question awards no marks until you add test cases.</div>
                )}
              </div>
            )}
            {q.type !== 'coding' && asArray(q.options).length === 0 && (
              <div className="soft mt-s small">Accepted answers: <strong>{asArray(q.correct_answer).join(' | ') || '—'}</strong></div>
            )}
            {q.explanation && <div className="tiny muted mt-s">💡 {q.explanation}</div>}
          </div>
        ))}
      </div>

      {results.length > 0 && (
        <div className="card mt">
          <div className="between mb-s"><h3>📊 Results</h3><Link className="link small" to={`/quizzes/${id}/results`}>Public results page →</Link></div>
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead><tr><th>Rank</th><th>Student</th><th>Score</th><th>Accuracy</th><th>Time</th><th>Status</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.rank_position}>
                    <td><strong>#{r.rank_position}</strong></td>
                    <td>{r.full_name}</td>
                    <td>{Number(r.score)}/{r.total_marks}</td>
                    <td>{Number(r.accuracy).toFixed(1)}%</td>
                    <td className="small">{Math.floor(r.time_taken_seconds / 60)}m {r.time_taken_seconds % 60}s</td>
                    <td><Badge tone={r.score / r.total_marks >= 0.4 ? 'green' : 'amber'}>{r.passed ? 'passed' : 'failed'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={open} title={editing ? 'Edit question' : 'Add question'} onClose={() => setOpen(false)} wide>
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field">Question type
              <select className="select" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, correct_answer: '' }))}>
                {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="field">Difficulty
              <select className="select" value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="field">Marks
              <input className="input" type="number" min="1" value={form.marks} onChange={(e) => setForm((f) => ({ ...f, marks: e.target.value }))} />
            </label>
            <label className="field">Negative marks
              <input className="input" type="number" min="0" step="0.25" value={form.negative_marks} onChange={(e) => setForm((f) => ({ ...f, negative_marks: e.target.value }))} />
            </label>
            <label className="field" title="Countdown for this question in a live quiz, in seconds. Blank or 0 means no limit">⏱ Time (sec — 0 = no limit)
              <input className="input" type="number" min="0" value={form.time_limit_seconds ?? ''} onChange={(e) => setForm((f) => ({ ...f, time_limit_seconds: e.target.value }))} />
            </label>
            <label className="field full">Question text *
              <textarea className="textarea" rows="2" required value={form.question_text} onChange={(e) => setForm((f) => ({ ...f, question_text: e.target.value }))} />
            </label>
            <label className="field full">Code snippet (optional)
              <textarea className="textarea code" rows="4" value={form.code_snippet} onChange={(e) => setForm((f) => ({ ...f, code_snippet: e.target.value }))} placeholder="print(len([1,2,3]))" />
            </label>

            {form.type !== 'short_answer' && form.type !== 'coding' && (
              <div className="field full">
                Options
                {form.options.map((o, i) => (
                  <div className="row mt-s" key={i} style={{ gap: 8 }}>
                    <input className="input" value={o} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm((f) => ({ ...f, options: f.options.filter((_, x) => x !== i) }))}>✕</button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm mt-s" onClick={() => setForm((f) => ({ ...f, options: [...f.options, ''] }))}>➕ Add option</button>
              </div>
            )}

            {form.type === 'multiple' && (
              <label className="field full">Correct answers (separate multiple options with |)
                <input className="input" value={form.correct_answer} onChange={(e) => setForm((f) => ({ ...f, correct_answer: e.target.value }))} placeholder="Option A | Option C" />
              </label>
            )}
            {(form.type === 'mcq' || form.type === 'true_false') && (
              <label className="field full">Correct answer
                {form.type === 'true_false' ? (
                  <select className="select" value={form.correct_answer} onChange={(e) => setForm((f) => ({ ...f, correct_answer: e.target.value }))}>
                    <option value="">— choose —</option>
                    <option value="True">True</option><option value="False">False</option>
                  </select>
                ) : (
                  <input className="input" required value={form.correct_answer} onChange={(e) => setForm((f) => ({ ...f, correct_answer: e.target.value }))} placeholder="Must match one of the options exactly" />
                )}
              </label>
            )}
            {form.type === 'short_answer' && (
              <label className="field full">Accepted answers (separate alternatives with |)
                <input className="input" value={form.correct_answer} onChange={(e) => setForm((f) => ({ ...f, correct_answer: e.target.value }))} placeholder="O(1) | constant | o(1)" />
              </label>
            )}
            {form.type === 'coding' && (
              <div className="field full coding-config">
                <div className="between wrap">
                  <strong>🧑‍💻 Compiler &amp; test cases</strong>
                  <span className="tiny muted">The student's code runs in the sandboxed judge — hidden cases are never sent to the browser.</span>
                </div>

                <div className="small mt-s"><strong>Allowed languages</strong> (the student picks one)</div>
                <div className="row wrap" style={{ gap: 10, marginTop: 6 }}>
                  {LANGS.filter((l) => l.slug !== 'sql').map((l) => (
                    <label className="check tiny" key={l.slug}>
                      <input type="checkbox" checked={form.coding_languages.includes(l.slug)} onChange={() => toggleLanguage(l.slug)} /> {l.name}
                    </label>
                  ))}
                </div>

                <div className="row wrap mt-s" style={{ gap: 14 }}>
                  <label className="field" style={{ maxWidth: 170 }}>Time limit (ms)
                    <input className="input" type="number" min="500" step="500" value={form.time_limit_ms} onChange={(e) => setForm((f) => ({ ...f, time_limit_ms: e.target.value }))} />
                  </label>
                  <label className="field" style={{ maxWidth: 190 }}>Memory limit (KB)
                    <input className="input" type="number" min="16384" step="16384" value={form.memory_limit_kb} onChange={(e) => setForm((f) => ({ ...f, memory_limit_kb: e.target.value }))} />
                  </label>
                </div>

                <div className="mt-s">
                  <div className="between wrap">
                    <span className="small"><strong>Starter code</strong> — what the student sees in the editor</span>
                    <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => setForm((f) => ({ ...f, starter_code: { ...f.starter_code, [langTab]: STARTER[langTab] || '' } }))}>
                      ✨ Insert platform template
                    </button>
                  </div>
                  <div className="starter-tabs">
                    {form.coding_languages.map((slug) => (
                      <button type="button" key={slug} className={`chip ${langTab === slug ? 'active' : ''}`} onClick={() => setLangTab(slug)}>
                        {(LANGS.find((l) => l.slug === slug) || { name: slug }).name}
                      </button>
                    ))}
                    {!form.coding_languages.length && <span className="tiny muted">Select at least one language above.</span>}
                  </div>
                  <textarea className="textarea code" rows="6" value={form.starter_code[langTab] || ''}
                    onChange={(e) => setForm((f) => ({ ...f, starter_code: { ...f.starter_code, [langTab]: e.target.value } }))}
                    placeholder={STARTER[langTab] || 'Starter code…'} />
                </div>

                <div className="mt">
                  <div className="between wrap">
                    <span className="small">
                      <strong>Test cases</strong> · {form.test_cases.length} total · {form.test_cases.filter((t) => t.hidden).length} hidden
                      {' · '}{form.test_cases.filter((t) => !t.hidden).length} shown to students
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm((f) => ({ ...f, test_cases: [...f.test_cases, { input: '', expected_output: '', hidden: false }] }))}>➕ Add test case</button>
                  </div>
                  {form.test_cases.length === 0 && (
                    <div className="notice warn mt-s small">⚠ No test cases yet — students cannot run or submit this question until you add at least one.</div>
                  )}
                  {form.test_cases.map((t, i) => (
                    <div className="case-editor" key={i}>
                      <div className="between wrap">
                        <span className="small">
                          <strong>Case {i + 1}</strong>{' '}
                          <Badge tone={t.hidden ? 'amber' : 'green'}>{t.hidden ? 'hidden' : 'public'}</Badge>
                        </span>
                        <div className="row" style={{ gap: 8 }}>
                          <label className="check tiny"><input type="checkbox" checked={!!t.hidden} onChange={(e) => setCase(i, { hidden: e.target.checked })} /> hidden</label>
                          <button type="button" className="btn btn-ghost btn-sm" title="Remove case"
                            onClick={() => setForm((f) => ({ ...f, test_cases: f.test_cases.filter((_, x) => x !== i) }))}>✕</button>
                        </div>
                      </div>
                      <div className="grid-2">
                        <label className="field">Input (stdin)
                          <textarea className="textarea code" rows="3" value={t.input} onChange={(e) => setCase(i, { input: e.target.value })} placeholder="6 7" />
                        </label>
                        <label className="field">Expected output
                          <textarea className="textarea code" rows="3" value={t.expected_output} onChange={(e) => setCase(i, { expected_output: e.target.value })} placeholder="13" />
                        </label>
                      </div>
                    </div>
                  ))}
                  {form.test_cases.length > 0 && (
                    <div className="tiny muted mt-s">Full marks are awarded only when every test case passes. Compare ignores trailing spaces and blank lines.</div>
                  )}
                </div>
              </div>
            )}

            <label className="field full">Explanation (shown after submission)
              <textarea className="textarea" rows="2" value={form.explanation} onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))} />
            </label>
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save question' : 'Add question'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
