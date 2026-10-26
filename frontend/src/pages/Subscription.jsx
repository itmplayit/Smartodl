import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Empty, Loader } from '../components/ui';
import { timeAgo } from '../utils/format';

const inr = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN')}`;

const GATEWAY_LABEL = {
  demo: '🧪 demo', manual: '🎁 manual/free', upi: '📲 UPI', paytm: '🅿️ Paytm', razorpay: '💳 Razorpay',
};
const dt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** /subscription — my current plan, validity, and history. */
export default function Subscription() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    billingApi.my()
      .then(({ data: d }) => setData(d.data))
      .catch((e) => setErr(e.message));
  }, []);

  if (['owner', 'admin'].includes(user?.role)) {
    return (
      <div className="container section">
        <Empty title="Administrators do not need a subscription 😄"
          hint="Your full access is already unlocked. Use the admin panel to manage plans."
          action={<Link className="btn btn-primary" to="/admin/plans">Manage plans</Link>} />
      </div>
    );
  }
  if (err) return <div className="container section"><Empty title="The subscription could not be loaded" hint={err} /></div>;
  if (!data) return <div className="container section"><Loader label="Loading subscription…" /></div>;

  const { active, history, billing, purchases = [] } = data;
  const totalDays = active ? Number(active.duration_days) : 0;
  const leftDays = active ? Math.max(0, Number(active.days_left)) : 0;
  const pct = active && totalDays ? Math.round((leftDays / totalDays) * 100) : 0;

  return (
    <div className="container section" style={{ maxWidth: 860 }}>
      <span className="eyebrow">Premium</span>
      <h2>⭐ My Subscription</h2>

      {active ? (
        <div className="card mt" style={{ border: '2px solid #16a34a55' }}>
          <div className="between wrap" style={{ gap: 12 }}>
            <div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{active.plan_name}</div>
              <div className="small muted">
                {dt(active.starts_at)} → {dt(active.ends_at)} · <b>{leftDays} din bache</b>
              </div>
            </div>
            <span className="badge" style={{ background: '#166534', color: '#d1fae5', fontSize: 13 }}>✅ ACTIVE</span>
          </div>
          <div className="progress mt" aria-label={`${pct}% remaining`}><i style={{ width: `${pct}%` }} /></div>
          <p className="small muted mt-s" style={{ marginBottom: 0 }}>
            All ⭐ premium courses, quizzes, and coding problems are unlocked.
            {leftDays <= 3 && <span style={{ color: '#f59e0b' }}> — it expires soon, renew it now!</span>}
          </p>
          {leftDays <= 7 && (
            <Link className="btn btn-primary btn-sm mt" to="/pricing">🔄 Renew / upgrade</Link>
          )}
        </div>
      ) : (
        <div className="card mt center" style={{ padding: 28 }}>
          <div style={{ fontSize: 42 }} aria-hidden="true">⭐</div>
          <h3>No active plan yet</h3>
          <p className="muted small" style={{ maxWidth: 460, margin: '0 auto' }}>
            Premium content (anything an administrator marks with ⭐) is available only to subscribed students and developers.
            {billing.demoMode && ' (Note: DEMO MODE is active — no keys are configured, so payment will be simulated.)'}
          </p>
          <Link className="btn btn-primary mt" to="/pricing">⭐ View plans</Link>
        </div>
      )}

      <h3 className="mt">Subscription history</h3>
      {history.length === 0 ? (
        <p className="muted small">No subscription has been purchased yet.</p>
      ) : (
        <div className="table-wrap scroll-x">
          <table className="table">
            <thead><tr><th>Plan</th><th>Period</th><th>Status</th><th>Payment</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td><b>{h.plan_name}</b> <span className="tiny muted">({inr(h.price_paise)})</span></td>
                  <td className="small">{dt(h.starts_at)} → {dt(h.ends_at)}</td>
                  <td>
                    <span className={`badge ${h.status === 'active' ? 'green' : h.status === 'expired' ? '' : 'amber'}`}>
                      {h.status}
                    </span>{' '}
                    <span className="tiny muted">{timeAgo(h.ends_at)}</span>
                  </td>
                  <td className="small muted">{GATEWAY_LABEL[h.gateway] || h.gateway}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {purchases.length > 0 && (
        <>
          <h3 className="mt">Course purchases</h3>
          <div className="table-wrap scroll-x">
            <table className="table">
              <thead><tr><th>Course</th><th>Amount</th><th>Date</th><th>Status</th><th>Payment</th></tr></thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.course_slug
                        ? <Link to={`/courses/${p.course_slug}`}><b>{p.course_title}</b></Link>
                        : <b>{p.course_title || 'Course removed'}</b>}
                    </td>
                    <td><b>{inr(p.amount_paise)}</b></td>
                    <td className="small">{dt(p.paid_at || p.created_at)}</td>
                    <td>
                      <span className={`badge ${p.status === 'paid' ? 'green' : p.status === 'failed' ? '' : 'amber'}`}>
                        {p.status === 'paid' ? 'paid' : p.status === 'pending_review' ? 'review me' : p.status === 'created' ? 'adhoora' : p.status}
                      </span>
                    </td>
                    <td className="small muted">{GATEWAY_LABEL[p.gateway] || p.gateway}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="card mt">
        <h4 style={{ marginTop: 0 }}>What does Premium include?</h4>
        <div className="row wrap small" style={{ gap: 14 }}>
          <span>⭐ Premium courses + notes</span>
          <span>⭐ Premium quizzes</span>
          <span>⭐ Premium coding problems</span>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          An administrator can apply the ⭐ Premium flag to any course, quiz, or problem — that content unlocks immediately when you subscribe.
        </p>
      </div>
    </div>
  );
}
