import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi, userApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ROLE_HOME } from '../utils/constants';
import { BrandMark, BrandLogo } from '../components/Brand';
import { GoogleIcon, GithubIcon } from '../components/OAuthIcons';
import Icon from '../components/Icon';
import CaptchaField from '../components/CaptchaField';

const STRENGTH = [
  { label: 'weak', colour: '#ef4444' },
  { label: 'fair', colour: '#f59e0b' },
  { label: 'good', colour: '#22d3ee' },
  { label: 'strong', colour: '#22c55e' },
];

const ROLES = [
  ['student', 'book', 'Student', 'Enrol in courses, take quizzes, solve problems and compete.'],
  ['developer', 'teacher', 'Instructor', 'Publish courses, notes, quizzes, problems and contests.'],
];

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '', email: '', password: '', confirm_password: '', role: 'student', college: '',
  });
  const [avatar, setAvatar] = useState(null);
  const [preview, setPreview] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState(null);
  const [captcha, setCaptcha] = useState({});

  useEffect(() => {
    authApi.providers().then(({ data }) => {
      const next = data.data || {};
      setProviders(next);
      if (!next.student_registration && next.developer_registration) setForm((value) => ({ ...value, role: 'developer' }));
    }).catch(() => setProviders({ registration_enabled: false }));
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const fileRef = useRef(null);
  const clearFileInput = () => { if (fileRef.current) fileRef.current.value = ''; };

  const pickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    // Always reset the input: <input type="file"> only fires change when the
    // value differs, so after Remove the same picture could never be chosen
    // again until the page was reloaded.
    clearFileInput();
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Profile picture must be smaller than 2 MB'); return; }
    if (!/^image\//.test(file.type)) { toast.error('Please choose an image file'); return; }
    setAvatar(file);
    setPreview(URL.createObjectURL(file));
  };

  const strength = useMemo(() => {
    const p = form.password;
    let s = 0;
    if (p.length >= 10) s += 1;
    if (p.length >= 12 && /[^A-Za-z0-9]/.test(p)) s += 1;
    if (/[A-Z]/.test(p)) s += 1;
    if (/[0-9]/.test(p)) s += 1;
    if (/[^A-Za-z0-9]/.test(p)) s += 1;
    // Five independent checks but only four labels — a password that passes
    // everything (12+ chars with an upper, a digit and a symbol) scored 5 and
    // indexed past STRENGTH, so the meter crashed on exactly the passwords the
    // policy asks for. Clamp to the table.
    return Math.min(s, STRENGTH.length);
  }, [form.password]);

  const matches = form.confirm_password.length > 0 && form.password === form.confirm_password;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm_password) {
      setError('The passwords do not match'); toast.error('The passwords do not match'); return;
    }
    if (form.password.length < 10) {
      const m = 'The password must be at least 10 characters long';
      setError(m); toast.error(m); return;
    }
    // The server limit is 72 *bytes* (bcrypt), but maxLength={72} only caps
    // characters — an accented or emoji password passed the field and was then
    // rejected by the API. Check the real byte length here so the message
    // arrives before the round trip.
    if (new TextEncoder().encode(form.password).length > 72) {
      const m = 'The password is too long (maximum 72 bytes — accented and emoji characters count as more than one byte)';
      setError(m); toast.error(m); return;
    }
    setBusy(true);
    try {
      const created = await register({ ...form, ...captcha });
      if (created.requires_approval) {
        toast.success('Account created — you will be able to sign in after an administrator approves it.');
        navigate('/login', { replace: true });
        return;
      }
      if (avatar) {
        try { await userApi.uploadAvatar(avatar); } catch (_) { /* optional */ }
      }
      toast.success('Account created. Welcome to SmartODL!');
      navigate(ROLE_HOME[created.user.role] || '/student', { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const registrationOpen = !!(providers?.registration_enabled && (providers.student_registration || providers.developer_registration));
  // Roles that an administrator has opened for registration. When only one role is open,
  // showing a picker is pointless; the earlier hard-coded two-column grid stayed half empty.
  const openRoles = ROLES.filter(([role]) => (
    role === 'student' ? providers?.student_registration : providers?.developer_registration
  ));
  if (!providers) {
    return <main className="auth-wrap"><div className="auth-shell solo"><div className="auth-card"><div className="loading"><div className="spinner" /><p className="muted mt-s">Checking registration availability…</p></div></div></div></main>;
  }
  if (!registrationOpen) {
    return (
      <main className="auth-wrap">
        <div className="auth-shell solo"><div className="auth-card">
          <div className="auth-head"><BrandMark size={46} /><h1>Registration is closed</h1>
            <p>New accounts are not being accepted at this time.</p>
            <p className="tiny muted mt-s">(Are you an administrator? You can open registration under Website Settings → Auth by turning on <b>registration_enabled</b> and <b>student_registration</b>.)</p></div>
          <Link className="btn btn-primary btn-block mt" to="/login">Back to login</Link>
        </div></div>
      </main>
    );
  }

  return (
    <main className="auth-wrap">
      <div className="auth-shell">
        {/* ---------------- brand panel ---------------- */}
        <aside className="auth-side">
          <div className="brand"><BrandLogo height={36} /></div>
          <div>
            <h2>Start your journey today</h2>
            <p className="lede mt-s">
              Create one account and unlock courses, notes, live quizzes, coding contests and a
              real-time leaderboard.
            </p>
          </div>

          <div className="auth-points">
            {[
              ['check', 'Free for students', 'Enrol in any published course and track your progress.'],
              ['code', 'Practice judge', 'Submit code in 6 languages with hidden test cases.'],
              ['chart', 'Progress analytics', 'Points, accuracy, rank and achievement badges.'],
              ['teacher', 'For instructors', 'Request instructor access and publish your own content.'],
            ].map(([ico, title, text]) => (
              <div className="auth-point" key={title}>
                <span className="ico"><Icon name={ico} size={19} /></span>
                <div><b>{title}</b><span>{text}</span></div>
              </div>
            ))}
          </div>

        </aside>

        {/* ---------------- form ---------------- */}
        <div className="auth-card">
          <div className="auth-head">
            <BrandMark size={46} />
            <h1>Create your account</h1>
            <p>
              {openRoles.length > 1
                ? 'Join as a student to learn, or as a developer to publish content.'
                : openRoles[0] && openRoles[0][0] === 'developer'
                  ? 'Create a developer account and publish your own content.'
                  : 'Courses, notes, live quizzes, and the coding arena — all in one account.'}
            </p>
          </div>

          {/* Show the picker only when there really are two roles to choose from; otherwise
              the control remains as a half-empty box. */}
          {openRoles.length > 1 && (
            <div className="role-picker two mt">
              {openRoles.map(([role, ico, title, text]) => (
                <button type="button" key={role} className={`role-pill ${form.role === role ? 'active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, role }))} title={text}>
                  <Icon name={ico} size={18} />
                  {title}
                </button>
              ))}
            </div>
          )}
          {form.role === 'developer' && (
            <p className="tiny muted center" style={{ marginTop: 6 }}>
              Developer accounts need admin approval before content tools unlock.
            </p>
          )}

          {error && <div className="alert err mt">{error}</div>}

          <form onSubmit={submit} className="mt">
            <div className="form-grid">
              <label className="field full">Full name *
                <input className="input" required value={form.full_name} onChange={set('full_name')}
                  autoComplete="name" placeholder="Riya Verma" />
              </label>

              <label className="field full">Email address *
                <input className="input" type="email" required value={form.email} onChange={set('email')}
                  autoComplete="email" placeholder="you@college.edu" />
              </label>

              <label className="field">Password *
                <span className="pw-row">
                  <input className="input" type={show ? 'text' : 'password'} required value={form.password}
                    onChange={set('password')} autoComplete="new-password" minLength={10} maxLength={72}
                    placeholder="kam se kam 10 characters" />
                  <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'eyeOff' : 'eye'} size={18} /></button>
                </span>
              </label>

              <label className="field">Confirm password *
                <span className="pw-row">
                  <input className="input" type={show ? 'text' : 'password'} required
                    value={form.confirm_password} onChange={set('confirm_password')}
                    autoComplete="new-password" minLength={10} maxLength={72} placeholder="Enter the password again" />
                  <span className={`pw-hint ${matches ? 'ok' : form.confirm_password ? 'bad' : ''}`}
                    aria-hidden="true">{form.confirm_password ? (matches ? '✓' : '✕') : ''}</span>
                </span>
              </label>

              {form.password && (
                <div className="pw-meter full">
                  <span className="bars">
                    {STRENGTH.map((_, i) => (
                      <i key={i} style={{ background: i < strength ? STRENGTH[strength - 1].colour : 'var(--border)' }} />
                    ))}
                  </span>
                  <span className="label">{STRENGTH[Math.max(0, strength - 1)].label}</span>
                </div>
              )}

              <label className="field full">College / Organisation
                <input className="input" value={form.college} onChange={set('college')}
                  placeholder="IIT Indore, Medi-Caps University…" />
              </label>

              <div className="field full">
                <span>Profile picture <span className="muted">(optional, max 2 MB)</span></span>
                <div className="avatar-pick">
                  <label className="avatar-drop" title="Choose a profile picture">
                    {preview ? <img src={preview} alt="Selected profile preview" /> : <Icon name="camera" size={23} />}
                    <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} style={{ display: 'none' }} />
                  </label>
                  <div className="tiny muted" style={{ flex: 1, minWidth: 160 }}>
                    {avatar ? `${avatar.name} · ${(avatar.size / 1024).toFixed(0)} KB` : 'PNG or JPG, square images look best.'}
                    {avatar && (
                      <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 10 }}
                        onClick={() => { setAvatar(null); setPreview(''); clearFileInput(); }}>Remove</button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Keep all text in one span; otherwise the flex gap is inserted between every text run
                and creates strange blank spaces around the links. */}
            <label className="checkbox small mt">
              <input type="checkbox" required />
              <span>
                I agree to the <Link className="link" to="/terms">terms of use</Link>
                {' '}and <Link className="link" to="/privacy">privacy policy</Link>
              </span>
            </label>

            <CaptchaField onChange={setCaptcha} disabled={busy} />

            <button className="btn btn-primary btn-block mt" disabled={busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          {(providers.google || providers.github) && (
            <>
              <div className="auth-or mt">or sign up with</div>
              <div className="oauth-row">
                {providers.google && <button className="oauth-btn" onClick={() => { window.location.href = '/api/auth/google'; }}>
                  <GoogleIcon /> Continue with Google
                </button>}
                {providers.github && <button className="oauth-btn" onClick={() => { window.location.href = '/api/auth/github'; }}>
                  <GithubIcon /> Continue with GitHub
                </button>}
              </div>
            </>
          )}

          <p className="center small mt">Already registered? <Link className="link" to="/login">Login instead</Link></p>
        </div>
      </div>
    </main>
  );
}
