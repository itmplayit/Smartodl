import { useEffect, useState } from 'react';
import { miscApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Badge, Empty, Loader, Modal } from '../components/ui';
import { timeAgo } from '../utils/format';

const AUDIENCES = [['all', 'Everyone'], ['student', 'Students only'], ['developer', 'Developers only'], ['admin', 'Admins only']];
const ICONS = { course: '📘', note: '📄', quiz: '🧠', contest: '🏆', coding: '💻', achievement: '🎖', system: '⚙️' };

export default function NotificationsManager() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState({ page: 1, audience: '', type: '' });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', audience: 'all', type: 'system', link: '' });

  const load = async () => {
    try { const { data } = await miscApi.allNotifications({ ...filters, limit: 15 }); setRows(data.data); setMeta(data.meta); }
    catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable eslint-disable-next-line */ }, [JSON.stringify(filters)]);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await miscApi.broadcast(form);
      toast.success(`Notification sent to ${data.data.recipients} recipient(s)`);
      setOpen(false); setForm({ title: '', message: '', audience: 'all', type: 'system', link: '' }); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const remove = async (n) => {
    if (!window.confirm('Delete this notification?')) return;
    try { await miscApi.removeNotification(n.id); toast.success('Deleted'); load(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Communication</span><h2>Notification centre</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Automatic alerts fire for new courses, notes, quizzes, live quizzes, contests, results and badges — plus your own broadcasts.</p></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={load}>🔄 Refresh</button>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>📣 Broadcast</button>
        </div>
      </div>

      <div className="card mb">
        <div className="form-grid">
          <label className="field">Audience
            <select className="select" value={filters.audience} onChange={(e) => setFilters((f) => ({ ...f, audience: e.target.value, page: 1 }))}>
              <option value="">All audiences</option>
              {AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">Type
            <select className="select" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value, page: 1 }))}>
              <option value="">All types</option>
              {Object.keys(ICONS).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
      </div>

      {!rows && <Loader label="Loading notifications…" />}
      {rows && rows.length === 0 && <Empty title="No notifications yet" hint="Broadcast an announcement to get started." />}

      {rows && rows.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Type</th><th>Title</th><th>Message</th><th>Audience</th><th>Recipient</th><th>Read</th><th>Sent</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td>{ICONS[n.type] || '🔔'} <span className="tag">{n.type}</span></td>
                  <td><strong className="small">{n.title}</strong></td>
                  <td className="small" style={{ maxWidth: 320 }}>{n.message}</td>
                  <td><span className="tag">{n.audience}</span></td>
                  <td className="small">{n.full_name || '—'}</td>
                  <td>{n.is_read ? <Badge tone="green">read</Badge> : <Badge tone="amber">unread</Badge>}</td>
                  <td className="tiny muted">{timeAgo(n.created_at)}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => remove(n)}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(meta && meta.pages > 1) && (
        <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" disabled={meta.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Prev</button>
          <span className="tiny muted">Page {meta.page} / {meta.pages}</span>
          <button className="btn btn-sm btn-ghost" disabled={meta.page >= meta.pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next →</button>
        </div>
      )}

      <Modal open={open} title="Broadcast a notification" onClose={() => setOpen(false)}>
        <form onSubmit={send}>
          <div className="form-grid">
            <label className="field full">Title *
              <input className="input" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Mid-semester coding contest this Saturday" />
            </label>
            <label className="field full">Message *
              <textarea className="textarea" rows="3" required value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            </label>
            <label className="field">Audience
              <select className="select" value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}>
                {AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="field">Type
              <select className="select" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                {Object.keys(ICONS).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field full">Link (optional)
              <input className="input" value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))} placeholder="/contests/3" />
            </label>
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : '📣 Send notification'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
