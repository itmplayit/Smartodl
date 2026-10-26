import { useEffect, useRef, useState } from 'react';
import { pingServer } from '../services/api';

/**
 * Connection banner.
 *
 * The API being briefly unreachable (dev-server restart, deploy, database restart)
 * used to surface as a wall of failed requests in the console. The axios layer now
 * retries automatically and raises `smartodl:offline` when it truly cannot reach the
 * server; this component tells the user what is happening and disappears by itself
 * as soon as the health check succeeds again.
 */
export default function ConnectionStatus() {
  const [offline, setOffline] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const sinceRef = useRef(0);
  const timer = useRef(null);

  useEffect(() => {
    const goOffline = () => { setOffline(true); setRecovered(false); sinceRef.current = Date.now(); };
    const goOnline = () => { setOffline(false); setSeconds(0); };
    window.addEventListener('smartodl:offline', goOffline);
    window.addEventListener('smartodl:online', goOnline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('smartodl:offline', goOffline);
      window.removeEventListener('smartodl:online', goOnline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  useEffect(() => {
    if (!offline) { clearInterval(timer.current); return undefined; }
    let cancelled = false;
    const tick = async () => {
      setSeconds(Math.round((Date.now() - sinceRef.current) / 1000));
      try {
        await pingServer();
        if (cancelled) return;
        clearInterval(timer.current);
        // Never auto-reload: an automatic reload loop was reported when the
        // offline flag flapped. Show the recovered state and let the user
        // decide when to refresh (a manual button is on the banner).
        setOffline(false);
        setRecovered(true);
        setTimeout(() => setRecovered(false), 6000);
      } catch { /* still down — keep polling */ }
    };
    tick();
    timer.current = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(timer.current); };
  }, [offline]);

  if (offline) {
    return (
      <div className="conn-banner" role="status" aria-live="polite">
        <span className="conn-dot" />
        <strong>Reconnecting to the server…</strong>
        <span className="small">
          The API is not responding ({seconds}s). Requests retry automatically
          {seconds > 12 ? ' — check that the backend is running on port 5000' : ''}.
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => window.location.reload()}>Reload now</button>
      </div>
    );
  }

  if (recovered) {
    return (
      <div className="conn-banner conn-banner-ok" role="status" aria-live="polite">
        <span className="conn-dot conn-dot-ok" />
        <strong>Server is back online ✓</strong>
        <button className="btn btn-sm btn-ghost" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }

  return null;
}
