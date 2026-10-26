import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { billingApi, upiApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Empty, Loader, Modal } from '../components/ui';
import UpiPayment from '../components/UpiPayment';

const inr = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN')}`;

/** Lazy loader for Razorpay checkout.js — it loads only when Razorpay is selected. */
export const loadRazorpay = () => new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve(true);
  const el = document.createElement('script');
  el.src = 'https://checkout.razorpay.com/v1/checkout.js';
  el.onload = () => resolve(true);
  el.onerror = () => reject(new Error('Razorpay checkout could not be loaded — check your internet connection'));
  document.body.appendChild(el);
});

/**
 * Open the Razorpay modal and continue through verification. `verify` is the function that
 * confirms either a subscription or a course order, so this helper can be reused in both
 * places.
 */
export const openRazorpay = async ({ rzp, title, description, user, verify, onSuccess, onDismiss }) => {
  await loadRazorpay();
  const checkout = new window.Razorpay({
    key: rzp.key_id,
    amount: rzp.amount_paise,
    currency: rzp.currency || 'INR',
    name: title,
    description,
    order_id: rzp.order_id,
    prefill: { name: user?.full_name, email: user?.email },
    theme: { color: '#0d6efd' },
    handler: async (resp) => {
      const v = await verify({
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature,
      });
      if (v) onSuccess(v);
    },
    modal: { ondismiss: onDismiss },
  });
  checkout.open();
};

/**
 * Paytm's hosted checkout opens through a normal form POST (mid + orderId +
 * txnToken). No external script has to be loaded, so it also works correctly
 * with a Content Security Policy.
 */
export const postToPaytm = (paytm) => {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = paytm.checkout_url;
  form.style.display = 'none';
  const fields = { mid: paytm.mid, orderId: paytm.order_id, txnToken: paytm.txn_token };
  Object.entries(fields).forEach(([k, v]) => {
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = k; i.value = v;
    form.appendChild(i);
  });
  document.body.appendChild(form);
  form.submit();
};

/** Public pricing page — view plans and subscribe (free, demo, Razorpay, Paytm, or UPI). */
export default function Pricing() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [upiCfg, setUpiCfg] = useState({ enabled: false });
  const [method, setMethod] = useState(''); // '' = choose the first available method
  const [upiPayment, setUpiPayment] = useState(null);

  const load = async () => {
    try { const { data: d } = await billingApi.plans(); setData(d.data); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);
  useEffect(() => {
    let alive = true;
    upiApi.config()
      .then(({ data }) => { if (alive) setUpiCfg(data.data || { enabled: false }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (error) return <div className="container section"><Empty title="The plans could not be loaded" hint={error} /></div>;
  if (!data) return <div className="container section"><Loader label="Loading plans…" /></div>;

  const { plans, billing, my_active: myActive } = data;

  // Payment methods that are actually available now. Only methods enabled by an administrator
  // in Website Settings appear here; demo mode is used when none is available.
  const payMethods = [
    upiCfg.enabled && { id: 'upi', icon: '📲', title: 'UPI', hint: 'GPay · PhonePe · Paytm · any bank app' },
    billing.razorpay?.enabled && { id: 'razorpay', icon: '💳', title: 'Razorpay', hint: 'Card · UPI · netbanking · wallet' },
    billing.paytm?.enabled && { id: 'paytm', icon: '🅿️', title: 'Paytm', hint: 'Paytm wallet · UPI · card · netbanking' },
    billing.demoMode && { id: 'demo', icon: '🧪', title: 'Demo payment', hint: 'Simulated — no real money' },
  ].filter(Boolean);
  const payMethod = method && payMethods.some((m) => m.id === method) ? method : (payMethods[0]?.id || 'demo');
  const canSubscribe = user && ['student', 'developer'].includes(user.role);

  /** Direct UPI: no gateway, so we fetch an intent + QR and collect the UTR. */
  const payByUpi = async (plan) => {
    if (!user) return navigate('/login', { state: { from: '/pricing' } });
    setBusy(true);
    try {
      const { data: d } = await upiApi.checkout(plan.id);
      setUpiPayment(d.data.payment);
      if (d.data.reused) toast.info('Your previous UPI order is still open, so it is being shown again.');
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const subscribe = async (plan, gateway) => {
    if (!user) return navigate('/login', { state: { from: '/pricing' } });
    if (!canSubscribe) return toast.info('Admins and owners do not need a subscription — everything is already unlocked for you 😄');
    setBusy(true);
    try {
      const { data: d } = await billingApi.checkout(plan.id, gateway);
      // ---- Free plan: activate it directly. ----
      if (d.data.activated) {
        toast.success(`⭐ ${plan.name} is now active! Premium content unlocked.`);
        setSelected(null); await load();
        return navigate('/subscription');
      }
      // ---- demo mode: payment simulate ----
      if (d.data.mode === 'demo') {
        const { data: v } = await billingApi.verify({ order_db_id: d.data.order.id });
        if (v.data.activated) {
          toast.success(`⭐ ${plan.name} is now active! (DEMO payment)`);
          setSelected(null); await load();
          return navigate('/subscription');
        }
      }
      // ---- Razorpay: inline modal ----
      if (d.data.mode === 'razorpay') {
        await openRazorpay({
          rzp: d.data.razorpay,
          title: 'SmartODL Premium',
          description: `${plan.name} — ${plan.duration_days} days`,
          user,
          verify: async (sig) => {
            try {
              const { data: v } = await billingApi.verify({ order_db_id: d.data.order.id, ...sig });
              if (v.data.pending) toast.info(v.data.message || 'Payment capture is pending — check the status again shortly.');
              return v.data.activated ? v : null;
            } catch (err) { toast.error(err.response?.data?.error || err.message); return null; }
          },
          onSuccess: () => {
            toast.success(`⭐ ${plan.name} active — premium unlocked!`);
            setSelected(null); navigate('/subscription');
          },
          onDismiss: () => toast.info('Payment was cancelled — the order is still pending, and you can try again'),
        });
        setSelected(null);
      }
      // ---- Paytm Business: redirect to the hosted checkout ----
      if (d.data.mode === 'paytm') {
        toast.info('Taking you to Paytm…');
        sessionStorage.setItem('smartodl_pending_order', String(d.data.order.id));
        postToPaytm(d.data.paytm);
      }
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="container section">
      <div className="center mb">
        <span className="eyebrow">SmartODL Premium</span>
        <h1>⭐ Premium Plans</h1>
        <p className="muted" style={{ maxWidth: 640, margin: '0 auto' }}>
          Unlock every ⭐ premium course, quiz, and coding problem.
          Anything an administrator marks as premium becomes available to subscribed students immediately.
        </p>
        {billing.demoMode && (
          <div className="notice mt" style={{ maxWidth: 640, margin: '12px auto 0', textAlign: 'left' }}>
            🧪 <b>DEMO MODE</b> — no payment gateway is currently configured, so the payment will be{' '}
            <b>simulated</b> and no real money will be charged. For real payments, an administrator must configure
            Paytm Business (MID + Merchant Key) or a UPI ID under <b>Website Settings → Payments</b>.
          </div>
        )}
        {myActive && (
          <div className="notice success mt" style={{ maxWidth: 640, margin: '12px auto 0' }}>
            ✅ Your <b>{myActive.plan_name}</b> plan is active — {myActive.days_left} days remain.{' '}
            <Link to="/subscription" className="link">View my subscription →</Link>
          </div>
        )}
      </div>

      {plans.length === 0 ? (
        <Empty title="No plans are currently available" hint="An administrator has made every plan inactive — please check again later." />
      ) : (
        <div className="row wrap" style={{ gap: 16, alignItems: 'stretch', justifyContent: 'center' }}>
          {plans.map((p) => {
            const activeThis = myActive && Number(myActive.plan_id) === Number(p.id);
            return (
              <div key={p.id} className="card" style={{
                flex: '1 1 260px', maxWidth: 330, display: 'flex', flexDirection: 'column',
                border: p.highlight ? '2px solid #f59e0b' : undefined,
                position: 'relative',
              }}>
                {Boolean(p.highlight) && (
                  <span className="badge amber" style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)' }}>
                    🔥 POPULAR
                  </span>
                )}
                <h3 style={{ marginBottom: 4 }}>{p.name}</h3>
                <div style={{ fontWeight: 800, fontSize: '1.9rem' }}>
                  {Number(p.price_paise) === 0 ? 'FREE' : inr(p.price_paise)}
                  <span className="tiny muted" style={{ fontWeight: 400 }}> / {p.duration_days} days</span>
                </div>
                {p.description && <p className="small muted">{p.description}</p>}
                <div className="stack small" style={{ gap: 6, margin: '10px 0', flex: 1 }}>
                  {(p.features || []).map((f) => <span key={f}>✅ {f}</span>)}
                </div>
                {activeThis ? (
                  <button className="btn btn-block" disabled>✅ Currently active plan</button>
                ) : !user ? (
                  <Link className="btn btn-primary btn-block" to="/login" state={{ from: '/pricing' }}>Log in to subscribe</Link>
                ) : (
                  <button className="btn btn-primary btn-block" disabled={busy}
                    onClick={() => setSelected(p)}>
                    {Number(p.price_paise) === 0 ? '🎁 Activate for free' : `⭐ Get it for ${inr(p.price_paise)}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!selected} title={selected ? `Confirm — ${selected.name}` : ''} onClose={() => setSelected(null)}>
        {selected && (
          <>
            <p className="small">
              Plan: <b>{selected.name}</b> · {inr(selected.price_paise)} · {selected.duration_days} days
            </p>
            {Number(selected.price_paise) === 0 ? (
              <p className="small muted">This is a free plan — no payment is required, and it will activate as soon as you confirm.</p>
            ) : (
              <>
                {payMethods.length > 1 && (
                  <div className="pay-methods" role="radiogroup" aria-label="Payment method">
                    {payMethods.map((m) => (
                      <button
                        key={m.id}
                        type="button" role="radio" aria-checked={payMethod === m.id}
                        className={`pay-method${payMethod === m.id ? ' is-active' : ''}`}
                        onClick={() => setMethod(m.id)}
                      >
                        <span className="pay-method-icon" aria-hidden="true">{m.icon}</span>
                        <span>
                          <strong>{m.title}</strong>
                          <span className="tiny muted">{m.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {payMethod === 'upi' ? (
                  <p className="small muted">Pay straight into {upiCfg.payee || 'the institution'}&apos;s UPI account, then enter your UTR.</p>
                ) : payMethod === 'razorpay' ? (
                  <p className="small muted">
                    After confirmation, Razorpay's secure checkout window will open (card, UPI, netbanking, or wallet).
                    {billing.razorpay?.live === false && <> <b>Test mode</b> — no real money will be charged.</>}
                  </p>
                ) : payMethod === 'paytm' ? (
                  <p className="small muted">After confirmation, Paytm's secure payment page will open (UPI, card, netbanking, or wallet).</p>
                ) : (
                  <p className="small muted">🧪 DEMO MODE: the payment will be simulated and the plan will activate as soon as you confirm. No real money will be charged.</p>
                )}
              </>
            )}
            <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>Cancel</button>
              <button
                className="btn btn-primary" disabled={busy}
                onClick={() => (payMethod === 'upi' && Number(selected.price_paise) > 0
                  ? payByUpi(selected)
                  : subscribe(selected, ['razorpay', 'paytm'].includes(payMethod) ? payMethod : undefined))}
              >
                {busy ? 'Processing…'
                  : payMethod === 'upi' && Number(selected.price_paise) > 0 ? '📲 Pay with UPI'
                    : payMethod === 'razorpay' ? '💳 Pay with Razorpay'
                      : payMethod === 'paytm' ? '🅿️ Pay with Paytm' : 'Confirm'}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={!!upiPayment}
        title={upiPayment ? `Pay ₹${upiPayment.amount} by UPI` : ''}
        onClose={() => setUpiPayment(null)}
      >
        {upiPayment && (
          <UpiPayment
            payment={upiPayment}
            onDone={(r) => { if (r.activated) { load(); } }}
            onCancel={() => { setUpiPayment(null); setSelected(null); load(); }}
          />
        )}
      </Modal>
    </div>
  );
}
