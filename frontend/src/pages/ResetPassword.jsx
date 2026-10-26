import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../services/api';
import { BrandMark } from '../components/Brand';
import { useToast } from '../context/ToastContext';

const STRENGTH = [
  { label: 'weak', colour: '#ef4444' },
  { label: 'fair', colour: '#f59e0b' },
  { label: 'good', colour: '#22d3ee' },
  { label: 'strong', colour: '#22c55e' },
];

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = params.get('token') || '';
  const [form, setForm] = useState({ password: '', confirm_password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const strength = useMemo(() => {
    const p = form.password;
    let s = 0;
    if (p.length >= 8) s += 1;
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

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm_password) { setError('Passwords do not match'); return; }
    if (form.password.length < 10) {
      setError('The password must be at least 10 characters long'); return;
    }
    setBusy(true); setError('');
    try {
      await authApi.reset({ token, password: form.password, confirm_password: form.confirm_password });
      toast.success('Password updated — please login');
      navigate('/login', { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <main className="auth-wrap">
      <div className="auth-shell solo">
        <div className="auth-card">
          <div className="auth-head">
            <BrandMark size={46} />
            <h1>Set a new password</h1>
            <p>The new password must be at least 10 characters long.</p>
          </div>

          <form onSubmit={submit} className="mt">
            {error && <div className="alert err mb">{error}</div>}
            {!token && (
              <div className="alert err mb">
                Reset token missing — request a new link from the{' '}
                <Link className="link" to="/forgot-password">forgot password</Link> page.
              </div>
            )}

            <label className="field">New password
              <span className="pw-row">
                <input className="input" type={show ? 'text' : 'password'} required value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password"
                  minLength={10} maxLength={72} />
                <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide password' : 'Show password'}>{show ? '🙈' : '👁'}</button>
              </span>
            </label>

            {form.password && (
              <div className="pw-meter">
                <span className="bars">
                  {STRENGTH.map((_, i) => (
                    <i key={i} style={{ background: i < strength ? STRENGTH[strength - 1].colour : 'var(--border)' }} />
                  ))}
                </span>
                <span className="label">{STRENGTH[Math.max(0, strength - 1)].label}</span>
              </div>
            )}

            <label className="field mt-s">Confirm new password
              <input className="input" type={show ? 'text' : 'password'} required value={form.confirm_password}
                onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))} autoComplete="new-password"
                minLength={10} maxLength={72} />
            </label>

            <button className="btn btn-primary btn-block mt" disabled={busy || !token}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
            <p className="center small mt"><Link className="link" to="/login">Back to login</Link></p>
          </form>
        </div>
      </div>
    </main>
  );
}
