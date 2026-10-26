import { useEffect, useState } from 'react';

/** Seconds remaining until `target` (ISO string or ms), ticking every second. */
export default function useCountdown(target) {
  const compute = () => Math.max(0, Math.floor((new Date(target || 0).getTime() - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    setSeconds(compute());
    const t = setInterval(() => setSeconds(compute()), 1000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [target]);

  const pad = (n) => String(n).padStart(2, '0');
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return { seconds, d, h, m, s, ended: seconds <= 0, text: `${d > 0 ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}` };
}
