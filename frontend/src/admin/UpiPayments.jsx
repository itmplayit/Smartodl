import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { upiApi } from '../services/api';

const inr = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN')}`;
const dt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

const TABS = [
  ['pending_review', '🕐 Awaiting review'],
  ['paid', '✅ Approved'],
  ['failed', '❌ Rejected'],
  ['created', '⏳ Not yet paid'],
  ['all', 'All'],
];

const GATEWAY_FILTERS = [
  ['all', 'All gateways'],
  ['upi', 'UPI Direct'],
  ['razorpay', 'Razorpay'],
  ['paytm', 'Paytm'],
  ['demo', 'Demo'],
  ['manual', 'Manual'],
];

const GATEWAY_LABEL = {
  upi: '📲 UPI', razorpay: '💳 Razorpay', paytm: '🅿️ Paytm', demo: '🧪 Demo', manual: '✍️ Manual',
};

const STATUS_STYLE = {
  pending_review: { bg: 'rgba(245,158,11,.16)', fg: '#f59e0b', label: 'Awaiting review' },
  paid: { bg: 'rgba(34,197,94,.16)', fg: '#22c55e', label: 'Approved' },
  failed: { bg: 'rgba(239,68,68,.16)', fg: '#ef4444', label: 'Rejected' },
  created: { bg: 'rgba(148,163,184,.16)', fg: '#94a3b8', label: 'Not yet paid' },
};

/** Admin → UPI Payments: verify direct UPI transfers and activate the plan. */
export default function UpiPayments() {
  const [tab, setTab] = useState('pending_review');
  const [gateway, setGateway] = useState('all');
  const [query, setQuery] = useState('');
  const [data, setData] = useState({ rows: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [cfgErr, setCfgErr] = useState('');

  const flash = useCallback((text, kind = 'success') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await upiApi.adminList({
        status: tab, gateway, q: query || undefined, limit: 50,
      });
      setData(d.data);
    } catch (e) { flash(e.response?.data?.error || e.message, 'error'); }
    setLoading(false);
  }, [tab, gateway, query, flash]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    upiApi.adminPreview()
      // `configured: false` is a SETUP state, not an error — show the neutral
      // panel instead of a red toast/banner on a freshly installed site.
      .then(({ data: d }) => { setCfg(d.data); setCfgErr(d.data && d.data.configured === false ? (d.data.message || 'UPI ID is not set yet.') : ''); })
      .catch((e) => setCfgErr(e.response?.data?.error || e.message));
  }, []);

  async function act(row, verb) {
    const label = `${row.full_name} · ${inr(row.amount_paise)} · ${row.plan_name}`;
    let note = '';
    if (verb === 'reject') {
      note = window.prompt(`Reject this payment?\n${label}\n\nReason (the student will see it):`, '');
      if (note === null) return;
      if (!note.trim()) { flash('A reason is required to reject', 'error'); return; }
    } else if (!window.confirm(`Approve and activate?\n\n${label}\nUTR: ${row.upi_utr || '—'}\n\nOnly do this once you can see the money in the account.`)) {
      return;
    }
    setBusyId(row.id);
    try {
      if (verb === 'approve') { await upiApi.approve(row.id, 'Verified by admin'); flash(`Approved — ${row.plan_name} activated for ${row.full_name}`); }
      else { await upiApi.reject(row.id, note.trim()); flash('Payment rejected'); }
      await load();
    } catch (e) { flash(e.response?.data?.error || e.message, 'error'); }
    setBusyId(null);
  }

  const counts = data.counts || {};

  return (
    <div className="page-wrap" style={{ padding: 24 }}>
      <div style={{ marginBottom: 18 }}>
        <div className="eyebrow">ADMIN • BILLING</div>
        <h1 className="theme-heading" style={{ margin: '8px 0', fontSize: 28 }}>Payments</h1>
        <p className="theme-muted" style={{ margin: 0 }}>
          A complete record of subscription and course sales from every gateway. UPI payments must be approved manually;
          Razorpay and Paytm payments are verified automatically.
        </p>
      </div>

      {toast && <div className={`notice ${toast.kind === 'error' ? 'error' : 'success'}`} style={{ marginBottom: 12 }}>{toast.text}</div>}

      {/* ------------------------------ setup state ------------------------------ */}
      {cfgErr ? (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          ⚠️ UPI is not set up yet — {cfgErr}{' '}
          <Link to="/admin/settings">Open Website Settings</Link> and fill in the <b>Payments</b> group.
        </div>
      ) : cfg && cfg.configured !== false && cfg.qr_svg && (
        <div className="panel upi-admin-cfg" style={{ padding: 14, marginBottom: 16 }}>
          <div className="upi-admin-qr" dangerouslySetInnerHTML={{ __html: cfg.qr_svg }} />
          <div style={{ minWidth: 0 }}>
            <b style={{ color: 'var(--heading)' }}>Collecting to {cfg.payee}</b>
            <div className="small" style={{ margin: '4px 0' }}><code>{cfg.vpa}</code></div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              <span className="tag">{cfg.enabled ? '🟢 Live at checkout' : '🔴 Switched off'}</span>
              <span className="tag">{cfg.autoApprove ? '⚡ Auto-approve ON' : '👤 Manual review'}</span>
              <span className="tag">{cfg.requireUtr ? 'UTR required' : 'UTR optional'}</span>
            </div>
            {cfg.autoApprove && (
              <p className="tiny" style={{ color: '#f59e0b', margin: '8px 0 0' }}>
                ⚠️ Auto-approve activates a plan the moment a student types a reference — nobody checks the bank.
                Use it only if you reconcile separately.
              </p>
            )}
            <p className="tiny theme-muted" style={{ margin: '8px 0 0' }}>
              This sample QR is for ₹1 — scan it yourself once to confirm the money reaches the right account.
              Change these in <Link to="/admin/settings">Website Settings → Payments</Link>.
            </p>
          </div>
        </div>
      )}

      {/* --------------------------------- tabs --------------------------------- */}
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        {TABS.map(([k, label]) => {
          const n = k === 'pending_review' ? counts.pending : k === 'paid' ? counts.paid : k === 'failed' ? counts.rejected : k === 'created' ? counts.awaiting : null;
          return (
            <button
              key={k} type="button" onClick={() => setTab(k)}
              className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`}
            >
              {label}{n ? ` (${n})` : ''}
            </button>
          );
        })}
        <select
          className="input" style={{ maxWidth: 170, marginLeft: 'auto' }}
          value={gateway} onChange={(e) => setGateway(e.target.value)}
        >
          {GATEWAY_FILTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input
          className="input" style={{ maxWidth: 240 }} type="search"
          placeholder="Search UTR, name or email…" value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {counts.paid_paise > 0 && (
        <div className="small theme-muted" style={{ marginBottom: 12 }}>
          Total collected under this filter: <b style={{ color: 'var(--green)' }}>{inr(counts.paid_paise)}</b>
        </div>
      )}

      {/* -------------------------------- table -------------------------------- */}
      {loading ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
      ) : data.rows.length === 0 ? (
        <div className="panel" style={{ padding: 36, textAlign: 'center' }}>
          <div style={{ fontSize: 38 }} aria-hidden="true">🧾</div>
          <h3 style={{ margin: '8px 0 4px' }}>Nothing here</h3>
          <p className="theme-muted small" style={{ margin: 0 }}>
            {tab === 'pending_review' ? 'No UPI payment is pending review.' : 'No payment was found under this filter.'}
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table" style={{ margin: 0, minWidth: 940 }}>
            <thead>
              <tr>
                <th>Student</th><th>Item</th><th>Gateway</th><th>Amount</th><th>UTR</th>
                <th>Paid from</th><th>Submitted</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const st = STATUS_STYLE[r.status] || { bg: 'var(--border)', fg: 'var(--text)', label: r.status };
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.full_name}</div>
                      <div className="tiny theme-muted">{r.email}</div>
                    </td>
                    <td>
                      {r.plan_name || <span className="theme-muted">(deleted)</span>}
                      <div className="tiny theme-muted">
                        {r.kind === 'course'
                          ? 'Course purchase'
                          : `Subscription · ${r.duration_days || '?'} days`}
                        {r.upi_reference ? ` · ref ${r.upi_reference}` : ''}
                      </div>
                    </td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>
                      {GATEWAY_LABEL[r.gateway] || r.gateway}
                      {r.gateway_payment_id && (
                        <div className="tiny theme-muted" title={r.gateway_payment_id}>
                          {String(r.gateway_payment_id).slice(0, 18)}
                        </div>
                      )}
                    </td>
                    <td style={{ fontWeight: 700 }}>{inr(r.amount_paise)}</td>
                    <td>{r.upi_utr ? <code>{r.upi_utr}</code> : <span className="theme-muted">—</span>}</td>
                    <td className="small">{r.upi_payer_vpa || <span className="theme-muted">—</span>}</td>
                    <td className="small">{dt(r.upi_submitted_at)}</td>
                    <td>
                      <span className="badge" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                      {r.upi_review_note && <div className="tiny theme-muted" style={{ marginTop: 3 }}>{r.upi_review_note}</div>}
                      {r.reviewed_by_name && <div className="tiny theme-muted">by {r.reviewed_by_name}</div>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.gateway === 'upi' && r.status === 'pending_review' ? (
                        <>
                          <button className="btn btn-sm btn-primary" disabled={busyId === r.id} onClick={() => act(r, 'approve')}>Approve</button>{' '}
                          <button
                            className="btn btn-sm" disabled={busyId === r.id} onClick={() => act(r, 'reject')}
                            style={{ background: 'rgba(239,68,68,.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,.3)' }}
                          >Reject
                          </button>
                        </>
                      ) : r.gateway === 'upi' && r.status === 'created' ? (
                        <span className="tiny theme-muted" title="Approval becomes available only after the student submits the payment details">
                          Awaiting payment details
                        </span>
                      ) : <span className="tiny theme-muted">{dt(r.upi_reviewed_at)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
