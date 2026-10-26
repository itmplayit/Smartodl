import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function NotFound({ forbidden }) {
  const { user, can, refreshMe } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(false);

  const needed = (location.state && (location.state.needed_permission || location.state.needed_role)) || '';
  const from = location.state && location.state.from;

  /** Re-read /auth/me — admins often grant the permission while this page is open. */
  const checkAgain = async () => {
    setChecking(true);
    const fresh = await refreshMe();
    setChecking(false);
    const stillBlocked = needed && !(fresh && (['owner', 'admin'].includes(fresh.role) || (fresh.permissions || []).includes(needed)));
    if (fresh && !stillBlocked && from) {
      toast.success(`Access granted${needed ? ` (${needed.replace(/_/g, ' ')})` : ''} — opening the page…`);
      navigate(from, { replace: true });
    } else {
      toast.info(`Still not granted${needed ? `: ${needed.replace(/_/g, ' ')}` : ''} — ask an administrator to enable it.`);
    }
  };

  return (
    <div className="container section center" style={{ padding: '90px 0' }}>
      <div style={{ fontSize: '3.4rem' }}>{forbidden ? '⛔' : '🧭'}</div>
      <h1>{forbidden ? '403 — Access denied' : '404 — Page not found'}</h1>
      <p className="muted">
        {forbidden
          ? 'Your account does not have permission to view this area. Ask an administrator if you think this is a mistake.'
          : 'The page you were looking for has moved or never existed.'}
      </p>

      {forbidden && needed && (
        <div className="soft" style={{ display: 'inline-block', textAlign: 'left', maxWidth: 560 }}>
          <div className="small">
            This page needs the <code>{needed.replace(/_/g, ' ')}</code> permission
            {user && user.role === 'developer' ? ' — the administrator enables it under Admin ▸ Users ▸ 🔑.' : '.'}
          </div>
          <div className="tiny muted mt-s">
            Grants reach your open session automatically (within a minute, or when you return to this tab).
          </div>
        </div>
      )}

      <div className="row mt" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        {forbidden && user && user.role === 'developer' && (
          <button className="btn btn-primary" onClick={checkAgain} disabled={checking}>
            {checking ? '⏳ Checking…' : '🔄 Check again'}
          </button>
        )}
        <Link className="btn btn-ghost" to={user && user.role === 'developer' ? '/developer' : '/'}>Go to dashboard</Link>
        <Link className="btn btn-ghost" to="/courses">Browse courses</Link>
      </div>
    </div>
  );
}
