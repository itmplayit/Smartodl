import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, tokens, cachedUser } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Loader } from '../components/ui';
import { ROLE_HOME } from '../utils/constants';

export default function OAuthCallback() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const access = params.get('access_token');
      // The refresh token arrives as an httpOnly cookie set by the callback,
      // never in the fragment.
      window.history.replaceState(null, '', '/auth/callback');
      if (!access) { setError('OAuth sign-in did not return a token.'); return; }
      tokens.save({ access_token: access });
      try {
        const { data } = await authApi.me();
        cachedUser.save(data.data);
        if (refreshUser) await refreshUser();
        navigate(ROLE_HOME[data.data.role] || '/student', { replace: true });
      } catch (e) { setError(e.message || 'Could not complete sign-in'); }
    })();
    /* eslint-disable-next-line */
  }, []);

  if (error) {
    return (
      <main className="auth-wrap">
        <div className="auth-shell solo">
          <div className="auth-card">
            <div className="auth-head">
              <div style={{ fontSize: '2.4rem' }}>⚠️</div>
              <h1>Sign-in failed</h1>
              <p>{error}</p>
            </div>
            <button className="btn btn-primary btn-block mt" onClick={() => navigate('/login')}>Back to login</button>
          </div>
        </div>
      </main>
    );
  }
  return <main className="auth-wrap"><Loader label="Completing sign-in…" /></main>;
}
