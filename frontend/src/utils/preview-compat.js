/**
 * Embedded-preview compatibility layer.
 *
 * Preview panes / iframes often run a page with `sandbox="allow-scripts"`, which
 * gives the document an *opaque origin*. In that environment the browser:
 *   • blocks `window.localStorage`            → handled in services/api.js (safeStorage)
 *   • blocks native form submission (no `allow-forms`), so every React
 *     `onSubmit` handler silently never runs → handled here
 *   • blocks native dialogs (`confirm`, `prompt`, `alert`) — the calls return
 *     immediately (`false` / `null`) and would dead-end a lot of actions
 *
 * In a normal browser tab none of the code below is installed, so behaviour is
 * exactly the production one.
 */

export const IS_EMBEDDED_PREVIEW = (() => {
  try {
    window.localStorage.getItem('__smartodl_probe__');
    return false;
  } catch (_) {
    return true;
  }
})();

/** Re-dispatch `submit` events so React handlers still fire without native form posting. */
function installFormFallback() {
  let fired = 0;

  const submit = (form) => {
    const now = Date.now();
    // one manual submit per form per short window (guards against double submits)
    if (form.__smartodlLastSubmit && now - form.__smartodlLastSubmit < 400) return;
    form.__smartodlLastSubmit = now;
    fired += 1;
    if (fired === 1) console.info('[preview] native form submission is blocked here — dispatching submit events in-page');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  // clicking <button type="submit"> / <input type="submit">
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('button, input[type="submit"]') : null;
      if (!el || el.disabled) return;
      const kind = el.tagName === 'BUTTON' ? el.getAttribute('type') || 'submit' : 'submit';
      if (kind !== 'submit') return;
      const form = el.form || el.closest('form');
      if (!form) return;
      setTimeout(() => submit(form), 0); // let React's own onClick handlers run first
    },
    true,
  );

  // pressing Enter inside a text field
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target;
      if (!(el instanceof Element) || !el.form) return;
      if (['TEXTAREA', 'BUTTON', 'A'].includes(el.tagName)) return;
      e.preventDefault();
      submit(el.form);
    },
    true,
  );
}

/** Native dialogs are ignored in sandboxed frames — fall back to sane defaults. */
function installDialogFallback() {
  const nativeConfirm = window.confirm?.bind(window);
  const nativePrompt = window.prompt?.bind(window);

  let warnShown = false;
  const warn = () => {
    if (warnShown) return;
    warnShown = true;
    console.info('[preview] browser dialogs are disabled in this embedded pane — confirmations are auto-accepted and prompts use their default value. Open the app in a normal tab to see them.');
  };

  window.confirm = (message) => {
    try {
      const r = nativeConfirm ? nativeConfirm(message) : false;
      if (r === false) warn(); // sandboxed frames swallow the dialog and answer false
      return true;
    } catch (_) {
      warn();
      return true;
    }
  };

  window.prompt = (message, defaultValue) => {
    try {
      const r = nativePrompt ? nativePrompt(message, defaultValue) : null;
      if (r === null || r === undefined) {
        warn();
        return defaultValue === undefined ? '' : String(defaultValue);
      }
      return r;
    } catch (_) {
      warn();
      return defaultValue === undefined ? '' : String(defaultValue);
    }
  };
}

/** Small, dismissible note so it is obvious why the page behaves slightly differently. */
function showPreviewBadge() {
  try {
    const el = document.createElement('div');
    el.id = 'smartodl-preview-note';
    // sits above the UI but lets clicks through, and hides itself after a while
    el.style.cssText = [
      'position:fixed', 'left:12px', 'bottom:12px', 'z-index:60',
      'background:rgba(17,24,39,.94)', 'color:#e5e7eb', 'border:1px solid #374151',
      'border-radius:10px', 'padding:8px 11px', 'font:11.5px/1.45 system-ui,sans-serif',
      'max-width:300px', 'box-shadow:0 10px 30px rgba(0,0,0,.45)',
      'pointer-events:none', 'transition:opacity .4s ease',
    ].join(';');
    el.innerHTML =
      '🧪 <b>Embedded preview</b> — everything works here. Browser dialogs ' +
      'and storage are limited inside preview panes; open the app in its own tab ' +
      'for the full experience. ' +
      '<button style="pointer-events:auto;margin-left:4px;background:transparent;border:0;color:#60a5fa;cursor:pointer;font:inherit">hide</button>';
    const hide = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); };
    el.querySelector('button').addEventListener('click', hide);
    document.body.appendChild(el);
    setTimeout(hide, 25000);
  } catch (_) {
    /* never let the badge break the app */
  }
}

export function installPreviewCompat() {
  if (!IS_EMBEDDED_PREVIEW) return;
  installFormFallback();
  installDialogFallback();
  const add = () => showPreviewBadge();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
}

export default installPreviewCompat;
