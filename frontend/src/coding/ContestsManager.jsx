import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { contestApi, codingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Empty, Loader, Modal, StatusBadge } from '../components/ui';

const EMPTY = {
  title: '', description: '', contest_type: 'coding', start_at: '', end_at: '', duration_minutes: 120,
  status: 'draft', max_participants: '', rules: '', prizes: '', is_rated: 1, editorial: '',
};

const dt = (v) => (v ? String(v).slice(0, 16).replace(' ', 'T') : '');

/** Contest manager: schedule, add problems, publish, start/end and view standings. */
export default function ContestsManager({ scope = 'admin' }) {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [problems, setProblems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [problemModal, setProblemModal] = useState(null);
  const [problemId, setProblemId] = useState('');
  const [label, setLabel] = useState('A');
  const [pointsOverride, setPointsOverride] = useState('');
  const [contestProblems, setContestProblems] = useState([]);
  const base = scope === 'admin' ? '/admin' : '/developer';

  const load = async () => {
    try {
      const { data } = await contestApi.list();
      setRows(data.data);
    } catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => {
    load();
    codingApi.problems({ limit: 100 }).then(({ data }) => setProblems(data.data)).catch(() => {});
  }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      ...EMPTY, ...c,
      start_at: dt(c.start_at), end_at: dt(c.end_at),
      max_participants: c.max_participants || '',
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        start_at: form.start_at ? `${form.start_at.replace('T', ' ')}:00` : null,
        end_at: form.end_at ? `${form.end_at.replace('T', ' ')}:00` : null,
        max_participants: form.max_participants || null,
        duration_minutes: Number(form.duration_minutes),
      };
      if (editing) await contestApi.update(editing.id, payload);
      else await contestApi.create(payload);
      toast.success(editing ? 'Contest updated' : 'Contest created — add problems next');
      setOpen(false); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const setStatus = async (c, status) => {
    try { await contestApi.update(c.id, { status }); toast.success(`Contest ${status}`); load(); }
    catch (e) { toast.error(e.message); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete contest “${c.title}”?`)) return;
    try { await contestApi.remove(c.id); toast.success('Contest deleted'); load(); } catch (e) { toast.error(e.message); }
  };

  const openProblems = async (c) => {
    setProblemModal(c); setContestProblems([]);
    try { const { data } = await contestApi.get(c.id); setContestProblems(data.data.problems || []); }
    catch (e) { toast.error(e.message); }
  };

  const addProblem = async (e) => {
    e.preventDefault();
    try {
      // rebuild the full ordered problem list (server replaces the set atomically)
      const existingIds = contestProblems.map((cp) => cp.id);
      await contestApi.update(problemModal.id, {
        problem_ids: [...existingIds, Number(problemId)],
        points_overrides: [...contestProblems.map((cp) => cp.points_override || null), pointsOverride ? Number(pointsOverride) : null],
      });
      toast.success('Problem added to contest');
      setProblemId(''); setPointsOverride('');
      openProblems(problemModal);
    } catch (err) { toast.error(err.message); }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Competitive programming</span><h2>Coding contests</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Schedule contests, attach problems with labels and points, publish, start and end them.</p></div>
        <button className="btn btn-primary" onClick={openCreate}>➕ New contest</button>
      </div>

      {!rows && <Loader label="Loading contests…" />}
      {rows && rows.length === 0 && <Empty title="No contests yet" hint="Create your first contest and attach problems." />}

      {rows && rows.length > 0 && (
        <div className="table-wrap scroll-x">
          <table className="table">
            <thead><tr><th>Contest</th><th>Type</th><th>Problems</th><th>Participants</th><th>Schedule</th><th>Status</th><th style={{ width: 300 }}>Actions</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ minWidth: 200 }}>
                    <Link className="link" style={{ fontWeight: 600 }} to={`/contests/${c.id}`}>{c.title}</Link>
                    <div className="tiny muted">by {c.created_by_name || '—'}</div>
                  </td>
                  <td><span className="tag">{c.contest_type}</span></td>
                  <td>{c.problem_count}</td>
                  <td>{c.participant_count ?? c.registered_count ?? 0}</td>
                  <td className="tiny muted">
                    {new Date(c.start_at).toLocaleString()}
                    <div>→ {new Date(c.end_at).toLocaleString()}</div>
                  </td>
                  <td><StatusBadge value={c.status} /></td>
                  <td>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => openProblems(c)}>➕ Problems</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(c)}>✏️</button>
                      {c.status !== 'live'
                        ? <button className="btn btn-sm btn-ghost" onClick={() => setStatus(c, 'live')}>▶ Start</button>
                        : <button className="btn btn-sm btn-danger" onClick={() => setStatus(c, 'completed')}>⏹ End</button>}
                      <button className="btn btn-sm btn-ghost" onClick={() => setStatus(c, 'published')}>🚀 Publish</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(c)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} title={editing ? `Edit contest: ${editing.title}` : 'Create contest'} onClose={() => setOpen(false)} wide>
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field full">Title *
              <input className="input" required value={form.title} onChange={set('title')} placeholder="CodeSprint Monthly #4" />
            </label>
            <label className="field full">Description
              <textarea className="textarea" rows="3" value={form.description} onChange={set('description')} />
            </label>
            <label className="field">Type
              <select className="select" value={form.contest_type} onChange={set('contest_type')}>
                <option value="coding">💻 Coding contest</option>
                <option value="quiz">🧠 Quiz contest</option>
              </select>
            </label>
            <label className="field">Rated
              <select className="select" value={form.is_rated} onChange={set('is_rated')}>
                <option value={1}>Rated (affects leaderboard rating)</option>
                <option value={0}>Unrated / practice</option>
              </select>
            </label>
            <label className="field">Status
              <select className="select" value={form.status} onChange={set('status')}>
                {['draft', 'published', 'scheduled', 'live', 'completed'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">Starts at
              <input className="input" type="datetime-local" value={form.start_at} onChange={set('start_at')} required />
            </label>
            <label className="field">Ends at
              <input className="input" type="datetime-local" value={form.end_at} onChange={set('end_at')} required />
            </label>
            <label className="field">Duration (minutes)
              <input className="input" type="number" min="10" value={form.duration_minutes} onChange={set('duration_minutes')} />
            </label>
            <label className="field">Max participants (optional)
              <input className="input" type="number" min="1" value={form.max_participants} onChange={set('max_participants')} />
            </label>
            <label className="field full">Rules
              <textarea className="textarea" rows="2" value={form.rules} onChange={set('rules')} placeholder="No plagiarism, one account per student…" />
            </label>
            <label className="field full">Prizes
              <textarea className="textarea" rows="2" value={form.prizes} onChange={set('prizes')} />
            </label>
            <label className="field full">Editorial (published after the contest ends)
              <textarea className="textarea" rows="3" value={form.editorial || ''} onChange={set('editorial')} placeholder="Approach, time complexity, key observations…" />
            </label>
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save contest' : 'Create contest'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!problemModal} title={`Problems — ${problemModal ? problemModal.title : ''}`} onClose={() => setProblemModal(null)} wide>
        <div className="table-wrap mb">
          <table className="table">
            <thead><tr><th>Label</th><th>Problem</th><th>Points</th><th>Solved by</th></tr></thead>
            <tbody>
              {contestProblems.map((p) => (
                <tr key={`${p.label}-${p.id}`}>
                  <td><span className="tag">{p.label}</span></td>
                  <td>{p.title}</td>
                  <td>{p.points_override || p.points}</td>
                  <td>{p.solved_count}</td>
                </tr>
              ))}
              {contestProblems.length === 0 && <tr><td colSpan="4"><span className="muted small">No problems attached yet.</span></td></tr>}
            </tbody>
          </table>
        </div>
        <form className="card" onSubmit={addProblem}>
          <h4>Attach a problem</h4>
          <div className="form-grid">
            <label className="field full">Problem
              <select className="select" required value={problemId} onChange={(e) => setProblemId(e.target.value)}>
                <option value="">— choose —</option>
                {problems.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.title} ({p.difficulty}, {p.points} pts)</option>)}
              </select>
            </label>
            <label className="field">Label
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A" />
            </label>
            <label className="field">Points override (optional)
              <input className="input" type="number" min="1" value={pointsOverride} onChange={(e) => setPointsOverride(e.target.value)} />
            </label>
          </div>
          <button className="btn btn-primary mt">➕ Attach problem</button>
        </form>
      </Modal>
    </div>
  );
}
