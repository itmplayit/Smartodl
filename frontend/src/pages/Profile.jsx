import { useEffect, useState } from 'react';
import { authApi, userApi, courseApi, quizApi, codingApi, tokens } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar, Badge, Empty, Loader, StatCard } from '../components/ui';
import { fmtNum, timeAgo } from '../utils/format';

export default function Profile() {
  const { user, refreshMe } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', college: '', bio: '', github_url: '', linkedin_url: '' });
  const [avatar, setAvatar] = useState(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!user) return;
    setForm({
      full_name: user.full_name || '', college: user.college || '', bio: user.bio || '',
      github_url: user.github_url || '', linkedin_url: user.linkedin_url || '',
    });
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const [en, att, subs] = await Promise.all([
          courseApi.enrollments(), quizApi.myAttempts(), codingApi.mySubmissions({ limit: 100 }),
        ]);
        setSummary({ courses: en.data.data.length, attempts: att.data.data.length, subs: subs.data.data, accepted: subs.data.data.filter((s) => s.status === 'accepted').length });
      } catch (_) { setSummary({ courses: 0, attempts: 0, subs: [], accepted: 0 }); }
    })();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await userApi.updateMe(form);
      await refreshMe();
      toast.success('Profile updated');
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be under 2 MB'); return; }
    try {
      await userApi.uploadAvatar(file);
      await refreshMe();
      toast.success('Profile picture updated');
    } catch (err) { toast.error(err.message); }
  };

  if (!user) return <Loader />;

  return (
    <div className="container section">
      <div className="split" style={{ gridTemplateColumns: '340px 1fr' }}>
        <div className="stack">
          <div className="card center">
            <Avatar user={user} size={92} />
            <h2 style={{ marginBottom: 2 }}>{user.full_name}</h2>
            <div className="muted small">{user.email}</div>
            <div className="row mt-s" style={{ justifyContent: 'center', gap: 8 }}>
              <Badge tone="violet">{user.role}</Badge>
              <Badge tone={user.status === 'active' ? 'green' : 'amber'}>{user.status}</Badge>
            </div>
            <label className="btn btn-ghost btn-block mt" style={{ cursor: 'pointer' }}>
              📷 Change picture
              <input type="file" accept="image/*" hidden onChange={upload} />
            </label>
            <div className="tiny muted mt-s">PNG/JPG up to 2 MB.</div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem' }}>Activity</h3>
            {summary ? (
              <div className="stack" style={{ gap: 10 }}>
                <div className="between small"><span>Enrolled courses</span><strong>{summary.courses}</strong></div>
                <div className="between small"><span>Quiz attempts</span><strong>{summary.attempts}</strong></div>
                <div className="between small"><span>Code submissions</span><strong>{summary.subs.length}</strong></div>
                <div className="between small"><span>Accepted solutions</span><strong>{summary.accepted}</strong></div>
                <div className="between small"><span>Points</span><strong>{fmtNum(user.points)}</strong></div>
                <div className="between small"><span>Problems solved</span><strong>{user.problems_solved}</strong></div>
              </div>
            ) : <Loader label="Loading…" />}
          </div>

          {user.role === 'developer' && (
            <div className="card">
              <h3 style={{ fontSize: '1rem' }}>Your permissions</h3>
              <div className="row wrap" style={{ gap: 6 }}>
                {(user.permissions || []).length === 0 && <span className="tiny muted">No permissions granted yet — an administrator assigns them.</span>}
                {(user.permissions || []).map((p) => <span className="tag" key={p}>✓ {p.replace(/_/g, ' ')}</span>)}
              </div>
            </div>
          )}

          <div className="card">
            <h3 style={{ fontSize: '1rem' }}>Account</h3>
            <div className="stack" style={{ gap: 8 }}>
              <span className="small">🆔 User ID: {user.id}</span>
              <span className="small">📅 Joined {new Date(user.created_at).toLocaleDateString()}</span>
              <span className="small">🕘 Last login {user.last_login_at ? timeAgo(user.last_login_at) : '—'}</span>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="grid g3">
            <StatCard icon="💎" label="Points" value={fmtNum(user.points)} />
            <StatCard icon="✅" label="Solved" value={user.problems_solved} />
            <StatCard icon="🎖" label="Badges" value={(user.achievement_count || 0)} />
          </div>

          <form className="card" onSubmit={save}>
            <h3>Edit profile</h3>
            <div className="form-grid">
              <label className="field">Full name
                <input className="input" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
              </label>
              <label className="field">College / Organisation
                <input className="input" value={form.college} onChange={(e) => setForm((f) => ({ ...f, college: e.target.value }))} />
              </label>
              <label className="field">GitHub profile URL
                <input className="input" value={form.github_url} onChange={(e) => setForm((f) => ({ ...f, github_url: e.target.value }))} placeholder="https://github.com/username" />
              </label>
              <label className="field">LinkedIn profile URL
                <input className="input" value={form.linkedin_url} onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))} placeholder="https://linkedin.com/in/username" />
              </label>
              <label className="field full">Bio
                <textarea className="textarea" rows="3" value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} placeholder="Tell your peers what you are learning…" />
              </label>
            </div>
            <button className="btn btn-primary mt" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </form>

          <ChangePassword />
        </div>
      </div>
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm_password) { toast.error('New passwords do not match'); return; }
    setBusy(true);
    try {
      await authApi.changePassword(form);
      tokens.clear();
      window.location.assign('/login?password_changed=1');
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3>Change password</h3>
      <div className="form-grid">
        <label className="field full">Current password
          <input className="input" type="password" required value={form.current_password} onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))} />
        </label>
        <label className="field">New password
          <input className="input" type="password" required minLength={10} maxLength={72} value={form.new_password}
            onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))} />
        </label>
        <label className="field">Confirm new password
          <input className="input" type="password" required minLength={10} maxLength={72} value={form.confirm_password}
            onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))} />
        </label>
      </div>
      <button className="btn btn-primary mt" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      <p className="tiny muted mt-s">Passwords are hashed with bcrypt and never stored in plain text.</p>
    </form>
  );
}
