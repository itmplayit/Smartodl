import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { miscApi } from '../services/api';

const SettingsContext = createContext({ settings: {}, loading: true, reload: () => {} });

/** Don't hammer /settings/public if several triggers land at once. */
const MIN_GAP_MS = 4000;
/** Safety net for clients whose realtime stream dropped. */
const POLL_MS = 60000;

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const lastFetch = useRef(0);

  const reload = useCallback(async ({ force = false } = {}) => {
    if (!force && Date.now() - lastFetch.current < MIN_GAP_MS) return;
    lastFetch.current = Date.now();
    try {
      const { data } = await miscApi.publicSettings();
      setSettings(data.data || {});
    } catch (_) { /* keep the last known values */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload({ force: true }); }, [reload]);

  /* Feature Control says every switch "takes effect everywhere" immediately,
   * but this provider used to fetch once on mount and never again: a student
   * already inside a live quiz kept the flags from page load, so toggling
   * Tab Guard / Lockdown / Safe Exam Mode did nothing for them until they
   * reloaded — and Lockdown blocks F5 and Ctrl+R, so they often could not.
   *
   * Three triggers keep an open page honest:
   *   - the `settings_changed` push the API now emits on save,
   *   - returning to the tab,
   *   - a slow poll, for clients whose SSE stream died. */
  useEffect(() => {
    /* A push is an explicit "this changed" signal, so it must bypass the
       throttle — otherwise the mount fetch that happened moments earlier
       swallows exactly the reload we care about. Debounce instead, so a burst
       of toggles still results in one fetch. */
    let debounce = null;
    const onPush = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => reload({ force: true }), 400);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('smartodl:settings_changed', onPush);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => reload({ force: true }), POLL_MS);
    return () => {
      clearTimeout(debounce);
      window.removeEventListener('smartodl:settings_changed', onPush);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [reload]);

  const isOn = (key, dflt = false) => {
    const v = settings[key];
    if (v === undefined || v === null || v === '') return dflt;
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
  };

  return (
    <SettingsContext.Provider value={{ settings, loading, reload, isOn }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
