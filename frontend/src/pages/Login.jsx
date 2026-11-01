import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ROLE_HOME } from '../utils/constants';
import { BrandMark, BrandLogo } from '../components/Brand';
import { GoogleIcon, GithubIcon } from '../components/OAuthIcons';
import Icon from '../components/Icon';
import CaptchaField from '../components/CaptchaField';

const OAUTH_ERRORS = {
  google_not_configured: 'Google sign-in is currently unavailable.',
  github_not_configured: 'GitHub sign-in is currently unavailable.',
  google_failed: 'Google sign-in failed. Please try again.',
  github_failed: 'GitHub sign-in failed. Please try again.',
  oauth_email_missing: 'Your provider account did not share an email address.',
  oauth_state: 'This social sign-in link expired or was opened in a different browser. Please try again.',
  account_suspended: 'Your account has been suspended. Please contact the administrator.',
  account_pending: 'Your account is awaiting administrator approval.',
};

export default function Login() {
  const { login, isAuthenticated, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState({ google: false, github: false });
  const [captcha, setCaptcha] = useState({});

  useEffect(() => {
    if (params.get('expired')) toast.info('Your session expired — please login again');
    const err = params.get('error');
    if (err) setError(OAUTH_ERRORS[err] || `Sign-in error: ${err}`);
    authApi.providers().then(({ data }) => setProviders(data.data || {})).catch(() => {});
    /* eslint-disable-next-line */
  }, []);

  /* Single source of truth for "where do we go once a session exists".
   *
   * This effect and submit() used to both navigate, and the effect won the
   * race: login() calls setUser, React re-renders, the effect fires and sends
   * the user to their role home before submit() can honour location.state.from.
   * The "return to the page you were trying to reach" that ProtectedRoute sets
   * up therefore never worked. Redirecting in one place only, and reading
   * `from` here, fixes it regardless of ordering. */
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const from = location.state && location.state.from;
    navigate(from || ROLE_HOME[user.role] || '/student', { replace: true });
    /* eslint-disable-next-line */
  }, [isAuthenticated, user]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const logged = await login({ email: form.email, password: form.password, ...captcha });
      const firstName = String(logged.full_name || '').trim().split(' ')[0];
      toast.success(firstName ? `Welcome back, ${firstName}!` : 'Welcome back!');
      // the redirect effect above takes it from here
    } catch (err) { setError(err.message); toast.error(err.message); }
    finally { setBusy(false); }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const oauthConfigured = providers.google || providers.github;

  return (
    <main className="auth-wrap">
      <div className="auth-shell">
        {/* ---------------- brand panel ---------------- */}
        <aside className="auth-side">
          <div className="brand"><BrandLogo height={36} /></div>
          <div>
            <h2>Learn. Code. Compete. Grow.</h2>
            <p className="lede mt-s">
              One account for courses, notes, live quizzes, contests and a secure browser-based coding arena.
            </p>
          </div>

          <div className="auth-points">
            {[
              ['book', 'Structured courses', 'Modules, lessons, notes and downloadable study material.'],
              ['quiz', 'Live quizzes', 'Real-time timer, auto evaluation, ranking and points.'],
              ['code', 'Coding arena', 'C, C++, Java, Python, JavaScript and SQL in an online judge.'],
              ['trophy', 'Contests & leaderboards', 'Global, weekly, monthly and contest rankings from real data.'],
            ].map(([ico, title, text]) => (
              <div className="auth-point" key={title}>
                <span className="ico"><Icon name={ico} size={19} /></span>
                <div><b>{title}</b><span>{text}</span></div>
              </div>
            ))}
          </div>

          <div className="quote">“The best way to learn to code is to compete with your own last submission.”</div>

        </aside>

        {/* ---------------- form ---------------- */}
        <div className="auth-card">
          <div className="auth-head">
            <BrandMark size={46} />
            <h1>Welcome back</h1>
            <p>Login to continue learning, coding and competing.</p>
          </div>

          {location.state && location.state.reason === 'download' && (
              <div className="soft mt auth-notice"><Icon name="lock" size={17} />Please login to download this material.</div>
          )}
          {error && <div className="alert err mt">{error}</div>}

          <form onSubmit={submit} className="mt">
            <label className="field">Email address
              <input className="input" type="email" required autoComplete="email" value={form.email}
                onChange={set('email')} placeholder="you@college.edu" />
            </label>

            <label className="field mt-s">Password
              <span className="pw-row">
                <input className="input" type={show ? 'text' : 'password'} required autoComplete="current-password"
                  value={form.password} onChange={set('password')} placeholder="••••••••" />
                <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'eyeOff' : 'eye'} size={18} /></button>
              </span>
            </label>

            <div className="between mt-s">
              <span className="small muted with-ico"><Icon name="shield" size={15} />Secure session on this device</span>
              <Link className="link small" to="/forgot-password">Forgot password?</Link>
            </div>

            <CaptchaField onChange={setCaptcha} disabled={busy} />

            <button className="btn btn-primary btn-block mt" disabled={busy}>
              {busy ? 'Signing in…' : 'Login'}
            </button>
          </form>

          {oauthConfigured && (
            <>
              <div className="auth-or mt">or continue with</div>
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

          {providers.registration_enabled && (providers.student_registration || providers.developer_registration) && (
            <p className="center small mt">New here? <Link className="link" to="/register">Create an account</Link></p>
          )}

        </div>
      </div>
    </main>
  );
}
