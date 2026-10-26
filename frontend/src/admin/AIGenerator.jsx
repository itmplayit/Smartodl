import React, { useEffect, useState } from 'react';
import api from '../services/api';

const TABS = [
  { key: 'course',  label: '📘 Course',        icon: '📘' },
  { key: 'quiz',    label: '🧠 Quiz',          icon: '🧠' },
  { key: 'problem', label: '💻 Coding Problem', icon: '💻' },
];

const DEFAULTS = {
  course:  { title: 'Introduction to Python Programming', level: 'beginner', modulesCount: 4, language: 'English' },
  quiz:    { topic: 'Python Lists & Dictionaries', questionCount: 8, difficulty: 'medium', language: 'English' },
  problem: { title: 'Two Sum (Array)', difficulty: 'easy', language: 'English' },
};

export default function AIGenerator() {
  const [tab, setTab] = useState('course');
  const [form, setForm] = useState(DEFAULTS.course);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);

  /* When the tab changes, setForm must be synchronised in the same click.
     Otherwise, for one render the new tab's inputs receive the previous tab's form
     values (undefined), and React emits an "uncontrolled -> controlled" warning.
     Calling setTab and setForm in one event lets React batch them. */
  const switchTab = (key) => {
    setTab(key);
    setForm(DEFAULTS[key]);
    setResult(null); setError(''); setSaved(null);
  };

  useEffect(() => {
    api.get('/ai/status').then(({ data }) => setStatus(data.data)).catch((e) => setStatus({ configured: false, error: e.message }));
  }, []);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const apiError = (e) => (e.response?.data?.error || e.response?.data?.message || e.message);

  async function generate() {
    setLoading(true); setError(''); setResult(null); setSaved(null);
    try {
      const { data } = await api.post('/ai/generate', { type: tab, ...form });
      setResult(data.data);
    } catch (e) {
      setError(apiError(e));
    } finally { setLoading(false); }
  }

  async function saveAll() {
    if (!result) return;
    setSaving(true); setError('');
    try {
      if (tab === 'course') {
        const { data } = await api.post('/ai/save/course', result);
        setSaved({ kind: 'course', id: data.data.course_id, url: '/admin/courses/' + data.data.course_id });
      } else if (tab === 'quiz') {
        const { data } = await api.post('/ai/save/quiz', result);
        setSaved({ kind: 'quiz', id: data.data.quiz_id, url: '/admin/quizzes/' + data.data.quiz_id });
      } else {
        const { data } = await api.post('/ai/save/problem', result);
        setSaved({ kind: 'problem', id: data.data.problem_id, url: '/admin/problems' });
      }
    } catch (e) {
      setError(apiError(e));
    } finally { setSaving(false); }
  }

  return (
    <div className="page-wrap" style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <div className="eyebrow">AI POWERED</div>
        <h1 className="page-title" style={{ color: 'var(--heading)', margin: '8px 0' }}>✨ AI Content Generator</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Enter a topic and AI will generate a complete course, quiz, or coding problem with test cases.
          {status?.configured ? <> Provider: <b style={{ color: 'var(--violet)' }}>{status.provider} / {status.model}</b>.</> : null}
        </p>
      </div>

      {status && !status.configured && (
        <div className="panel" style={{ padding: 20, borderLeft: '4px solid #f59e0b', marginBottom: 20, background: 'rgba(245,158,11,0.08)' }}>
          <h2 style={{ color: 'var(--amber)', marginTop: 0, fontSize: '1.08rem' }}>⚠️ The AI API key is not configured</h2>
          <p style={{ color: 'var(--text)', margin: '4px 0' }}>A free API key is required before generation:</p>
          <ol style={{ color: 'var(--text)' }}>
            <li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', textDecoration: 'underline', textUnderlineOffset: 2 }}>aistudio.google.com/apikey</a> and obtain a free key (it takes about one minute).</li>
            <li><code style={{ background: 'var(--surface-elev)', padding: '2px 6px' }}>backend/.env</code> and add these lines:
              <pre className="ai-env-example" tabIndex={0} style={{ background: 'var(--surface-elev)', padding: 12, borderRadius: 8, marginTop: 8 }}>AI_PROVIDER=gemini{`\n`}AI_API_KEY=YOUR_KEY_HERE{`\n`}AI_MODEL=gemini-2.5-flash</pre>
            </li>
            <li>Restart the backend (<code>node server.js</code>).</li>
          </ol>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Gemini's free tier allows about 15 requests per minute, which is sufficient for personal use. To use OpenAI or Claude, set AI_PROVIDER=openai or AI_PROVIDER=anthropic.</p>
        </div>
      )}

      <div className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => switchTab(t.key)}
              className={tab === t.key ? 'btn btn-primary' : 'btn btn-ghost'}
              style={tab === t.key ? {} : { background: 'var(--panel-2)', color: 'var(--heading)' }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          {tab === 'course' && (
            <>
              <Field label="Course title"><input className="input" value={form.title ?? ''} onChange={(e) => update('title', e.target.value)} placeholder="e.g. Complete JavaScript Bootcamp" /></Field>
              <Field label="Level"><select className="input" value={form.level ?? 'beginner'} onChange={(e) => update('level', e.target.value)}>
                <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
              </select></Field>
              <Field label="Modules count"><input type="number" className="input" value={form.modulesCount ?? ''} onChange={(e) => update('modulesCount', Number(e.target.value))} min="2" max="10" /></Field>
              <Field label="Language"><input className="input" value={form.language ?? ''} onChange={(e) => update('language', e.target.value)} /></Field>
            </>
          )}
          {tab === 'quiz' && (
            <>
              <Field label="Quiz topic" wide><input className="input" value={form.topic ?? ''} onChange={(e) => update('topic', e.target.value)} placeholder="e.g. Data Structures — Linked Lists" /></Field>
              <Field label="Difficulty"><select className="input" value={form.difficulty ?? 'medium'} onChange={(e) => update('difficulty', e.target.value)}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </select></Field>
              <Field label="Questions"><input type="number" className="input" value={form.questionCount ?? ''} onChange={(e) => update('questionCount', Number(e.target.value))} min="3" max="30" /></Field>
              <Field label="Language"><input className="input" value={form.language ?? ''} onChange={(e) => update('language', e.target.value)} /></Field>
            </>
          )}
          {tab === 'problem' && (
            <>
              <Field label="Problem title" wide><input className="input" value={form.title ?? ''} onChange={(e) => update('title', e.target.value)} placeholder="e.g. Valid Parentheses" /></Field>
              <Field label="Difficulty"><select className="input" value={form.difficulty ?? 'easy'} onChange={(e) => update('difficulty', e.target.value)}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </select></Field>
              <Field label="Language"><input className="input" value={form.language ?? ''} onChange={(e) => update('language', e.target.value)} /></Field>
            </>
          )}
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={generate} disabled={loading || !status?.configured}>
            {loading ? '⏳ AI is generating…' : '✨ Generate with AI'}
          </button>
          {result && <button className="btn btn-success" onClick={saveAll} disabled={saving} style={{ background: '#10b981' }}>
            {saving ? '💾 Saving…' : '💾 Save to database'}
          </button>}
        </div>

        {error && <div style={{ marginTop: 14, padding: 12, background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', color: 'var(--red)', borderRadius: 8 }}>{error}</div>}
        {saved && <div style={{ marginTop: 14, padding: 12, background: 'rgba(16,185,129,0.12)', border: '1px solid #10b981', color: 'var(--green)', borderRadius: 8 }}>
          ✅ Saved! <a href={saved.url} style={{ color: 'var(--green)', textDecoration: 'underline' }}>Open in manager →</a>
        </div>}
      </div>

      {result && (
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ color: 'var(--heading)', marginTop: 0 }}>
            📦 AI Preview
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)', marginLeft: 10 }}>
              {tab === 'course' && `${result.modules?.length} modules • ${result.modules?.reduce((a, m) => a + (m.lessons?.length || 0), 0)} lessons`}
              {tab === 'quiz' && `${result.questions?.length} questions • ${result.quiz?.duration_minutes} min`}
              {tab === 'problem' && `${result.test_cases?.length} test cases • ${result.problem?.difficulty}`}
            </span>
          </h3>
          <PreviewPane type={tab} data={result} />
        </div>
      )}
    </div>
  );
}

function Field({ label, children, wide }) {
  return (
    <label style={{ display: 'block', gridColumn: wide ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      {children}
    </label>
  );
}

function PreviewPane({ type, data }) {
  if (type === 'course') {
    return (
      <div>
        <h2 style={{ color: 'var(--violet)', margin: 0 }}>{data.course.title}</h2>
        <p style={{ color: 'var(--text)' }}>{data.course.short_description}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 16px' }}>
          <Badge>{data.course.level}</Badge>
          <Badge>{data.course.duration_hours} hours</Badge>
          {(data.course.tags || []).map((t) => <Badge key={t}>#{t}</Badge>)}
        </div>
        {(data.modules || []).map((m, i) => (
          <div key={i} style={{ background: 'var(--surface-elev)', padding: 14, borderRadius: 10, marginBottom: 10 }}>
            <div style={{ color: 'var(--heading)', fontWeight: 700 }}>Module {i + 1}: {m.title}</div>
            <ul style={{ color: 'var(--muted)', margin: '6px 0 0 18px', padding: 0 }}>
              {(m.lessons || []).map((l, j) => <li key={j}>{l.title}</li>)}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  if (type === 'quiz') {
    return (
      <div>
        <h2 style={{ color: 'var(--brand-2)', margin: 0 }}>{data.quiz.title}</h2>
        <p style={{ color: 'var(--text)' }}>{data.quiz.description}</p>
        <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px' }}>
          <Badge>{data.quiz.difficulty}</Badge><Badge>{data.quiz.duration_minutes} min</Badge>
        </div>
        {(data.questions || []).map((q, i) => (
          <div key={i} style={{ background: 'var(--surface-elev)', padding: 14, borderRadius: 10, marginBottom: 10 }}>
            <div style={{ color: 'var(--heading)' }}><b>Q{i + 1}.</b> {q.question_text}</div>
            <ul style={{ color: 'var(--text)', margin: '6px 0 6px 20px' }}>
              {(q.options || []).map((o, j) => <li key={j} style={{ color: o.is_correct ? 'var(--green)' : 'var(--text)' }}>{o.is_correct ? '✅ ' : ''}{o.option_text}</li>)}
            </ul>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>💡 {q.explanation}</div>
          </div>
        ))}
      </div>
    );
  }
  // problem
  return (
    <div>
      <h2 style={{ color: 'var(--pink)', margin: 0 }}>{data.problem.title}</h2>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <Badge>{data.problem.difficulty}</Badge><Badge>{data.problem.points} points</Badge>
      </div>
      <pre tabIndex={0} aria-label="Generated problem description" style={{ background: 'var(--surface-elev)', padding: 14, borderRadius: 10, color: 'var(--text)', whiteSpace: 'pre-wrap', fontSize: 13, maxHeight: 240, overflow: 'auto' }}>{data.problem.description}</pre>
      <h4 style={{ color: 'var(--heading)' }}>🧪 Test cases ({data.test_cases?.length})</h4>
      {(data.test_cases || []).map((t, i) => (
        <div key={i} style={{ background: 'var(--surface-elev)', padding: 10, borderRadius: 8, marginBottom: 6, fontFamily: 'monospace', fontSize: 12 }}>
          <div style={{ color: 'var(--muted)' }}>{t.is_sample ? '📘 Sample' : '🔒 Hidden'} #{i + 1}</div>
          <div style={{ color: 'var(--amber)' }}>in:  {String(t.input).replace(/\n/g, '⏎ ')}</div>
          <div style={{ color: 'var(--green)' }}>out: {String(t.expected_output).replace(/\n/g, '⏎ ')}</div>
        </div>
      ))}
    </div>
  );
}

function Badge({ children }) {
  return <span style={{ background: 'var(--panel-2)', color: 'var(--text)', padding: '3px 10px', borderRadius: 999, fontSize: 12 }}>{children}</span>;
}
