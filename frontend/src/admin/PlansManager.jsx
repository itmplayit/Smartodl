import { useEffect, useState } from 'react';
import { billingApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Empty, Loader, Modal } from '../components/ui';
import { fmtNum, timeAgo } from '../utils/format';

const inr = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN')}`;
const dt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS_TABS = [['', '📂 All'], ['active', '✅ Active'], ['expired', '⌛ Expired'], ['cancelled', '🚫 Cancelled']];
const emptyForm = { name: '', description: '', features: '', price_rupees: 0, duration_days: 30, highlight: false, status: 'active' };

/** /admin/plans — premium plans CRUD + subscriptions overview + manual grant. */
export default function PlansManager() {
  const toast = useToast();
  const [view, setView] = useState('plans'); // plans | subs
  const [plans, setPlans] = useState(null);
  const [editing, setEditing] = useState(null); // plan ya 'new'
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [subs, setSubs] = useState(null);
  const [subsMeta, setSubsMeta] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grant, setGrant] = useState({ email: '', plan_id: '' });
  const limit = 12;

  const loadPlans = async () => {
    try { const { data } = await billingApi.adminPlans(); setPlans(data.data); }
    catch (e) { toast.error(e.message); }
  };
  const loadSubs = async () => {
    setSubs(null);
    try {
      const params = { page, limit };
      if (status) params.status = status;
      if (search) params.search = search;
      const { data } = await billingApi.adminSubs(params);
      setSubs(data.data); setSubsMeta(data.meta);
    } catch (e) { toast.error(e.message); setSubs([]); }
  };
  useEffect(() => { loadPlans(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (view === 'subs') loadSubs(); /* eslint-disable-next-line */ }, [view, status, search, page]);

  const openEditor = (plan) => {
    setEditing(plan || 'new');
    setForm(plan ? {
      name: plan.name, description: plan.description || '',
      features: (plan.features || []).join('\n'), price_rupees: plan.price_rupees,
      duration_days: plan.duration_days, highlight: !!plan.highlight, status: plan.status,
    } : emptyForm);
  };

  const savePlan = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        features: form.features.split('\n').map((x) => x.trim()).filter(Boolean),
        price_paise: Math.round(Number(form.price_rupees) * 100),
        duration_days: Number(form.duration_days),
        highlight: !!form.highlight,
        status: form.status,
      };
      if (editing === 'new') await billingApi.createPlan(payload);
      else await billingApi.updatePlan(editing.id, payload);
      toast.success(editing === 'new' ? 'Plan created' : 'Plan updated');
      setEditing(null); loadPlans();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const removePlan = async (p) => {
    if (!window.confirm(`Delete "${p.name}"? (If it has subscribers, it will be made INACTIVE and archived instead)`)) return;
    try {
      const { data } = await billingApi.removePlan(p.id);
      toast.success(data.data.archived ? 'The plan has subscribers, so it was made INACTIVE and archived' : 'Plan deleted');
      loadPlans();
    } catch (err) { toast.error(err.message); }
  };

  const toggleStatus = async (p) => {
    try {
      await billingApi.updatePlan(p.id, { status: p.status === 'active' ? 'inactive' : 'active' });
      toast.success(`Plan ${p.status === 'active' ? 'inactive (hidden from public pricing)' : 'active (live on public pricing)'}`);
      loadPlans();
    } catch (err) { toast.error(err.message); }
  };

  const doGrant = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await billingApi.grant({ email: grant.email.trim(), plan_id: Number(grant.plan_id) });
      toast.success(`⭐ Granted ${data.data.subscription.plan_name} to ${data.data.user.full_name} (${data.data.subscription.ends_at ? `valid until ${dt(data.data.subscription.ends_at)}` : ''})`);
      setGrantOpen(false); setGrant({ email: '', plan_id: '' });
      if (view === 'subs') loadSubs();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const pages = subsMeta ? Math.max(1, Math.ceil(subsMeta.total / limit)) : 1;

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Sales</span><h2>Plans & Subscriptions</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Create or edit premium plans, view subscribers, or grant a plan to a user manually.
            Administrators mark premium content with the ⭐ flag in the Courses, Quizzes, and Problems managers.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {view === 'subs' && <button className="btn btn-ghost" onClick={() => setGrantOpen(true)}>🎁 Manual grant</button>}
          {view === 'plans' && <button className="btn btn-primary" onClick={() => openEditor(null)}>➕ New plan</button>}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${view === 'plans' ? 'active' : ''}`} onClick={() => setView('plans')}>🏷 Plans</button>
        <button className={`tab ${view === 'subs' ? 'active' : ''}`} onClick={() => setView('subs')}>👥 Subscriptions</button>
      </div>

      {view === 'plans' && (
        !plans ? <Loader label="Loading plans…" /> : plans.length === 0 ? (
          <Empty title="No plans" hint="Create a new plan — it will appear on the public pricing page." />
        ) : (
          <div className="row wrap mt" style={{ gap: 14, alignItems: 'stretch' }}>
            {plans.map((p) => (
              <div key={p.id} className="card" style={{ flex: '1 1 280px', maxWidth: 360, opacity: p.status === 'active' ? 1 : 0.65 }}>
                <div className="between">
                  <h3 style={{ margin: 0 }}>{p.name}</h3>
                  <span className={`badge ${p.status === 'active' ? 'green' : ''}`}>{p.status}</span>
                </div>
                <div style={{ fontWeight: 800, fontSize: '1.5rem' }}>
                  {Number(p.price_paise) === 0 ? 'FREE' : inr(p.price_paise)}
                  <span className="tiny muted" style={{ fontWeight: 400 }}> / {p.duration_days} din</span>
                  {Boolean(p.highlight) && <span className="badge amber" style={{ marginLeft: 8 }}>🔥 popular</span>}
                </div>
                {p.description && <p className="tiny muted">{p.description}</p>}
                <div className="stack tiny" style={{ gap: 4, margin: '8px 0' }}>
                  {(p.features || []).map((f) => <span key={f}>✅ {f}</span>)}
                </div>
                <div className="small muted">👥 {fmtNum(p.active_subs)} active / {fmtNum(p.total_subs)} total subs</div>
                <div className="row wrap mt-s" style={{ gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => openEditor(p)}>✏️ Edit</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => toggleStatus(p)}>
                    {p.status === 'active' ? '⏸ Deactivate' : '▶ Activate'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => removePlan(p)}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {view === 'subs' && (
        <>
          {subsMeta && (
            <div className="row wrap mt" style={{ gap: 10 }}>
              {[
                ['👥 Total subscriptions', fmtNum(subsMeta.summary.total_subs)],
                ['✅ Active now', fmtNum(subsMeta.summary.active_subs)],
                ['💰 Total collected', `₹${fmtNum(subsMeta.summary.collected_rupees)}`],
              ].map(([label, val]) => (
                <div key={label} className="card" style={{ flex: '1 1 180px', padding: 14 }}>
                  <div className="tiny muted">{label}</div>
                  <div style={{ fontWeight: 800, fontSize: '1.4rem' }}>{val}</div>
                </div>
              ))}
            </div>
          )}
          <div className="tabs mt">
            {STATUS_TABS.map(([k, label]) => (
              <button key={k || 'all'} className={`tab ${status === k ? 'active' : ''}`} onClick={() => { setStatus(k); setPage(1); }}>{label}</button>
            ))}
          </div>
          <div className="card mb mt">
            <label className="field" style={{ marginBottom: 0 }}>Search (name / email / plan)
              <input className="input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="riya@…" />
            </label>
          </div>
          {!subs ? <Loader label="Loading subscriptions…" /> : subs.length === 0 ? (
            <Empty title="No subscriptions found" hint="Try changing the filter or search." />
          ) : (
            <div className="table-wrap scroll-x">
              <table className="table">
                <thead><tr><th>User</th><th>Plan</th><th>Period</th><th>Status</th><th>Payment</th></tr></thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id}>
                      <td><div style={{ fontWeight: 600 }}>{s.full_name}</div>
                        <div className="tiny muted">{s.email} · {s.user_role}</div></td>
                      <td><b>{s.plan_name}</b> <span className="tiny muted">({inr(s.price_paise)})</span></td>
                      <td className="small">{dt(s.starts_at)} → {dt(s.ends_at)}</td>
                      <td><span className={`badge ${s.status === 'active' ? 'green' : s.status === 'expired' ? '' : 'amber'}`}>{s.status}</span>
                        <div className="tiny muted">{timeAgo(s.ends_at)}</div></td>
                      <td className="small muted">
                        {s.gateway === 'demo' ? '🧪 demo' : s.gateway === 'manual' ? '🎁 manual' : s.gateway === 'upi' ? '📲 UPI' : s.gateway === 'paytm' ? '🅿️ Paytm' : '💳 Razorpay'}
                        {s.gateway_payment_id && <div className="tiny">{s.gateway_payment_id}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {subsMeta && subsMeta.total > limit && (
            <div className="row mt" style={{ justifyContent: 'center', gap: 10 }}>
              <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span className="small muted">Page {subsMeta.page} / {pages}</span>
              <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}

      <Modal open={!!editing} title={editing === 'new' ? 'New plan' : `Edit — ${editing ? editing.name : ''}`} onClose={() => setEditing(null)}>
        <form onSubmit={savePlan}>
          <div className="form-grid">
            <label className="field">Plan name
              <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Pro Monthly" />
            </label>
            <label className="field">Price (₹ — 0 = free)
              <input className="input" type="number" min="0" max="100000" value={form.price_rupees}
                onChange={(e) => setForm((f) => ({ ...f, price_rupees: e.target.value }))} />
            </label>
            <label className="field">Duration (din)
              <input className="input" type="number" min="1" max="3650" required value={form.duration_days}
                onChange={(e) => setForm((f) => ({ ...f, duration_days: e.target.value }))} />
            </label>
            <label className="field">Status
              <select className="select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="active">active (visible on public pricing)</option>
                <option value="inactive">inactive (keep hidden)</option>
              </select>
            </label>
          </div>
          <label className="field mt-s">Description
            <textarea className="textarea" rows="2" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="field mt-s">Features (one feature per line)
            <textarea className="textarea" rows="4" value={form.features} onChange={(e) => setForm((f) => ({ ...f, features: e.target.value }))}
              placeholder={'All premium courses\nPremium quizzes unlocked'} />
          </label>
          <label className="between mt-s" style={{ cursor: 'pointer' }}>
            <span className="small">🔥 Show the "POPULAR" badge (highlighted at the top of the pricing page)</span>
            <input type="checkbox" checked={!!form.highlight} onChange={(e) => setForm((f) => ({ ...f, highlight: e.target.checked }))} />
          </label>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={grantOpen} title="🎁 Manual plan grant" onClose={() => setGrantOpen(false)}>
        <form onSubmit={doGrant}>
          <p className="small muted">Activate a plan for any user (student or developer) free of charge — payment is skipped and the user receives a notification.</p>
          <label className="field">User email
            <input className="input" type="email" required value={grant.email} onChange={(e) => setGrant((g) => ({ ...g, email: e.target.value }))} placeholder="riya@college.com" />
          </label>
          <label className="field mt-s">Plan
            <select className="select" required value={grant.plan_id} onChange={(e) => setGrant((g) => ({ ...g, plan_id: e.target.value }))}>
              <option value="">— choose —</option>
              {(plans || []).filter((p) => p.status === 'active').map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {Number(p.price_paise) === 0 ? 'FREE' : inr(p.price_paise)} · {p.duration_days} days</option>
              ))}
            </select>
          </label>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setGrantOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Granting…' : '🎁 Grant plan'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
