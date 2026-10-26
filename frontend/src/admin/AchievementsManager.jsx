import { useEffect, useState } from 'react';
import { miscApi, userApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Empty, Loader, Modal } from '../components/ui';
import { timeAgo } from '../utils/format';

const EMPTY = {
  code: '', title: '', description: '', icon: '🏅', badge_color: '#6366f1',
  criteria_type: 'problems_solved', criteria_value: 10, points_reward: 20, is_active: 1,
};

/* enum('quiz_count','quiz_score','problems_solved','course_completed','contest_participation','points','custom') */
const CRITERIA = [
  ['problems_solved', 'Problems solved (accepted submissions)'],
  ['quiz_count', 'Quizzes completed'],
  ['quiz_score', 'Quiz score % best'],
  ['course_completed', 'Courses completed'],
  ['contest_participation', 'Contests joined'],
  ['points', 'Total points earned'],
  ['custom', 'Custom (awarded manually)'],
];

export default function AchievementsManager({ scope = 'admin' }) {
  const toast = useToast();
  const { hasRole, can } = useAuth();
  const canAward = hasRole('admin') || can('view_student_data');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [awardFor, setAwardFor] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');

  const load = async () => {
    try { const { data } = await miscApi.achievements(); setRows(data.data); } catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => {
    load();
    if (canAward) userApi.list({ role: 'student', limit: 100 }).then(({ data }) => setStudents(data.data)).catch(() => {});
  }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        code: (form.code || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
          || (form.title || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        criteria_value: Number(form.criteria_value) || 0,
        points_reward: Number(form.points_reward) || 0,
        is_active: Number(form.is_active) === 1 ? 1 : 0,
      };
      if (!payload.code || !payload.title) { toast.error('A code and a title are required'); return; }
      if (editing) await miscApi.updateAchievement(editing.id, payload);
      else await miscApi.createAchievement(payload);
      toast.success(editing ? 'Achievement updated' : 'Achievement created');
      setOpen(false); load();
    } catch (err) { toast.error(err.message); }
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete achievement “${a.title}”?`)) return;
    try { await miscApi.removeAchievement(a.id); toast.success('Deleted'); load(); } catch (e) { toast.error(e.message); }
  };

  const award = async () => {
    if (!studentId) return;
    try {
      await miscApi.awardAchievement(awardFor.id, Number(studentId));
      toast.success('Badge awarded 🎖');
      setAwardFor(null); setStudentId(''); load();
    } catch (e) { toast.error(e.message); }
  };

  if (!rows) return <Loader label="Loading achievements…" />;

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Gamification</span><h2>Achievements & badges</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Create custom achievements; badges award automatically after quizzes, accepted solutions and course completion.</p></div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(EMPTY); setOpen(true); }}>➕ New achievement</button>
      </div>

      <div className="grid g3">
        {rows.map((a) => (
          <div className="card" key={a.id}>
            <div className="between mb-s">
              <span style={{ fontSize: '1.8rem' }}>{a.icon || '🏅'}</span>
              <span className={`badge ${a.is_active ? 'green' : 'gray'}`}>{a.is_active ? 'active' : 'inactive'}</span>
            </div>
            <h3 style={{ fontSize: '1rem' }}>{a.title}</h3>
            <p className="tiny muted">{a.description}</p>
            <div className="row wrap tiny muted" style={{ gap: 10 }}>
              <span>🎯 {String(a.criteria_type).replace(/_/g, ' ')} ≥ {a.criteria_value}</span>
              <span>💎 +{a.points_reward} pts</span>
              <span className="tag" style={{ borderLeft: `4px solid ${a.badge_color || '#6366f1'}` }}>{a.code}</span>
            </div>
            <div className="divider" />
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(a); setForm({ ...EMPTY, ...a }); setOpen(true); }}>✏️ Edit</button>
              {canAward && <button className="btn btn-sm btn-ghost" onClick={() => setAwardFor(a)}>🎖 Award</button>}
              <button className="btn btn-sm btn-ghost" onClick={() => remove(a)}>🗑</button>
            </div>
            <div className="tiny muted mt-s">Created {timeAgo(a.created_at)}</div>
          </div>
        ))}
      </div>
      {rows.length === 0 && <Empty title="No achievements configured" hint="Create the first badge." />}

      <Modal open={open} title={editing ? `Edit ${editing.title}` : 'New achievement'} onClose={() => setOpen(false)}>
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field">Title *
              <input className="input" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="100 Problems Solved" />
            </label>
            <label className="field">Code <span className="tiny muted">(unique id, auto-generated if blank)</span>
              <input className="input" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="hundred_problems" />
            </label>
            <label className="field">Icon (emoji)
              <input className="input" value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} placeholder="🏆" />
            </label>
            <label className="field">Badge colour
              <input className="input" type="color" value={form.badge_color || '#6366f1'} onChange={(e) => setForm((f) => ({ ...f, badge_color: e.target.value }))} />
            </label>
            <label className="field full">Description
              <textarea className="textarea" rows="2" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </label>
            <label className="field">Criteria type
              <select className="select" value={form.criteria_type} onChange={(e) => setForm((f) => ({ ...f, criteria_type: e.target.value }))}>
                {CRITERIA.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">Criteria value
              <input className="input" type="number" min="1" value={form.criteria_value} onChange={(e) => setForm((f) => ({ ...f, criteria_value: e.target.value }))} />
            </label>
            <label className="field">Points reward
              <input className="input" type="number" min="0" value={form.points_reward} onChange={(e) => setForm((f) => ({ ...f, points_reward: e.target.value }))} />
            </label>
            <label className="field row" style={{ gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={Number(form.is_active) === 1} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked ? 1 : 0 }))} />
              Active
            </label>
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary">{editing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!awardFor} title={`Award “${awardFor ? awardFor.title : ''}”`} onClose={() => setAwardFor(null)}>
        <label className="field">Student
          <select className="select" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">— choose a student —</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.email})</option>)}
          </select>
        </label>
        <div className="row mt" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setAwardFor(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={award} disabled={!studentId}>🎖 Award badge</button>
        </div>
      </Modal>
    </div>
  );
}
