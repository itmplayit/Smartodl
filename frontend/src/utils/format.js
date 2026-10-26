export const fmtNum = (n) => new Intl.NumberFormat('en-IN').format(Number(n || 0));

export function fmtDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return d.toLocaleDateString('en-IN', opts);
}

export function timeAgo(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(value);
}

export function countdown(target) {
  if (!target) return { d: 0, h: 0, m: 0, s: 0, total: 0, ended: true };
  const total = Math.max(0, Math.floor((new Date(target).getTime() - Date.now()) / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
    total,
    ended: total <= 0,
  };
}

export const pad = (n) => String(n).padStart(2, '0');

/** Accepts either an ISO date or a number of seconds remaining. */
export const clock = (value) => {
  if (value === null || value === undefined || value === '') return '--:--';
  let total;
  if (typeof value === 'number') total = Math.max(0, Math.floor(value));
  else { const c = countdown(value); total = c.total; }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

export const fmtBytes = (bytes) => {
  const b = Number(bytes || 0);
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export const fileIcon = (type) => ({
  pdf: '📕', doc: '📄', docx: '📄', ppt: '📊', pptx: '📊', image: '🖼', zip: '🗜',
}[String(type || '').toLowerCase()] || '📁');

export const difficultyClass = (d) => ({
  easy: 'green', medium: 'amber', hard: 'red',
  beginner: 'green', intermediate: 'amber', advanced: 'red',
}[String(d).toLowerCase()] || 'gray');

export const statusClass = (s) => ({
  accepted: 'green', wrong_answer: 'red', time_limit_exceeded: 'amber', compilation_error: 'amber',
  runtime_error: 'red', memory_limit_exceeded: 'red', internal_error: 'gray',
  published: 'green', draft: 'gray', unpublished: 'gray', live: 'red', scheduled: 'cyan', completed: 'violet',
  active: 'green', pending: 'amber', suspended: 'red', evaluated: 'green', in_progress: 'amber', submitted: 'cyan',
}[String(s).toLowerCase()] || 'gray');

export const statusLabel = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const initials = (name) => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export const VERDICT_ICON = { accepted: '✓', wrong_answer: '✗', time_limit_exceeded: '⏱', compilation_error: '⚠', runtime_error: '💥', memory_limit_exceeded: '🧠', internal_error: '⚙' };

/**
 * Normalise list-ish DB values into an array.
 * MySQL JSON columns arrive already parsed (array), while TEXT columns may hold a
 * comma separated string or a JSON string — this handles every case safely.
 */
export const toList = (value) => {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try { const parsed = JSON.parse(trimmed); return Array.isArray(parsed) ? parsed : [parsed]; } catch { /* fall through */ }
    }
    return trimmed.split(',').map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === 'object') return [value];
  return [value];
};
