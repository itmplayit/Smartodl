import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../services/api';
import { BrandMark } from '../components/Brand';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await authApi.forgot(email);
      setSent(data.data);
    } catch (err) {
      // Show the backend's actual message so an SMTP failure explains its cause.
      setError(err.response?.data?.error || err.response?.data?.message || err.message);
    } finally { setBusy(false); }
  };

  return (
    <main className="auth-wrap">
      <div className="auth-shell solo">
        <div className="auth-card">
          <div className="auth-head">
            <BrandMark size={46} />
            <h1>Forgot your password?</h1>
            <p>Enter the email tied to your SmartODL account and we will send a secure reset link.</p>
          </div>

          {sent ? (
            <>
              <div className="alert ok mt">✅ {sent.message || 'If that email exists, a reset link has been sent.'}</div>

              {sent.dev_reset_link && (
                <div className="alert mt" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid #f59e0b', color: 'var(--amber, #f59e0b)' }}>
                  <b>Developer mode (email is disabled):</b>{' '}
                  <span>so the reset link is shown here —</span>
                  <a href={sent.dev_reset_link} className="link" style={{ display: 'block', marginTop: 8, wordBreak: 'break-all' }}>
                    {sent.dev_reset_link}
                  </a>
                  <span style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                    To send real email, configure SMTP in the backend <code>.env</code> file (the template is provided there).
                  </span>
                </div>
              )}

              {!sent.dev_reset_link && (
                <p className="center small mt" style={{ color: 'var(--muted)' }}>
                  If it is not in your inbox, be sure to check the <b>Spam/Junk</b> folder.
                </p>
              )}

              <Link className="btn btn-ghost btn-block mt" to="/login">← Back to login</Link>
            </>
          ) : (
            <form onSubmit={submit} className="mt">
              {error && <div className="alert err mb">{error}</div>}
              <label className="field">Email address
                <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email" placeholder="you@college.edu" />
              </label>
              <button className="btn btn-primary btn-block mt" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
              <p className="center small mt"><Link className="link" to="/login">Back to login</Link></p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
