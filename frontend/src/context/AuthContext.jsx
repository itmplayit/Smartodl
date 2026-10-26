import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { authApi, userApi, tokens, cachedUser, silentRefresh } from '../services/api';
import { connectRealtime, disconnectRealtime } from '../utils/realtime';

const AuthContext = createContext(null);

/** ['a','b'] → 'a|b' — cheap way to compare two permission lists. */
const permKey = (u) => (u && Array.isArray(u.permissions) ? [...u.permissions].sort().join('|') : '');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(cachedUser.get());
  // The access token is memory-only now, so a reload starts token-less and
  // the session is restored from the httpOnly refresh cookie below.
  const [loading, setLoading] = useState(true);
  const [sessionVerified, setSessionVerified] = useState(false);
  const lastFetch = useRef(0);
  const lastKey = useRef(permKey(cachedUser.get()));

  const refreshMe = useCallback(async ({ silent = false } = {}) => {
    if (!tokens.access()) {
      // Returning visitor (cached profile) -> one silent cookie refresh.
      // A brand-new anonymous visitor has no cached profile: skip the call
      // instead of spending rate-limit budget on a doomed refresh.
      if (cachedUser.get()) {
        try { await silentRefresh(); } catch (refreshError) {
          const status = (refreshError && refreshError.response && refreshError.response.status)
            || (refreshError && refreshError.status) || 0;
          if (status === 401 || status === 403) {
            tokens.clear();
            setUser(null);
          }
          // Network/5xx: keep the cached profile for display, but the
          // session remains unverified and protected routes stay closed.
          setSessionVerified(false);
          setLoading(false);
          return null;
        }
      }
    }
    if (!tokens.access()) {
      setUser(null);
      setSessionVerified(false);
      setLoading(false);
      return null;
    }
    lastFetch.current = Date.now();
    try {
      const { data } = await userApi.me();
      // Announcing a permission change lets the UI react without a page reload.
      const nextKey = permKey(data.data);
      if (nextKey !== lastKey.current) {
        const before = new Set((lastKey.current ? lastKey.current.split('|') : []).filter(Boolean));
        const after = new Set((nextKey ? nextKey.split('|') : []).filter(Boolean));
        const granted = [...after].filter((c) => !before.has(c));
        const revoked = [...before].filter((c) => !after.has(c));
        lastKey.current = nextKey;
        window.dispatchEvent(new CustomEvent('smartodl:permissions-changed', { detail: { granted, revoked } }));
      }
      setUser(data.data);
      cachedUser.save(data.data);
      setSessionVerified(true);
      return data.data;
    } catch (e) {
      // Only a real auth failure (401/403) ends the session. Network errors and
      // server outages (status 0 / offline flag) must NOT wipe the stored
      // tokens — otherwise a momentary blip logs the user out permanently.
      const isAuthFailure = e && e.status >= 400 && e.status < 500 && e.status !== 429;
      setSessionVerified(false);
      if (!silent && isAuthFailure) { tokens.clear(); setUser(null); }
      return null;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refreshMe(); }, [refreshMe]);

  /* Realtime push (SSE): live while a session exists, torn down on logout. */
  useEffect(() => {
    if (user && sessionVerified) connectRealtime(); else disconnectRealtime();
    return () => disconnectRealtime();
  }, [user && user.id, sessionVerified]);

  /* Keep the session's permissions live.
     An admin can grant or revoke a permission at any moment; without this the
     developer keeps seeing the old UI (and gets 403s) until a manual reload. */
  useEffect(() => {
    if (!user) return undefined;

    const maybeRefresh = (minGapMs = 10000) => {
      if (Date.now() - lastFetch.current < minGapMs) return;
      refreshMe({ silent: true });
    };
    const onFocus = () => maybeRefresh();
    const onVisible = () => { if (document.visibilityState === 'visible') maybeRefresh(); };
    // fired by the API on a 403 — throttled so a page that keeps hitting a
    // forbidden endpoint cannot turn into a refresh loop
    const onStale = () => maybeRefresh(15000);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('smartodl:permissions-stale', onStale);
    const timer = setInterval(() => refreshMe({ silent: true }), 60000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('smartodl:permissions-stale', onStale);
      clearInterval(timer);
    };
  }, [user, refreshMe]);

  const login = useCallback(async (credentials) => {
    const { data } = await authApi.login(credentials);
    tokens.save(data.data);
    cachedUser.save(data.data.user);
    setUser(data.data.user);
    setSessionVerified(true);
    setLoading(false);
    return data.data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await authApi.register(payload);
    // Pending (unapproved developer) responses carry no tokens by design —
    // don't pretend there's a session; Register sends them to /login.
    if (data.data.access_token) {
      tokens.save(data.data);
      cachedUser.save(data.data.user);
      setUser(data.data.user);
      setSessionVerified(true);
      setLoading(false);
    }
    return data.data;
  }, []);

  const loginWithTokens = useCallback(async (payload) => {
    tokens.save(payload);
    await refreshMe();
  }, [refreshMe]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch (_) { /* ignore */ }
    tokens.clear();
    setUser(null);
    setSessionVerified(false);
    lastKey.current = '';
  }, []);

  const value = useMemo(() => ({
    user, loading, login, register, logout, loginWithTokens, refreshMe, refreshUser: refreshMe,
    isAuthenticated: !!user && sessionVerified,
    hasRole: (...roles) => !!user && (roles.includes(user.role) || (user.role === 'owner' && roles.includes('admin'))),
    can: (permission) => !!user && (['owner', 'admin'].includes(user.role) || (user.permissions || []).includes(permission)),
  }), [user, loading, sessionVerified, login, register, logout, loginWithTokens, refreshMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
