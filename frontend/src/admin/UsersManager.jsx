import { useEffect, useState } from 'react';
import { userApi, miscApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Avatar, Modal, StatusBadge } from '../components/ui';
import { PERMISSIONS, ROLE_META } from '../utils/constants';
import { fmtNum, timeAgo } from '../utils/format';

const ROLE_TABS = [['', 'All users'], ['student', '🎓 Students'], ['developer', '👨‍🏫 Developers'], ['admin', '🛠 Admins'], ['owner', '🛡️ Owner']];

export default function UsersManager({ defaultRole = '' }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [role, setRole] = useState(defaultRole);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [permUser, setPermUser] = useState(null);
  const [perms, setPerms] = useState([]);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'student', college: '', status: 'active', password: '' });
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    const params = { page, limit: 12 };
    if (role) params.role = role;
    if (search) params.search = search;
    const { data } = await userApi.list(params);
    setRows(data.data); setMeta(data.meta);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [role, page, search]);

  const openEdit = (u) => {
    setEditing(u);
    setForm({ full_name: u.full_name, email: u.email, role: u.role, college: u.college || '', status: u.status, password: '' });
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (editing) await userApi.update(editing.id, payload);
      else await userApi.create(payload);
      toast.success(editing ? 'User updated' : 'User created');
      setEditing(null); setCreateOpen(false); load();
    } catch (err) { toast.error(err.message); }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Delete ${u.full_name}? This also removes their submissions, attempts and enrollments.`)) return;
    try { await userApi.remove(u.id); toast.success('User deleted'); load(); } catch (err) { toast.error(err.message); }
  };

  const setStatus = async (u, status) => {
    try { await userApi.update(u.id, { status }); toast.success(`Marked ${status}`); load(); } catch (err) { toast.error(err.message); }
  };

  const [savingPerms, setSavingPerms] = useState(false);

  const openPerms = async (u) => {
    setPermUser(u);
    try {
      const { data } = await userApi.permissions(u.id);
      const rowsPerm = Array.isArray(data.data) ? data.data : (data.data.permissions || []);
      setPerms(rowsPerm.filter((p) => p.allowed).map((p) => p.code));
    } catch (_) { setPerms([]); }
  };

  const savePerms = async () => {
    setSavingPerms(true);
    try {
      const all = await userApi.permissions(permUser.id);
      const rowsPerm = Array.isArray(all.data.data) ? all.data.data : (all.data.permissions || []);
      const { data } = await userApi.setPermissions(permUser.id, rowsPerm.map((p) => ({ code: p.code, allowed: perms.includes(p.code) })));
      const res = data.data || {};
      const nice = (list) => (list || []).map((c) => c.replace(/_/g, ' ')).join(', ');
      const bits = [];
      if (res.granted && res.granted.length) bits.push(`granted ${nice(res.granted)}`);
      if (res.revoked && res.revoked.length) bits.push(`revoked ${nice(res.revoked)}`);
      if (res.approved) bits.push('account activated');
      toast.success(bits.length ? `${permUser.full_name}: ${bits.join(' · ')}` : 'Nothing changed — permissions already matched');
      if (bits.length) toast.info(`${permUser.full_name.split(' ')[0]} has been notified and their open session updates automatically.`);
      setPermUser(null); load();
    } catch (err) { toast.error(err.message); } finally { setSavingPerms(false); }
  };

  const togglePerm = (slug) => setPerms((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]));

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Access control</span><h2>User management</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Create and manage normal accounts or grant per-developer permissions. The bootstrap Owner is protected.</p></div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setForm({ full_name: '', email: '', role: 'student', college: '', status: 'active', password: '' }); setCreateOpen(true); }}>➕ New user</button>
      </div>

      <div className="tabs">
        {ROLE_TABS.map(([k, label]) => (
          <button key={k || 'all'} className={`tab ${role === k ? 'active' : ''}`} onClick={() => { setRole(k); setPage(1); }}>{label}</button>
        ))}
      </div>

      <div className="card mb mt">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1, minWidth: 240 }}>Search by name or email
            <input className="input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="riya@…" />
          </label>
          <button className="btn btn-ghost" onClick={load}>🔄 Refresh</button>
        </div>
      </div>

      <div className="table-wrap scroll-x">
        <table className="table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Points</th><th>Solved</th><th>Joined</th><th>Permissions</th><th style={{ width: 220 }}>Actions</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar user={u} size={34} />
                    <div><div style={{ fontWeight: 600 }}>{u.full_name}</div><div className="tiny muted">{u.email}</div>
                      <div className="tiny muted">{u.college || '—'}</div></div>
                  </div>
                </td>
                <td>
                  <span className="tag">{ROLE_META[u.role]?.label || u.role}</span>
                  {u.role === 'owner' && <span className="badge amber" style={{ marginLeft: 6 }}>Protected</span>}
                </td>
                <td><StatusBadge value={u.status} /></td>
                <td>{fmtNum(u.points)}</td>
                <td>{u.problems_solved}</td>
                <td className="tiny muted">{timeAgo(u.created_at)}</td>
                <td className="tiny">{u.role === 'owner' ? 'Complete access' : (u.permissions || []).length ? `${(u.permissions || []).length} granted` : '—'}</td>
                <td>
                  {u.role === 'owner' ? (
                    <span className="tiny muted" title="Owner accounts can only be established by the secure first-owner bootstrap">🛡️ Protected account</span>
                  ) : (
                    <div className="row wrap" style={{ gap: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(u)}>✏️ Edit</button>
                      {u.role === 'developer' && <button className="btn btn-sm btn-ghost" onClick={() => openPerms(u)}>🔑 Perms</button>}
                      {u.status === 'active'
                        ? <button className="btn btn-sm btn-ghost" onClick={() => setStatus(u, 'suspended')}>🚫 Suspend</button>
                        : <button className="btn btn-sm btn-ghost" onClick={() => setStatus(u, 'active')}>✅ Activate</button>}
                      <button className="btn btn-sm btn-ghost" onClick={() => removeUser(u)}>🗑</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing || createOpen} title={editing ? `Edit ${editing.full_name}` : 'Create user'} onClose={() => { setEditing(null); setCreateOpen(false); }}>
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field">Full name
              <input className="input" required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
            </label>
            <label className="field">Email
              <input className="input" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="field">Role
              <select className="select" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {['student', 'developer', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="field">Status
              <select className="select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {['active', 'pending', 'suspended'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">College / Organisation
              <input className="input" value={form.college} onChange={(e) => setForm((f) => ({ ...f, college: e.target.value }))} />
            </label>
            <label className="field">{editing ? 'Reset password (optional)' : 'Password'}
              <input className="input" type="password" value={form.password} minLength={editing ? undefined : 10} maxLength={72}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editing ? 'leave blank to keep' : 'kam se kam 10 characters'} />
            </label>
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setCreateOpen(false); }}>Cancel</button>
            <button className="btn btn-primary">{editing ? 'Save changes' : 'Create user'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!permUser} title={`Permissions — ${permUser ? permUser.full_name : ''}`} onClose={() => setPermUser(null)}>
        <p className="small muted">
          Grant exactly what this developer may do. Owners and Administrators implicitly hold every permission.
          {permUser && permUser.status === 'pending' && (
            <span className="badge amber" style={{ marginLeft: 6 }}>pending — granting a permission activates the account</span>
          )}
        </p>
        <div className="stack" style={{ gap: 10 }}>
          {PERMISSIONS.map(([slug, label]) => (
            <label className="between" key={slug} style={{ cursor: 'pointer' }}>
              <span className="small">{label} <code className="tiny muted">{slug}</code></span>
              <input type="checkbox" checked={perms.includes(slug)} onChange={() => togglePerm(slug)} />
            </label>
          ))}
        </div>
        <div className="row mt" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setPermUser(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={savePerms} disabled={savingPerms}>
            {savingPerms ? 'Saving…' : 'Save permissions'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
