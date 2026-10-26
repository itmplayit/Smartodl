import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { miscApi } from '../services/api';
import { timeAgo } from '../utils/format';

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 220, right: 15 });
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const popoverId = useId();

  const load = async () => {
    try {
      const { data } = await miscApi.notifications({ limit: 20 });
      setItems(data.data || []);
      setUnread((data.meta && data.meta.unread) || 0);
    } catch (_) { /* silent */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    // realtime: the SSE hub pushes every new notification instantly
    const onPush = () => load();
    window.addEventListener('smartodl:notification', onPush);
    return () => { clearInterval(t); window.removeEventListener('smartodl:notification', onPush); };
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    const closePopover = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', closePopover, { passive: true });
    window.addEventListener('resize', closePopover);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', closePopover);
      window.removeEventListener('resize', closePopover);
    };
  }, [open]);

  const markAll = async () => {
    await miscApi.markAllRead();
    setUnread(0);
    setItems((list) => list.map((n) => ({ ...n, is_read: 1 })));
  };

  const togglePopover = () => {
    if (!open && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const headerRect = buttonRef.current.closest('.public-header')?.getBoundingClientRect();
      setPopoverPosition({
        top: Math.ceil((headerRect?.bottom || buttonRect.bottom) + 8),
        right: Math.max(15, Math.ceil(window.innerWidth - buttonRect.right)),
      });
    }
    setOpen((value) => !value);
  };

  return (
    <div className="notif-wrap" ref={ref}>
      <button ref={buttonRef} className="icon-btn nav-icon-btn" type="button" onClick={togglePopover} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-haspopup="true" aria-expanded={open} aria-controls={popoverId}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        {unread > 0 && <span className="notif-dot" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div id={popoverId} className="search-pop notification-popover" role="region" aria-label="Notifications" style={{ '--notification-top': `${popoverPosition.top}px`, '--notification-right': `${popoverPosition.right}px` }}>
          <div className="between notification-popover-head">
            <strong className="small">Notifications</strong>
            {unread > 0 && <button className="btn btn-sm btn-ghost" onClick={markAll}>Mark all read</button>}
          </div>
          <div className="notification-popover-list">
            {items.length === 0 && <div className="search-item muted small">No notifications yet</div>}
            {items.map((n) => (
              <div key={n.id} className={`search-item notification-item ${n.is_read ? 'is-read' : 'is-unread'}`}>
                <div className="row" style={{ gap: 8 }}>
                  {!n.is_read && <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--brand-3)', marginTop: 6 }} />}
                  <strong className="small">{n.title}</strong>
                </div>
                <span className="tiny muted">{n.message}</span>
                <span className="tiny notification-time">{timeAgo(n.created_at)}</span>
                {n.link && <Link className="tiny link" to={n.link} onClick={() => setOpen(false)}>Open →</Link>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
