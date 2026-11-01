import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi, safeStorage, tokens } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import Switch from '../components/Switch';
import Icon from '../components/Icon';
import { useCallback } from 'react';

const PREF_KEY = 'smartodl.prefs';
const NOTIFICATIONS = [
  ['email_quiz', 'Quiz results and live alerts', 'Get notified when a quiz is evaluated or a live quiz starts.'],
  ['email_coding', 'Coding submission verdicts', 'Receive the verdict whenever your code is judged.'],
  ['email_contests', 'Contest reminders', 'Reminders before a contest starts and when results are published.'],
  ['email_news', 'Platform announcements', 'New courses, notes and important product updates.'],
];

function SettingRow({ title, description, children }) {
  return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div>{children}</div>;
}

export default function Settings() {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [prefs, setPrefs] = useState({
    email_quiz: true, email_coding: true, email_contests: true, email_news: false, inapp_sound: true, compact_tables: false,
  });

  useEffect(() => {
    try { const saved = JSON.parse(safeStorage.getItem(PREF_KEY) || 'null'); if (saved) setPrefs((value) => ({ ...value, ...saved })); } catch (_) { /* ignore */ }
  }, []);

  const update = (key, value) => setPrefs((current) => ({ ...current, [key]: value }));
  const save = () => {
    safeStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    document.documentElement.dataset.compactTables = prefs.compact_tables ? 'true' : 'false';
    toast.success('Preferences saved on this device');
  };

  return (
    <div className="container section settings-page">
      <div className="section-head professional-page-head">
        <div><span className="eyebrow">Personal workspace</span><h1>Settings</h1>
          <p className="muted">Manage notifications, appearance and account security.</p></div>
      </div>

      <div className="split settings-layout" style={{ gridTemplateColumns: '1fr 340px' }}>
        <div className="stack">
          <section className="card settings-card">
            <div className="card-title-row"><span><Icon name="bell" size={20} /></span><div><h2>Notification preferences</h2><p>Choose which updates you want to receive.</p></div></div>
            <div className="settings-list">
              {NOTIFICATIONS.map(([key, title, description]) => (
                <SettingRow key={key} title={title} description={description}>
                  <Switch checked={prefs[key]} onChange={(value) => update(key, value)} label={title} />
                </SettingRow>
              ))}
            </div>
            <button type="button" className="btn btn-primary mt" onClick={save}>Save notification preferences</button>
          </section>

          <section className="card settings-card">
            <div className="card-title-row"><span><Icon name="sliders" size={20} /></span><div><h2>Appearance and interface</h2><p>Adjust the workspace for your preferred study style.</p></div></div>
            <div className="settings-list">
              <SettingRow title="Sound on new notifications" description="Play a subtle chime when a new alert arrives.">
                <Switch checked={prefs.inapp_sound} onChange={(value) => update('inapp_sound', value)} label="Sound on new notifications" />
              </SettingRow>
              <SettingRow title="Compact tables" description="Use tighter rows in leaderboards and submission lists.">
                <Switch checked={prefs.compact_tables} onChange={(value) => update('compact_tables', value)} label="Use compact tables" />
              </SettingRow>
              <SettingRow title="Dark theme" description="Use a lower-glare interface for longer coding sessions.">
                <Switch checked={theme === 'dark'} onChange={(value) => setTheme(value ? 'dark' : 'light')} label="Use dark theme" />
              </SettingRow>
            </div>
            <button type="button" className="btn btn-primary mt" onClick={save}>Save appearance</button>
          </section>

          <SecurityCard />
          <SessionsCard />
        </div>

        <aside className="stack settings-aside" aria-label="Account information">
          <section className="card">
            <h2 className="aside-title">Account summary</h2>
            <div className="detail-list">
              <span><Icon name="user" size={16} /><span>{user?.full_name}</span></span>
              <span><Icon name="mail" size={16} /><span>{user?.email}</span></span>
              <span><Icon name="shield" size={16} /><span className="text-capitalize">{user?.role}</span></span>
              <span><Icon name="tag" size={16} /><span>Account #{user?.id}</span></span>
            </div>
            <Link className="btn btn-ghost btn-block mt" to="/profile">Edit profile</Link>
          </section>

          <section className="card">
            <h2 className="aside-title">Platform</h2>
            <div className="detail-list">
              <span><Icon name="book" size={16} /><span>{settings.site_name || 'SmartODL'}</span></span>
              <span><Icon name="mail" size={16} /><span>{settings.contact_email || 'Not configured'}</span></span>
              <span><Icon name="code" size={16} /><span>Judge: {settings.judge_mode || 'sandbox'}</span></span>
              <span><Icon name="check" size={16} /><span>Version {settings.platform_version || '1.0.0'}</span></span>
            </div>
          </section>

          <section className="card">
            <h2 className="aside-title">Session</h2>
            <p className="small muted">Logging out securely clears your access and refresh tokens from this device.</p>
            <button type="button" className="btn btn-ghost btn-block" onClick={logout}><Icon name="logout" size={17} />Log out</button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function SecurityCard() {
  const toast = useToast();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (form.new_password !== form.confirm_password) { toast.error('Passwords do not match'); return; }
    setBusy(true);
    try {
      await authApi.changePassword(form);
      tokens.clear();
      window.location.assign('/login?password_changed=1');
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  return (
    <form className="card settings-card" onSubmit={submit}>
      <div className="card-title-row"><span><Icon name="lock" size={20} /></span><div><h2>Security</h2><p>Use a unique password that you do not use elsewhere.</p></div></div>
      <div className="form-grid">
        <label className="field full">Current password
          <input className="input" type="password" required autoComplete="current-password" value={form.current_password} onChange={(event) => setForm((value) => ({ ...value, current_password: event.target.value }))} />
        </label>
        <label className="field">New password
          <input className="input" type="password" required minLength={10} maxLength={72} autoComplete="new-password"
            value={form.new_password} onChange={(event) => setForm((value) => ({ ...value, new_password: event.target.value }))} />
        </label>
        <label className="field">Confirm new password
          <input className="input" type="password" required minLength={10} maxLength={72} autoComplete="new-password"
            value={form.confirm_password} onChange={(event) => setForm((value) => ({ ...value, confirm_password: event.target.value }))} />
        </label>
      </div>
      <button className="btn btn-primary mt" disabled={busy}>{busy ? 'Updating password…' : 'Change password'}</button>
      <div className="security-note mt"><Icon name="shield" size={17} /><span>Access tokens are short-lived and refresh tokens rotate on renewal.</span></div>
    </form>
  );
}


/**
 * Active devices / sessions.
 *
 * The backend has always recorded a user-agent and IP per refresh token, but
 * until now nothing displayed them — so a session the user did not recognise
 * was invisible until it was used. This lists them and lets the user revoke
 * any single one (the existing "log out everywhere" button covers the rest).
 */
function SessionsCard() {
  const toast = useToast();
  const [sessions, setSessions] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await sessionsApi.list();
      setSessions(data?.data?.sessions || []);
    } catch (_err) {
      setSessions([]); // never break the settings page over this
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revoke = async (session) => {
    setBusyId(session.id);
    try {
      await sessionsApi.revoke(session.id);
      toast.success(session.current ? 'This device signed out.' : 'Device signed out.');
      if (session.current) { window.location.assign('/login'); return; }
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not sign out that device.');
    } finally { setBusyId(null); }
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch (_e) { return String(iso); }
  };

  return (
    <section className="card">
      <div className="card-title-row">
        <span><Icon name="shield" size={20} /></span>
        <div>
          <h2>Active devices</h2>
          <p>Every browser or phone currently signed in to your account.</p>
        </div>
      </div>

      {sessions === null && <p className="small muted mt-s">Loading…</p>}
      {sessions && sessions.length === 0 && (
        <p className="small muted mt-s">No other active sessions found.</p>
      )}

      {sessions && sessions.length > 0 && (
        <div className="detail-list mt-s">
          {sessions.map((s) => (
            <div className="session-row" key={s.id}>
              <div className="session-meta">
                <span className="session-device">
                  <Icon name="laptop" size={15} /> {s.device}
                  {s.current && <span className="badge">This device</span>}
                </span>
                <span className="small muted">
                  {s.ip ? `IP ${s.ip} · ` : ''}Last used {fmt(s.last_used_at)}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busyId === s.id}
                onClick={() => revoke(s)}
              >
                {busyId === s.id ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
