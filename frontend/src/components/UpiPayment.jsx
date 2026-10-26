import { useState } from 'react';
import { upiApi } from '../services/api';
import { useToast } from '../context/ToastContext';

/**
 * UPI Direct payment sheet: scan-or-tap to pay into the institution's UPI
 * account, then declare the UTR. There is no gateway callback here, so the
 * claim is reviewed by an admin unless auto-approve is on.
 */
export default function UpiPayment({ payment, onDone, onCancel }) {
  const toast = useToast();
  const [utr, setUtr] = useState('');
  const [payerVpa, setPayerVpa] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('pay'); // pay -> confirm -> done
  const [result, setResult] = useState(null);

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch (_) { toast.info(`Copy manually: ${text}`); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await upiApi.submit(payment.order_id, { utr: utr.trim(), payer_vpa: payerVpa.trim() });
      setResult(data.data);
      setStage('done');
      if (data.data.activated) toast.success('Payment confirmed — your plan is active!');
      else toast.success('Payment details submitted for verification');
      if (onDone) onDone(data.data);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  /* ------------------------------- done ------------------------------- */
  if (stage === 'done') {
    const activated = result?.activated;
    return (
      <div className="upi-sheet center" style={{ padding: 26 }}>
        <div style={{ fontSize: 46 }} aria-hidden="true">{activated ? '✅' : '🕐'}</div>
        <h3 style={{ margin: '10px 0 6px' }}>{activated ? 'Plan activated!' : 'Sent for verification'}</h3>
        <p className="muted small" style={{ maxWidth: 420, margin: '0 auto 16px' }}>
          {activated
            ? 'Your premium access is live right away. Enjoy!'
            : 'We have your payment reference. An administrator checks it against the bank account and your plan activates — usually within a working day. You can close this window.'}
        </p>
        <button className="btn btn-primary" onClick={onCancel}>Done</button>
      </div>
    );
  }

  /* ----------------------------- pay / confirm ----------------------------- */
  return (
    <div className="upi-sheet">
      <div className="upi-grid">
        {/* ---- left: scan ---- */}
        <div className="upi-scan">
          <div className="upi-qr" dangerouslySetInnerHTML={{ __html: payment.qr_svg }} />
          <p className="tiny muted" style={{ textAlign: 'center', margin: '10px 0 0' }}>
            Scan with GPay, PhonePe, Paytm, BHIM or any bank app
          </p>
          <a className="btn btn-primary btn-block mt-s upi-open-app" href={payment.uri}>
            📱 Open in UPI app
          </a>
          <p className="tiny muted" style={{ textAlign: 'center', margin: '6px 0 0' }}>
            (works on a phone — on a laptop use the QR)
          </p>
        </div>

        {/* ---- right: details + confirm ---- */}
        <div className="upi-detail">
          <div className="upi-amount">
            <span className="upi-amount-label">Amount to pay</span>
            <strong>₹{payment.amount}</strong>
            <span className="tiny muted">{payment.plan_name}</span>
          </div>

          <dl className="upi-kv">
            <div>
              <dt>Pay to</dt>
              <dd>
                <code>{payment.vpa}</code>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(payment.vpa, 'UPI ID')}>Copy</button>
              </dd>
            </div>
            <div>
              <dt>Payee</dt>
              <dd>{payment.payee}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>
                <code>{payment.reference}</code>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(payment.reference, 'Reference')}>Copy</button>
              </dd>
            </div>
          </dl>

          {payment.instructions && <p className="upi-note small">{payment.instructions}</p>}

          <form onSubmit={submit} className="upi-form">
            <label className="field">
              <span>UTR / reference number {payment.require_utr ? '' : '(optional)'}</span>
              <input
                className="input" value={utr} inputMode="numeric" placeholder="e.g. 412345678901"
                onChange={(e) => setUtr(e.target.value)} maxLength={24}
                required={payment.require_utr}
              />
              <small className="theme-muted">The 12-digit number on your payment receipt</small>
            </label>
            <label className="field">
              <span>Your UPI ID (optional)</span>
              <input
                className="input" value={payerVpa} placeholder="yourname@bank"
                onChange={(e) => setPayerVpa(e.target.value)} maxLength={120}
              />
              <small className="theme-muted">Helps us match your payment faster</small>
            </label>

            <div className="upi-actions">
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Submitting…' : '✅ I have paid'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
            </div>
            <p className="tiny muted" style={{ margin: '10px 0 0' }}>
              {payment.auto_approve
                ? 'Your plan activates as soon as you submit the reference.'
                : 'An administrator verifies the payment against the bank account before your plan activates.'}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
