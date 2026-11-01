import { useCallback, useEffect, useRef, useState } from 'react';
import { captchaApi } from '../services/api';

/**
 * Renders whatever CAPTCHA the server has configured.
 *
 * - `provider: 'image'`  → self-hosted SVG maths challenge, no third party.
 * - `recaptcha|hcaptcha|turnstile` → the vendor widget, loaded from their CDN.
 *
 * The component is inert until the admin sets CAPTCHA_ENABLED=true, so it is
 * safe to leave mounted. It reports `{ captchaId, captchaToken }` upward via
 * `onChange`; the parent merges those into the form payload it posts.
 *
 * NOTE (offline installs): the vendor widgets load a script from an external
 * CDN. On a network-isolated deployment use the `image` provider, which needs
 * no outbound connectivity at all.
 */
export default function CaptchaField({ onChange, disabled }) {
  const [cfg, setCfg] = useState(null);       // null = still loading
  const [challenge, setChallenge] = useState(null);
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState('');
  const widgetRef = useRef(null);
  const widgetId = useRef(null);

  // Ask the server what, if anything, is enabled.
  useEffect(() => {
    let alive = true;
    captchaApi.config()
      .then(({ data }) => { if (alive) setCfg(data || { enabled: false }); })
      .catch(() => { if (alive) setCfg({ enabled: false }); }); // never block login on this
    return () => { alive = false; };
  }, []);

  const emit = useCallback((payload) => { onChange?.(payload); }, [onChange]);

  // Nothing enabled → contribute nothing to the payload.
  useEffect(() => {
    if (cfg && !cfg.enabled) emit({});
  }, [cfg, emit]);

  const newChallenge = useCallback(() => {
    setAnswer('');
    setErr('');
    captchaApi.challenge()
      .then(({ data }) => { setChallenge(data); emit({ captchaId: data.id, captchaToken: '' }); })
      .catch(() => setErr('Could not load the security check. Please refresh.'));
  }, [emit]);

  useEffect(() => {
    if (cfg?.enabled && cfg.provider === 'image') newChallenge();
  }, [cfg, newChallenge]);

  // --- hosted widget (reCAPTCHA / hCaptcha / Turnstile) ---
  useEffect(() => {
    if (!cfg?.enabled || !cfg.provider || cfg.provider === 'image') return undefined;
    if (!cfg.siteKey) { setErr('CAPTCHA site key is not configured on the server.'); return undefined; }

    const SRC = {
      recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit',
      hcaptcha: 'https://hcaptcha.com/1/api.js?render=explicit',
      turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    }[cfg.provider];
    if (!SRC) return undefined;

    let alive = true;
    let tries = 0;
    const timer = setInterval(() => {
      const render = window.grecaptcha || window.hcaptcha || window.turnstile;
      if (!render || !widgetRef.current || widgetId.current != null) return;
      widgetId.current = render.render(widgetRef.current, {
        sitekey: cfg.siteKey,
        callback: (token) => emit({ captchaToken: token }),
        'expired-callback': () => emit({ captchaToken: '' }),
        'error-callback': () => setErr('Security check failed to load.'),
      });
      clearInterval(timer);
      // Give up politely rather than polling forever (e.g. CDN blocked).
      tries += 1;
      if (tries > 100) { clearInterval(timer); setErr('Security check could not be loaded.'); }
    }, 100);

    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);

    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, emit]);

  if (!cfg || !cfg.enabled) return null;

  if (cfg.provider === 'image') {
    return (
      <div className="field mt-s">
        <span className="small muted">Security check</span>
        <div className="captcha-row">
          {challenge
            ? <img src={challenge.svg} alt="CAPTCHA challenge" className="captcha-img" />
            : <span className="small muted">Loading…</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={newChallenge} disabled={disabled}
            aria-label="Get a new security check">↻</button>
          <input
            className="input captcha-input"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Answer"
            aria-label="Security check answer"
            value={answer}
            disabled={disabled || !challenge}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 2);
              setAnswer(v);
              emit({ captchaId: challenge?.id || '', captchaToken: v });
            }}
          />
        </div>
        {err && <span className="small danger">{err}</span>}
      </div>
    );
  }

  return (
    <div className="field mt-s">
      <span className="small muted">Security check</span>
      <div ref={widgetRef} />
      {err && <span className="small danger">{err}</span>}
    </div>
  );
}
