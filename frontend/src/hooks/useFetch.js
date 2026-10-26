import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Small data-fetching hook: loading / error / data + manual refresh.
 *
 * If the API is briefly unreachable (dev-server restart, deploy, DB restart) the first
 * load is retried automatically a couple of times before surfacing an error, so an
 * open page recovers on its own instead of showing a broken section.
 */
export default function useFetch(fn, deps = [], { immediate = true, retries = 2 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(immediate);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (attempt = 0) => {
    setLoading(true); setError('');
    try {
      const res = await fnRef.current();
      setData(res && res.data ? res.data.data : res);
      return res;
    } catch (e) {
      const transient = e.isOffline || (e.status >= 500 && e.status < 600) || e.status === 429;
      if (transient && attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
        return run(attempt + 1);
      }
      setError(e.message);
      return null;
    } finally { setLoading(false); }
  }, [retries]);

  useEffect(() => { if (immediate) run(); /* eslint-disable-next-line */ }, deps);

  return { data, error, loading, refresh: run, setData };
}
