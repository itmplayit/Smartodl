import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { quizApi, miscApi, courseApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import { DiffBadge, Empty, Loader, Modal, StatusBadge } from '../components/ui';
import JsonImportPrompt from '../components/JsonImportPrompt';
import { DIFFICULTIES, QUESTION_TYPES } from '../utils/constants';
import { downloadJson, readJsonFile, safeJsonFilename, transferCount } from '../utils/jsonTransfer';

const base = (scope) => (scope === 'admin' ? '/admin' : '/developer');

export default function QuizzesManager({ scope = 'admin' }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const { isOn } = useSettings();
  const moduleQuizzesOn = isOn('module_quizzes_enabled', true);
  const [moduleOptions, setModuleOptions] = useState([]);
  // Arriving from the modules screen: /admin/quizzes?course=1&module=2 opens the
  // create form already linked to that module.
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [cats, setCats] = useState([]);
  const [courseOptions, setCourseOptions] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', quiz_type: '', page: 1, creator_role: '' });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const importInputRef = useRef(null);
  const [form, setForm] = useState({
    title: '', description: '', category_id: '', course_id: '', difficulty: 'easy', quiz_type: 'normal', negative_marking: 0,
    time_limit_minutes: 15, passing_score: 40, start_at: '', end_at: '', max_participants: '', status: 'draft',
    shuffle_questions: 0, show_answers_after: 1, allow_reattempt: 1, is_private: 0, access_password: '', module_id: '',
  });

  const load = async () => {
    try { const { data } = await quizApi.list({ ...filters, limit: 10, ...(scope === 'developer' ? { mine: 1 } : {}) }); setRows(data.data); setMeta(data.meta); }
    catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [JSON.stringify(filters)]);
  useEffect(() => { miscApi.categories().then(({ data }) => setCats(data.data)).catch(() => {}); }, []);
  useEffect(() => {
    // Only used to link a quiz to the course whose certificate shows its
    // integrity review band; the list is safe to fetch for staff only.
    courseApi.list({ limit: 200, ...(scope === 'developer' ? { mine: 1 } : {}) })
      .then(({ data }) => setCourseOptions(data.data || []))
      .catch(() => setCourseOptions([]));
  }, [scope]);

  const prefillRef = useRef(false);
  useEffect(() => {
    if (prefillRef.current || !moduleQuizzesOn) return;
    const courseFromQuery = searchParams.get('course');
    if (!courseFromQuery) return;
    prefillRef.current = true;
    setEditing(null);
    setForm((f) => ({
      ...f,
      course_id: courseFromQuery,
      module_id: searchParams.get('module') || '',
      status: 'draft',
    }));
    setOpen(true);
  }, [searchParams, moduleQuizzesOn]);

  // Modules of the selected course — needed for the "every module has a quiz"
  // dropdown. A module quiz must belong to the quiz's own course.
  useEffect(() => {
    if (!form.course_id || !moduleQuizzesOn) { setModuleOptions([]); return undefined; }
    let alive = true;
    courseApi.get(form.course_id)
      .then(({ data }) => { if (alive) setModuleOptions(data.data.modules || []); })
      .catch(() => { if (alive) setModuleOptions([]); });
    return () => { alive = false; };
  }, [form.course_id, moduleQuizzesOn]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      title: '', description: '', category_id: '', course_id: '', difficulty: 'easy', quiz_type: 'normal', negative_marking: 0,
      time_limit_minutes: 15, passing_score: 40, start_at: '', end_at: '', max_participants: '', status: 'draft',
      shuffle_questions: 0, show_answers_after: 1, allow_reattempt: 1, is_private: 0, access_password: '', module_id: '',
    });
    setOpen(true);
  };

  const openEdit = (z) => {
    setEditing(z);
    setForm({
      title: z.title, description: z.description || '', category_id: z.category_id || '',
      course_id: z.course_id || '', module_id: z.module_id || '', difficulty: z.difficulty,
      quiz_type: z.quiz_type, negative_marking: z.negative_marking, time_limit_minutes: z.time_limit_minutes,
      passing_score: z.passing_score, start_at: z.start_at ? String(z.start_at).slice(0, 16).replace(' ', 'T') : '',
      end_at: z.end_at ? String(z.end_at).slice(0, 16).replace(' ', 'T') : '', max_participants: z.max_participants || '',
      status: z.status, shuffle_questions: z.shuffle_questions, show_answers_after: z.show_answers_after, allow_reattempt: z.allow_reattempt,
      is_private: z.is_private ? 1 : 0, access_password: '',
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        start_at: form.start_at ? form.start_at.replace('T', ' ') + ':00' : null,
        end_at: form.end_at ? form.end_at.replace('T', ' ') + ':00' : null,
        max_participants: form.max_participants || null,
        course_id: form.course_id ? Number(form.course_id) : null,
        // A module quiz is a normal quiz attached to one module of its course.
        module_id: form.course_id && form.module_id ? Number(form.module_id) : null,
      };
      if (editing) await quizApi.update(editing.id, payload);
      else await quizApi.create(payload);
      toast.success(editing ? 'Quiz updated' : 'Quiz created — add questions next');
      setOpen(false); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const publish = async (z) => {
    try { await quizApi.update(z.id, { status: z.status === 'published' ? 'draft' : 'published' }); toast.success('Status updated'); load(); }
    catch (e) { toast.error(e.message); }
  };

  const togglePremium = async (z) => {
    try {
      await quizApi.update(z.id, { is_premium: Number(z.is_premium) ? 0 : 1 });
      toast.success(Number(z.is_premium) ? '⭐ Premium removed' : '⭐ Marked as PREMIUM — only subscribed students can attempt it');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const startLive = async (z) => {
    const minutes = window.prompt('Live quiz duration in minutes', z.time_limit_minutes || 10);
    if (!minutes) return;
    try {
      await quizApi.startLive(z.id, { time_limit_minutes: Number(minutes) });
      toast.success('Live quiz started — students notified 📡');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const remove = async (z) => {
    if (!window.confirm(`Delete quiz “${z.title}”? Attempts and answers are removed too.`)) return;
    try { await quizApi.remove(z.id); toast.success('Quiz deleted'); load(); } catch (e) { toast.error(e.message); }
  };

  const exportOne = async (quiz) => {
    setTransferBusy(true);
    try {
      const { data } = await quizApi.exportOne(quiz.id);
      downloadJson(data.data, `${safeJsonFilename(quiz.title, 'quiz')}.json`);
      toast.success('Quiz and questions exported safely');
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  const exportAll = async () => {
    setTransferBusy(true);
    try {
      const { data } = await quizApi.exportAll();
      downloadJson(data.data, `smartodl-quizzes-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success(`${transferCount(data.data)} quiz package(s) exported`);
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTransferBusy(true);
    try {
      const pack = await readJsonFile(file, 'quizzes');
      if (!window.confirm(`Import ${transferCount(pack)} quiz(es) as new non-private drafts? Existing quizzes will not be overwritten.`)) return;
      const { data } = await quizApi.importJson(pack);
      toast.success(`${data.data.imported_count} quiz(es) imported as drafts; access passwords were excluded`);
      await load();
    } catch (e) { toast.error(e.message); } finally { setTransferBusy(false); }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Assessments</span><h2>Quiz management</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Create quizzes, add MCQ / multiple-correct / true-false / short-answer / coding questions, schedule them and host live.</p></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
          {can('create_quiz') && <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={() => importInputRef.current?.click()}>⬆ Import Quiz JSON</button>}
          {can('create_quiz') && <JsonImportPrompt defaultPrompt="quiz" />}
          {can('create_quiz') && <button className="btn btn-ghost" type="button" disabled={transferBusy} onClick={exportAll}>⬇ Export all JSON</button>}
          <Link className="btn btn-ghost" to={`${base(scope)}/live`}>📡 Live hosting</Link>
          <button className="btn btn-primary" onClick={openCreate}>➕ Create quiz</button>
        </div>
      </div>

      <div className="card mb">
        <div className="form-grid">
          <label className="field full">Search
            <input className="input" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))} placeholder="Quiz title…" />
          </label>
          <label className="field">Status
            <select className="select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}>
              <option value="">All</option>
              {['draft', 'published', 'scheduled', 'live', 'completed'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">Type
            <select className="select" value={filters.quiz_type} onChange={(e) => setFilters((f) => ({ ...f, quiz_type: e.target.value, page: 1 }))}>
              <option value="">All</option>
              {['normal', 'live', 'practice'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      {scope === 'admin' && (
        <div className="row wrap mb" style={{ gap: 8, marginTop: -6 }}>
          <span className="tiny muted" style={{ alignSelf: 'center' }}>Creator filter:</span>
          {[['', '📂 All'], ['developer', '👨‍💻 Developers'], ['admin', '🛡 Admins']].map(([v, label]) => (
            <button key={v} className={filters.creator_role === v ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => setFilters((f) => ({ ...f, creator_role: v, page: 1 }))}>{label}</button>
          ))}
        </div>
      )}
      {scope === 'developer' && (
        <div className="tiny muted mb" style={{ marginTop: -6 }}>👤 Only content created by you is shown here — administrator content is not displayed in the developer panel.</div>
      )}
      {!rows && <Loader label="Loading quizzes…" />}
      {rows && rows.length === 0 && <Empty title="No quizzes yet" hint="Create your first quiz and add questions." />}

      {rows && rows.length > 0 && (
        <div className="table-wrap scroll-x">
          <table className="table">
            <thead><tr><th>Quiz</th><th>Type</th><th>Level</th><th>Questions</th><th>Marks</th><th>Time</th><th>Schedule</th><th>Status</th><th style={{ width: 360 }}>Actions</th></tr></thead>
            <tbody>
              {rows.map((z) => (
                <tr key={z.id}>
                  <td style={{ minWidth: 200 }}>
                    <Link className="link" style={{ fontWeight: 600 }} to={`${base(scope)}/quizzes/${z.id}`}>{z.title}</Link>
                    {Number(z.is_private) === 1 && <span className="tag">🔒 private</span>}
                    {z.module_id && <span className="tag" title="Course page par isi module ke andar dikhta hai">📚 module quiz</span>}
                    <div className="tiny muted">{(z.description || '').slice(0, 60)}</div>
                    <div className="tiny muted">by {scope === 'admin' ? (z.created_by_role === 'developer' ? '👨‍💻 ' : '🛡 ') : ''}{z.created_by_name || '—'}</div>
                  </td>
                  <td><span className="tag">{z.quiz_type}</span></td>
                  <td><DiffBadge value={z.difficulty} /></td>
                  <td>{z.question_count || z.actual_question_count}</td>
                  <td>{z.total_marks}</td>
                  <td className="small">{z.time_limit_minutes} min</td>
                  <td className="tiny muted">
                    {z.start_at ? `from ${new Date(z.start_at).toLocaleString()}` : 'unscheduled'}
                    {z.end_at ? <div>to {new Date(z.end_at).toLocaleString()}</div> : null}
                  </td>
                  <td><StatusBadge value={z.status} /></td>
                  <td>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <Link className="btn btn-sm btn-ghost" to={`${base(scope)}/quizzes/${z.id}`}>🧠 Questions</Link>
                      <Link className="btn btn-sm btn-ghost" to={`/quizzes/${z.id}/results`}>📊</Link>
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(z)}>✏️</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => publish(z)}>{z.status === 'published' ? '🙈' : '🚀'}</button>
                      {scope === 'admin' && (
                        <button className="btn btn-sm btn-ghost" title="Premium toggle (administrators only)" onClick={() => togglePremium(z)}>
                          {Number(z.is_premium) ? '⭐' : '☆'}
                        </button>
                      )}
                      {can('host_quiz') && z.status !== 'live' && <button className="btn btn-sm btn-ghost" onClick={() => startLive(z)}>📡 Start live</button>}
                      {z.status === 'live' && <Link className="btn btn-sm btn-danger" to={`${base(scope)}/live/${z.id}`}>● Monitor</Link>}
                      {can('create_quiz') && <button className="btn btn-sm btn-ghost" disabled={transferBusy} onClick={() => exportOne(z)} title="Export quiz and questions as JSON">⬇ JSON</button>}
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(z)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(meta && meta.pages > 1) && (
        <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" disabled={meta.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Prev</button>
          <span className="tiny muted">Page {meta.page} / {meta.pages}</span>
          <button className="btn btn-sm btn-ghost" disabled={meta.page >= meta.pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next →</button>
        </div>
      )}

      <div className="soft small mt">🧠 Question types supported: {QUESTION_TYPES.map((t) => t.label || t).join(' · ')}</div>

      <Modal open={open} title={editing ? `Edit quiz: ${editing.title}` : 'Create quiz'} onClose={() => setOpen(false)} wide>
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field full">Title *
              <input className="input" required value={form.title} onChange={set('title')} placeholder="Python Fundamentals — Practice Test" />
            </label>
            <label className="field full">Description
              <textarea className="textarea" rows="3" value={form.description} onChange={set('description')} placeholder="What is covered? Instructions for students." />
            </label>
            <label className="field">Category
              <select className="select" value={form.category_id} onChange={set('category_id')}>
                <option value="">— none —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field">Linked course (optional)
              <select className="select" value={form.course_id} onChange={set('course_id')}>
                <option value="">— not linked —</option>
                {courseOptions.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <small className="tiny muted">Course certificate ka integrity band + module quizzes isi link par chalte hain.</small>
            </label>
            {moduleQuizzesOn && (
              <label className="field">Linked module — module quiz (optional)
                <select
                  className="select"
                  value={form.module_id || ''}
                  onChange={(e) => setForm((f) => ({ ...f, module_id: e.target.value }))}
                  disabled={!form.course_id || form.quiz_type === 'live'}
                >
                  <option value="">— course-level quiz (koi module nahi) —</option>
                  {moduleOptions.map((m) => {
                    // A module can hold more than one quiz, but a teacher who
                    // attaches a second one by accident should see it here
                    // instead of wondering why it "doesn't show".
                    const existing = (Array.isArray(m.quizzes) ? m.quizzes : (m.quiz ? [m.quiz] : []))
                      .filter((z) => String(z.id) !== String(editing ? editing.id : ''));
                    return (
                      <option key={m.id} value={m.id}>
                        {m.position}. {m.title}{existing.length ? `  · already has: ${existing.map((z) => z.title).join(', ')}` : ''}
                      </option>
                    );
                  })}
                </select>
                <small className="tiny muted">
                  {form.quiz_type === 'live'
                    ? 'Module quiz live nahi ho sakta — pehle quiz type normal karein.'
                    : 'Module quiz hamesha normal quiz hota hai: anti-cheat (tab guard, fullscreen, copy-paste block) chalta hai, par webcam aur screen share kabhi nahi maange jaate. Course page par quiz usi module ke andar dikhega.'}
                </small>
              </label>
            )}
            <label className="field">Difficulty
              <select className="select" value={form.difficulty} onChange={set('difficulty')}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="field">Quiz type
              <select className="select" value={form.quiz_type} onChange={set('quiz_type')}>
                {['normal', 'live', 'practice'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">Status
              <select className="select" value={form.status} onChange={set('status')}>
                {['draft', 'published', 'scheduled', 'completed'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">Time limit (minutes)
              <input className="input" type="number" min="1" value={form.time_limit_minutes} onChange={set('time_limit_minutes')} />
            </label>
            <label className="field">Passing score (%)
              <input className="input" type="number" min="0" max="100" value={form.passing_score} onChange={set('passing_score')} />
            </label>
            <label className="field">Negative marking per wrong answer
              <input className="input" type="number" min="0" step="0.25" value={form.negative_marking} onChange={set('negative_marking')} />
            </label>
            <label className="field">Max participants (optional)
              <input className="input" type="number" min="1" value={form.max_participants} onChange={set('max_participants')} />
            </label>
            <label className="field">Start date & time
              <input className="input" type="datetime-local" value={form.start_at} onChange={set('start_at')} />
            </label>
            <label className="field">End date & time
              <input className="input" type="datetime-local" value={form.end_at} onChange={set('end_at')} />
            </label>
            <label className="field full row" style={{ gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={Number(form.shuffle_questions) === 1} onChange={(e) => setForm((f) => ({ ...f, shuffle_questions: e.target.checked ? 1 : 0 }))} />
              Shuffle questions per attempt
            </label>
            <label className="field full row" style={{ gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={Number(form.show_answers_after) === 1} onChange={(e) => setForm((f) => ({ ...f, show_answers_after: e.target.checked ? 1 : 0 }))} />
              Show answers after submission
            </label>
            <label className="field full row" style={{ gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={Number(form.allow_reattempt) === 1} onChange={(e) => setForm((f) => ({ ...f, allow_reattempt: e.target.checked ? 1 : 0 }))} />
              Allow re-attempts
            </label>
            <label className="field full row" style={{ gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={Number(form.is_private) === 1} onChange={(e) => setForm((f) => ({ ...f, is_private: e.target.checked ? 1 : 0 }))} />
              🔒 Private quiz — students must enter the access password
            </label>
            {Number(form.is_private) === 1 && (
              <label className="field full">Access password {editing ? '(leave blank to keep the existing password)' : ''}
                <input className="input" type="password" minLength={4} maxLength={72} autoComplete="new-password"
                  value={form.access_password} onChange={set('access_password')} placeholder="Quiz access password" />
              </label>
            )}
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create quiz'}</button>
          </div>
        </form>
      </Modal>
      {user && <div className="tiny muted mt-s">Created quizzes are owned by {user.full_name} — reassign by editing while logged in as the target developer.</div>}
    </div>
  );
}
