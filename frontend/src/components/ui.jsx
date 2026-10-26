import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { difficultyClass, statusClass, statusLabel } from '../utils/format';
import useFocusTrap from '../hooks/useFocusTrap';
import Icon from './Icon';

const ICON_ALIAS = {
  '🏠': 'home', '📘': 'book', '📚': 'book', '📄': 'file', '🧠': 'quiz', '💻': 'code',
  '🏆': 'trophy', '📊': 'chart', '📈': 'chart', '🎖': 'award', '🏅': 'certificate', '🎓': 'award',
  '👤': 'user', '👥': 'users', '👨‍🏫': 'teacher', '⚙️': 'settings', '🔎': 'search', '🚀': 'rocket',
  '💎': 'award', '📱': 'book', '✨': 'sparkle', '🔒': 'lock', '⚠': 'alert',
};

const VisualIcon = ({ value, size = 22 }) => {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  return <Icon name={ICON_ALIAS[value] || value} size={size} />;
};

export const Loader = ({ label = 'Loading…' }) => (
  <div className="loading" role="status" aria-live="polite" aria-label={label}>
    <div className="spinner" aria-hidden="true" /><p className="muted small mt-s">{label}</p>
  </div>
);

export const ErrorBox = ({ error, onRetry }) => (
  <div className="empty error-empty" role="alert">
    <span className="empty-icon" aria-hidden="true"><Icon name="alert" size={28} /></span>
    <h3>{error || 'Something went wrong'}</h3>
    {onRetry && <button type="button" className="btn btn-ghost mt-s" onClick={onRetry}>Retry</button>}
  </div>
);

export const Empty = ({ title = 'Nothing here yet', hint, action }) => (
  <div className="empty">
    <h2>{title}</h2>
    {hint && <p className="small">{hint}</p>}
    {action}
  </div>
);

export const Badge = ({ children, tone = '' }) => <span className={`badge ${tone}`}>{children}</span>;
export const DiffBadge = ({ value }) => <span className={`badge ${difficultyClass(value)}`}>{value}</span>;
export const StatusBadge = ({ value }) => <span className={`badge ${statusClass(value)}`}>{statusLabel(value)}</span>;

export const Modal = ({ open, title, onClose, children, wide }) => {
  const dialogRef = useRef(null);
  const backdropRef = useRef(null);
  const titleId = useId();
  useFocusTrap({ active: open, containerRef: dialogRef, onClose, backdropRef });
  if (!open) return null;
  const dialog = (
    <div ref={backdropRef} className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={dialogRef} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="between mb modal-head">
          <h2 id={titleId} className="modal-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog"><Icon name="close" size={19} /></button>
        </div>
        {children}
      </div>
    </div>
  );
  return createPortal(dialog, document.body);
};

/** GitHub-style activity heatmap: `days` = [{ date, count }] (oldest → newest). */
export const Heatmap = ({ days = [] }) => {
  // group into weeks (columns); each column holds up to 7 cells
  const weeks = [];
  let col = [];
  // pad the first week so dates align by weekday (Sun = 0)
  const first = days.length ? new Date(days[0].date) : new Date();
  for (let i = 0; i < first.getDay(); i += 1) col.push(null);
  for (const d of days) {
    col.push(d);
    if (col.length === 7) { weeks.push(col); col = []; }
  }
  if (col.length) weeks.push(col);
  const shade = (c) => {
    if (!c) return 'var(--bg-soft)';
    if (c === 0) return 'var(--white-04)';
    if (c === 1) return 'rgba(16,185,129,.35)';
    if (c <= 3) return 'rgba(16,185,129,.6)';
    return 'rgba(16,185,129,.9)';
  };
  return (
    <div style={{ display: 'flex', gap: 3, overflowX: 'auto', padding: '4px 0' }}>
      {weeks.map((w, wi) => (
        <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {w.map((d, di) => (d ? (
            <div key={di} title={`${d.date} — ${d.count} activit${d.count === 1 ? 'y' : 'ies'}`}
              style={{ width: 11, height: 11, borderRadius: 3, background: shade(d.count) }} />
          ) : <div key={di} style={{ width: 11, height: 11 }} />))}
        </div>
      ))}
    </div>
  );
};

/** XP level chip: `lv` = { level, title, progress_percent, next_at, points }. */
export const XPBadge = ({ lv, big }) => (lv ? (
  <span className="badge violet" style={big ? { fontSize: '.85rem', padding: '6px 12px' } : {}}
    title={`${lv.points} points${lv.next_at ? ` • next level at ${lv.next_at}` : ' • max level'}`}>
    <Icon name="award" size={14} /> Lv {lv.level} · {lv.title}
  </span>
) : null);

export const StatCard = ({ label, value, hint, icon, to }) => {
  const body = (
    <>
      {icon && <div className="stat-icon"><VisualIcon value={icon} size={22} /></div>}
      <div className="v">{value}</div>
      <div className="l">{label}</div>
      {hint && <div className="tiny muted mt-s">{hint}</div>}
    </>
  );
  // `to` turns the stat box into a clickable card that opens the related page
  if (to) return <Link to={to} className="stat stat-link">{body}</Link>;
  return <div className="stat">{body}</div>;
};

export const PageHead = ({ title, subtitle, actions }) => (
  <div className="page-head">
    <div>
      <h1 style={{ marginBottom: 2 }}>{title}</h1>
      {subtitle && <p className="muted small" style={{ margin: 0 }}>{subtitle}</p>}
    </div>
    {actions && <div className="row wrap">{actions}</div>}
  </div>
);

export const Tabs = ({ tabs, active, onChange, label = 'Section tabs' }) => {
  const move = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    requestAnimationFrame(() => event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus());
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, index) => (
        <button key={t.value} type="button" role="tab" aria-selected={active === t.value} tabIndex={active === t.value ? 0 : -1}
          className={`tab ${active === t.value ? 'active' : ''}`} onKeyDown={(event) => move(event, index)} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
};

export const Avatar = ({ user, size = 34 }) => {
  const name = user && (user.full_name || user.name);
  const src = user && user.avatar;
  if (src) return <img className="avatar" style={{ width: size, height: size }} src={src} alt={name} />;
  return (
    <div className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {(name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')}
    </div>
  );
};

export const Pagination = ({ meta, onPage }) => {
  if (!meta || meta.pages <= 1) return null;
  const pages = [];
  const start = Math.max(1, meta.page - 2);
  const end = Math.min(meta.pages, start + 4);
  for (let i = start; i <= end; i += 1) pages.push(i);
  return (
    <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
      <button className="btn btn-sm btn-ghost" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>← Prev</button>
      {pages.map((p) => (
        <button key={p} className={`btn btn-sm ${p === meta.page ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onPage(p)}>{p}</button>
      ))}
      <button className="btn btn-sm btn-ghost" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>Next →</button>
    </div>
  );
};

/**
 * Live countdown component driven by a target date.
 * `onEnd` is held in a ref and fired exactly once, so passing an inline callback
 * (or one that re-fetches data) can never trigger a render/effect loop.
 */
const FIRED_TARGETS = new Set(); // module scoped: one onEnd() per distinct countdown moment

export const Countdown = ({ target, prefix = '', compact = false, onEnd }) => {
  const [now, setNow] = useState(Date.now());
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(0, Math.floor((new Date(target || 0).getTime() - now) / 1000));
  const key = String(target ?? 'none');
  useEffect(() => {
    if (total === 0 && onEndRef.current && !FIRED_TARGETS.has(key)) {
      FIRED_TARGETS.add(key);
      onEndRef.current();
    }
  }, [total, key]);
  const pad = (n) => String(n).padStart(2, '0');
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (compact) return <span className="timer safe" style={{ fontSize: '.95rem' }}>{d > 0 ? `${d}d ` : ''}{pad(h)}:{pad(m)}:{pad(s)}</span>;
  return (
    <div className="row wrap" style={{ gap: 10 }}>
      {prefix && <span className="muted small">{prefix}</span>}
      {[['Days', d], ['Hours', h], ['Mins', m], ['Secs', s]].map(([label, v]) => (
        <div key={label} className="stat" style={{ minWidth: 76, padding: '10px 12px' }}>
          <div className="v" style={{ fontSize: '1.3rem' }}>{pad(v)}</div>
          <div className="l">{label}</div>
        </div>
      ))}
    </div>
  );
};

export const CopyButton = ({ text, label = 'Copy' }) => {
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-sm btn-ghost" onClick={() => { navigator.clipboard.writeText(text || ''); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? '✓ Copied' : label}
    </button>
  );
};

export const CourseCard = ({ course }) => (
  <Link to={`/courses/${course.id}`} className="card hover course-card institutional-course-card">
    {course.enrolled && <span className="badge green course-enrolled"><Icon name="check" size={13} />Enrolled</span>}
    <div className={`course-card-cover course-tone-${Number(course.id || 0) % 4}`}>
      {course.thumbnail ? <img src={course.thumbnail} alt="" /> : <span><Icon name="book" size={31} /></span>}
    </div>
    <div className="row wrap course-card-tags">
      <DiffBadge value={course.difficulty} />
      {!!Number(course.is_premium) && <span className="badge amber">⭐ Premium</span>}
      {course.category_name && <span className="tag">{course.category_name}</span>}
    </div>
    <h3>{course.title}</h3>
    <p className="muted small course-card-summary">{(course.summary || '').slice(0, 110)}{(course.summary || '').length > 110 ? '…' : ''}</p>
    <div className="course-card-meta"><span><Icon name="teacher" size={14} />{course.instructor_name || 'SmartODL'}</span><span><Icon name="award" size={14} />{Number(course.rating || 4.5).toFixed(1)}</span></div>
    <div className="course-card-meta"><span><Icon name="users" size={14} />{course.total_students || 0} enrolled</span><span><Icon name="clock" size={14} />{course.duration_hours || 0}h • {course.lessons_count || 0} lessons</span></div>
  </Link>
);

export const RankMedal = ({ rank }) => {
  if (rank <= 3) return <span className={`rank-medal rank-${rank}`}><Icon name="award" size={15} />{rank}</span>;
  return <span className="rank-number">#{rank}</span>;
};
