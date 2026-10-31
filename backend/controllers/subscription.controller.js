'use strict';
/**
 * Plans (public list + admin CRUD), subscription checkout/verify (student+developer),
 * admin subscriptions overview & manual grant.
 *
 * Payment modes:
 *  - razorpay: Key ID+Secret configured — real Orders API + HMAC signature
 *             verify + server-side payment re-fetch before activating
 *  - paytm  : Paytm Business MID+key configured — real initiateTransaction +
 *             checksum verify + server-side status re-query before activating
 *  - upi     : UPI Direct (QR + UTR, admin reviews) — see upi.controller.js
 *  - demo    : nothing configured — simulate the payment and activate immediately (development only)
 *  - manual  : instant activation of a free plan or an administrator's manual grant
 */
const { q, q1, exec, tx } = require('../config/db');
const { ApiError, asyncHandler, ok, created, slugify, parsePagination } = require('../utils/helpers');
const { clientBase, isClientUrlConfigured } = require('../utils/clientUrl');
const service = require('../services/subscription.service');
const paytm = require('../services/paytm.service');
const razorpay = require('../services/razorpay.service');
const { matchesPaiseAmount } = require('../utils/paymentAmount');

/**
 * Tells the pricing and subscription screens which gateway is live.
 * A secret is never exposed — only whether the gateway is configured.
 */
async function billingInfo() {
  const [pt, rz, upiCfg] = await Promise.all([
    paytm.config(), razorpay.config(), require('../services/upi.service').config(),
  ]);
  return {
    demoMode: demoPaymentsAllowed() && !pt.enabled && !rz.enabled && !upiCfg.enabled,
    paymentsConfigured: pt.enabled || rz.enabled || upiCfg.enabled,
    razorpay: { enabled: rz.enabled, live: rz.live, key_id: rz.enabled ? rz.keyId : null },
    paytm: { enabled: pt.enabled, env: pt.env, key_invalid: pt.keyLooksWrong },
    upi: { enabled: !!upiCfg.enabled },
    // Gateways a student can choose directly; UPI has its own separate flow.
    gateways: [
      ...(rz.enabled ? ['razorpay'] : []),
      ...(pt.enabled ? ['paytm'] : []),
    ],
  };
}

/**
 * Determine which gateway to use. The student may send `gateway`; when omitted, use
 * the first enabled gateway, or demo mode when none is enabled.
 */
const demoPaymentsAllowed = () => process.env.NODE_ENV !== 'production'
  || String(process.env.ALLOW_DEMO_PAYMENTS || '').trim().toLowerCase() === 'true';

async function resolveGateway(requested) {
  const [pt, rz] = await Promise.all([paytm.config(), razorpay.config()]);
  const live = { razorpay: rz.enabled, paytm: pt.enabled };
  const want = String(requested || '').trim().toLowerCase();
  if (want) {
    if (!['razorpay', 'paytm'].includes(want)) throw ApiError.badRequest(`Unknown gateway: ${want}`);
    if (!live[want]) throw ApiError.badRequest(`${want === 'paytm' ? 'Paytm' : 'Razorpay'} is not currently enabled — ask an administrator to turn it on under Website Settings → Payments.`);
    return { gateway: want, cfg: want === 'paytm' ? pt : rz };
  }
  if (rz.enabled) return { gateway: 'razorpay', cfg: rz };
  if (pt.enabled) return { gateway: 'paytm', cfg: pt };
  // SECURITY: "demo mode" activates paid entitlements with zero payment proof.
  // In production that must never be the silent fallback just because no
  // gateway was configured yet — fail checkout until a real gateway exists
  // (Razorpay/Paytm keys, or UPI Direct with a VPA, in Website Settings).
  const upiCfg = await require('../services/upi.service').config();
  if (upiCfg.enabled) throw ApiError.badRequest('Only UPI Direct is currently available — choose the UPI option at checkout.');
  if (!demoPaymentsAllowed()) {
    throw ApiError.serviceUnavailable('Payments are not configured on this site yet. Please contact the administrator.');
  }
  return { gateway: 'demo', cfg: null };
}
const { notify } = require('../services/notification.service');

const planSafe = (p) => ({
  id: p.id, name: p.name, slug: p.slug, description: p.description,
  features: p.features ? JSON.parse(p.features) : [],
  price_paise: Number(p.price_paise), price_rupees: Number(p.price_paise) / 100,
  duration_days: Number(p.duration_days), highlight: !!Number(p.highlight),
  status: p.status, sort_order: Number(p.sort_order || 0),
});

/* --------------------------------- public --------------------------------- */

/** GET /api/plans — active plans for the pricing page */
const plans = asyncHandler(async (req, res) => {
  const rows = await q("SELECT * FROM plans WHERE status='active' ORDER BY sort_order, price_paise");
  let active = null;
  if (req.user) active = await service.getActiveSubscription(req.user.id);
  ok(res, {
    plans: rows.map(planSafe),
    billing: await billingInfo(),
    my_active: active,
  });
});

/** GET /api/subscriptions/me — my plan status and history */
const myStatus = asyncHandler(async (req, res) => {
  const active = await service.getActiveSubscription(req.user.id);
  const history = await q(
    `SELECT s.id, s.status, s.starts_at, s.ends_at, p.name AS plan_name, p.price_paise, o.gateway
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       LEFT JOIN subscription_orders o ON o.id = s.order_id
      WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 12`,
    [req.user.id],
  );
  // A course purchase does not create a subscription row, so it never appeared in the
  // history above and the student had no receipt for the amount paid. Course
  // purchases are therefore returned separately.
  const purchases = await q(
    `SELECT o.id, o.status, o.amount_paise, o.gateway, o.created_at, o.paid_at,
            o.course_id, c.title AS course_title, c.slug AS course_slug
       FROM subscription_orders o
       LEFT JOIN courses c ON c.id = o.course_id
      WHERE o.user_id = ? AND o.kind = 'course' AND o.status <> 'cancelled'
      ORDER BY o.id DESC LIMIT 20`,
    [req.user.id],
  );
  ok(res, {
    active,
    history,
    purchases,
    billing: await billingInfo(),
  });
});

/* -------------------------------- paytm --------------------------------- */

/**
 * Public base URL for Paytm's server-to-server callback.
 *
 * Always prefer PUBLIC_URL or CLIENT_URL. Falling back to the Host header is only a development
 * convenience for tunnels such as ngrok, so it is sanitised; otherwise a caller could send
 * `Host: evil.com` and redirect Paytm's callback to their own server.
 */
const SAFE_HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;
let warnedAboutHost = false;

const publicBase = (req) => {
  const explicit = String(process.env.PUBLIC_URL || '').split(',')[0].trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (isClientUrlConfigured()) return clientBase();

  const host = String(req.get('host') || '');
  if (!SAFE_HOST.test(host)) {
    throw ApiError.badRequest('PUBLIC_URL is not set and the Host header is not trusted — set PUBLIC_URL in .env');
  }
  if (!warnedAboutHost) {
    warnedAboutHost = true;
    console.warn('[billing] PUBLIC_URL/CLIENT_URL is not set — building the callback URL from the Host header. Be sure to set PUBLIC_URL in production.');
  }
  return `${req.protocol}://${host}`;
};

/** Paytm order ids must be unique forever — db id alone would collide after a reset. */
const paytmOrderId = (order) => `SODL${String(order.id).padStart(6, '0')}`;

/**
 * Find-or-create one open checkout order while holding the buyer's user row.
 * Repeated clicks/page refreshes therefore reuse the same DB order, while a
 * price change cancels the stale order instead of charging the old amount.
 */
async function findOrCreateOpenOrder({ userId, kind, planId = null, courseId = null, amountPaise, gateway }) {
  return tx(async (conn) => {
    const [[user]] = await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!user) throw ApiError.notFound('User not found');
    const [[existing]] = await conn.query(
      `SELECT * FROM subscription_orders
        WHERE user_id = ? AND kind = ? AND COALESCE(plan_id,0) = ?
          AND COALESCE(course_id,0) = ? AND gateway = ? AND status = 'created'
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [userId, kind, planId || 0, courseId || 0, gateway],
    );
    if (existing && Number(existing.amount_paise) === Number(amountPaise)) {
      return { order: existing, reused: true };
    }
    if (existing) {
      await conn.query(
        "UPDATE subscription_orders SET status='cancelled' WHERE id = ? AND status='created'",
        [existing.id],
      );
    }
    const [result] = await conn.execute(
      `INSERT INTO subscription_orders
         (user_id, kind, plan_id, course_id, amount_paise, gateway, status)
       VALUES (?,?,?,?,?,?,'created')`,
      [userId, kind, planId, courseId, Number(amountPaise), gateway],
    );
    const [[order]] = await conn.query(
      'SELECT * FROM subscription_orders WHERE id = ?',
      [result.insertId],
    );
    return { order, reused: false };
  });
}

/** Create the Paytm transaction and hand the browser what it needs to redirect. */
async function startPaytm({ order, req, cfg }) {
  const gatewayOrderId = paytmOrderId(order);
  const txn = await paytm.initiateTransaction({
    orderId: gatewayOrderId,
    amountPaise: Number(order.amount_paise),
    customerId: order.user_id,
    callbackUrl: `${publicBase(req)}/api/subscriptions/paytm/callback`,
    cfg,
  });
  await exec('UPDATE subscription_orders SET gateway_order_id = ? WHERE id = ?', [gatewayOrderId, order.id]);
  return {
    mid: cfg.mid,
    order_id: gatewayOrderId,
    txn_token: txn.txnToken,
    amount: txn.amount,
    checkout_url: txn.checkoutUrl,
    env: cfg.env,
  };
}

/* ------------------------------- razorpay -------------------------------- */

/** Create the Razorpay order and hand the browser what checkout.js needs. */
async function startRazorpay({ order, cfg, label }) {
  if (order.gateway_order_id && String(order.gateway_order_id).startsWith('order_')) {
    return {
      key_id: cfg.keyId,
      order_id: order.gateway_order_id,
      amount_paise: Number(order.amount_paise),
      currency: 'INR',
      live: cfg.live,
    };
  }
  const rzpOrder = await razorpay.createOrder({
    amountPaise: Number(order.amount_paise),
    receipt: `sodl_${order.kind === 'course' ? 'c' : 's'}_${order.id}`,
    cfg,
    notes: { order_id: String(order.id), kind: order.kind || 'subscription', item: String(label || '').slice(0, 60) },
  });
  await exec('UPDATE subscription_orders SET gateway_order_id = ? WHERE id = ?', [rzpOrder.id, order.id]);
  return {
    key_id: cfg.keyId,
    order_id: rzpOrder.id,
    amount_paise: Number(order.amount_paise),
    currency: 'INR',
    live: cfg.live,
  };
}

/**
 * Did this Razorpay order really get paid? Signature first (cheap, proves the
 * client isn't forging), then a server-side re-fetch (proves Razorpay agrees).
 * Idempotent — a replayed callback returns the existing activation.
 */
async function settleWithRazorpay(order, { paymentId, signature } = {}) {
  if (order.gateway !== 'razorpay') {
    return { paid: false, message: 'This is not a Razorpay order — verify it through the correct payment flow.' };
  }
  if (order.status === 'paid') {
    const already = order.kind === 'course'
      ? await q1('SELECT * FROM enrollments WHERE id = ?', [order.enrollment_id])
      : await q1('SELECT * FROM subscriptions WHERE order_id = ? LIMIT 1', [order.id]);
    return { paid: true, already: true, activated: already, message: 'Already paid' };
  }
  const cfg = await razorpay.config({ force: true });
  if (!cfg.configured) return { paid: false, message: 'Razorpay is not configured — ask an administrator to set the keys under Website Settings → Payments.' };
  if (!paymentId || !signature) return { paid: false, message: 'Both razorpay_payment_id and razorpay_signature are required.' };

  if (!razorpay.verifySignature({ orderId: order.gateway_order_id, paymentId, signature, cfg })) {
    await exec("UPDATE subscription_orders SET status='failed' WHERE id = ? AND status='created'", [order.id]);
    return { paid: false, message: 'The payment signature did not match — the order has been marked as failed. Please try again.' };
  }
  // The signature is valid; now confirm the payment directly with Razorpay.
  return confirmCapturedRazorpayPayment(order, cfg, paymentId);
}

/**
 * THE entitlement gate for Razorpay, shared by the browser-return verify and
 * the server webhook: ask Razorpay what really happened and only activate a
 * *captured* payment for the exact order amount. Idempotent.
 */
async function confirmCapturedRazorpayPayment(order, cfg, paymentId) {
  if (order.gateway !== 'razorpay') {
    return { paid: false, message: 'This is not a Razorpay order — verify it through the correct payment flow.' };
  }
  if (order.status === 'paid') {
    const already = order.kind === 'course'
      ? await q1('SELECT * FROM enrollments WHERE id = ?', [order.enrollment_id])
      : await q1('SELECT * FROM subscriptions WHERE order_id = ? LIMIT 1', [order.id]);
    return { paid: true, already: true, activated: already, message: 'Already paid' };
  }
  const pay = await razorpay.fetchPayment({ paymentId, cfg });
  if (pay.status === 'authorized') {
    // Authorized is not money captured yet. Never grant the entitlement (or
    // mark the order failed) on authorization alone; capture may still land.
    return { paid: false, pending: true, message: 'The Razorpay payment is authorised but has not been captured yet. Verify again after capture is confirmed; you may send the payment ID to support.' };
  }
  if (pay.status !== 'captured') {
    await exec("UPDATE subscription_orders SET status='failed' WHERE id = ? AND status='created'", [order.id]);
    return { paid: false, message: `The Razorpay payment status is ${pay.status}, not successful — please try again.` };
  }
  if (pay.orderId && pay.orderId !== order.gateway_order_id) {
    return { paid: false, message: 'This payment belongs to a different order — please contact support.' };
  }
  if (pay.amountPaise !== Number(order.amount_paise)) {
    return { paid: false, message: `Amount mismatch — the order was for ₹${(Number(order.amount_paise) / 100).toFixed(2)}, but ₹${(pay.amountPaise / 100).toFixed(2)} was paid. Please contact support.` };
  }
  const activated = await service.activateOrder(order, { paymentId });
  return { paid: true, activated, message: 'Payment successful' };
}

/**
 * POST /api/subscriptions/razorpay/webhook — Razorpay server-to-server webhook.
 *
 * This is the safety net for "money taken, browser closed before /verify ran":
 * Razorpay calls this directly, so activation no longer depends on the
 * student's browser coming back. Unauthenticated by design; safety comes from
 * (a) the webhook HMAC over the *raw* body, verified against the dedicated
 * webhook secret, and (b) confirmCapturedRazorpayPayment() re-fetching the
 * payment from Razorpay before anything is activated. Point the Razorpay
 * dashboard webhook (events: payment.captured, order.paid) at this URL and set
 * the same secret under Website Settings -> Payments.
 */
const razorpayWebhook = async (req, res) => {
  try {
    const cfg = await razorpay.config({ force: true });
    if (!cfg.configured || !cfg.webhookSecret) {
      return res.status(503).json({ success: false, error: 'Razorpay webhook is not configured' });
    }
    const signature = req.get('x-razorpay-signature');
    if (!req.rawBody || !razorpay.verifyWebhook({ rawBody: req.rawBody, signature, secret: cfg.webhookSecret })) {
      return res.status(400).json({ success: false, error: 'Invalid webhook signature' });
    }
    const event = String((req.body && req.body.event) || '');
    const payment = (req.body && req.body.payload && req.body.payload.payment && req.body.payload.payment.entity) || null;
    if (!['payment.captured', 'order.paid'].includes(event) || !payment || !payment.id || !payment.order_id) {
      return res.json({ success: true, ignored: true });
    }
    const order = await q1('SELECT * FROM subscription_orders WHERE gateway_order_id = ?', [payment.order_id]);
    if (!order) return res.json({ success: true, ignored: 'unknown order' });
    const result = await confirmCapturedRazorpayPayment(order, cfg, payment.id);
    return res.json({ success: true, paid: result.paid, already: !!result.already });
  } catch (err) {
    // A 5xx makes Razorpay retry with backoff — correct for "gateway/DB briefly
    // unreachable". Bad signatures/irrelevant events were already answered above.
    console.error('[razorpay] webhook processing failed:', err.message);
    return res.status(502).json({ success: false, error: 'Webhook processing failed, please retry' });
  }
};

/**
 * Single source of truth for "did this Paytm order actually get paid?".
 * Always re-queries Paytm — the callback body and the client are both untrusted.
 * Idempotent: calling it twice on a paid order returns the same activation.
 */
async function settleWithPaytm(order) {
  if (order.gateway !== 'paytm') {
    return { paid: false, message: 'This is not a Paytm order — verify it through the correct payment flow.' };
  }
  if (order.status === 'paid') {
    const already = order.kind === 'course'
      ? await q1('SELECT * FROM enrollments WHERE id = ?', [order.enrollment_id])
      : await q1('SELECT * FROM subscriptions WHERE order_id = ? LIMIT 1', [order.id]);
    return { paid: true, already: true, activated: already, message: 'Already paid' };
  }
  const cfg = await paytm.config({ force: true });
  if (!cfg.configured) return { paid: false, message: 'Paytm Business is not configured — ask an administrator to set the MID and Merchant Key in Website Settings.' };
  const status = await paytm.fetchStatus({ orderId: order.gateway_order_id || paytmOrderId(order), cfg });
  if (status.status === 'PENDING') {
    return { paid: false, pending: true, message: 'The Paytm payment is still PENDING — refresh the page shortly after the bank confirms it.' };
  }
  if (status.status !== 'TXN_SUCCESS') {
    await exec("UPDATE subscription_orders SET status='failed' WHERE id = ? AND status='created'", [order.id]);
    return { paid: false, message: `The Paytm payment was not successful: ${status.message || 'failed'} — please try again.` };
  }
  // Fail closed: a successful status is not enough without an exact amount
  // from Paytm. Missing, malformed, or mismatched amounts must never grant an
  // entitlement; otherwise an incomplete gateway response could activate free.
  const expected = (Number(order.amount_paise) / 100).toFixed(2);
  if (!matchesPaiseAmount(status.amount, order.amount_paise)) {
    const received = status.amount === null || status.amount === undefined || String(status.amount).trim() === ''
      ? 'not supplied' : `₹${status.amount}`;
    return { paid: false, message: `Amount verification failed — expected ₹${expected}, Paytm reported ${received}. Please contact support.` };
  }
  if (!status.txnId) return { paid: false, pending: true, message: 'Paytm reported success, but no transaction ID was returned — check the status again shortly.' };
  const activated = await service.activateOrder(order, { paymentId: status.txnId });
  return { paid: true, activated, message: 'Payment successful' };
}

/**
 * POST /api/subscriptions/paytm/callback — Paytm server-to-server callback.
 * Unauthenticated by design (Paytm has no JWT); the checksum + a status
 * re-query are what make it safe. Always redirects the user somewhere sane.
 */
const paytmCallback = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const gatewayOrderId = String(body.ORDERID || body.orderId || '');
  const order = await q1('SELECT * FROM subscription_orders WHERE gateway_order_id = ?', [gatewayOrderId]);
  const land = (okFlag, msg) => {
    const base = clientBase();
    const path = order && order.kind === 'course'
      ? `/courses/${order.course_id}`
      : '/subscription';
    return res.redirect(`${base}${path}?payment=${okFlag ? 'success' : 'failed'}&msg=${encodeURIComponent(msg)}`);
  };
  if (!order) return land(false, 'Order not found');

  // checksum verify (defence in depth — the status re-query is the real gate)
  const cfg = await paytm.config({ force: true });
  const { CHECKSUMHASH, ...rest } = body;
  if (!CHECKSUMHASH || !paytm.verifySignature(rest, cfg.key, CHECKSUMHASH)) {
    console.warn(`[paytm] checksum mismatch on callback for order ${gatewayOrderId}`);
    return land(false, 'Checksum verification failed');
  }
  const result = await settleWithPaytm(order);
  return land(result.paid, result.paid ? 'Payment successful' : result.message);
});

/** GET /api/subscriptions/paytm/status/:id — frontend polls this after returning. */
const paytmStatus = asyncHandler(async (req, res) => {
  const order = await q1(
    'SELECT * FROM subscription_orders WHERE id = ? AND user_id = ?',
    [Number(req.params.id) || 0, req.user.id],
  );
  if (!order) throw ApiError.notFound('Order not found');
  if (order.gateway !== 'paytm') throw ApiError.badRequest('This is not a Paytm order');
  const result = await settleWithPaytm(order);
  ok(res, { status: result.paid ? 'paid' : (result.pending ? 'pending' : 'failed'), message: result.message, activated: result.activated || null });
});

/* ---------------------------- course purchase ---------------------------- */

/**
 * POST /api/courses/:id/purchase — create an order to purchase one paid course.
 *
 * This was the missing piece: a course could have a price, but there was no way to charge for it,
 * so enrolment always proceeded free of charge.
 */
const courseCheckout = asyncHandler(async (req, res) => {
  const course = await q1(
    'SELECT id, title, slug, price, is_premium, status FROM courses WHERE id = ?',
    [Number(req.params.id) || 0],
  );
  if (!course) throw ApiError.notFound('Course not found');
  if (course.status !== 'published') throw ApiError.badRequest('This course has not been published yet');

  const amountPaise = Math.round(Number(course.price || 0) * 100);
  if (amountPaise <= 0) throw ApiError.badRequest('This course is free — enrol directly; no payment is required.');

  const already = await q1('SELECT id FROM enrollments WHERE course_id = ? AND user_id = ?', [course.id, req.user.id]);
  if (already) return ok(res, { activated: true, already: true, message: 'You are already enrolled in this course' });

  // Reuse an open order instead of piling up rows on every page refresh — but
  // only one for the SAME gateway. A half-finished UPI order must not get
  // picked up by the Paytm/demo path (it would then fail to verify). The
  // helper also cancels a stale-price order and prevents duplicate inserts
  // under concurrent clicks by serializing on the buyer row.
  const { gateway, cfg } = await resolveGateway(req.body.gateway);
  const { order, reused } = await findOrCreateOpenOrder({
    userId: req.user.id, kind: 'course', courseId: course.id, amountPaise, gateway,
  });

  const base = { id: order.id, amount_paise: amountPaise, course_title: course.title, reused };

  if (gateway === 'demo') {
    return ok(res, {
      activated: false, mode: 'demo', order: base,
      message: 'DEMO MODE: no payment gateway is configured — the payment will be simulated, followed by enrolment.',
    });
  }
  if (gateway === 'razorpay') {
    return ok(res, {
      activated: false, mode: 'razorpay', order: base,
      razorpay: await startRazorpay({ order, cfg, label: course.title }),
    });
  }
  ok(res, {
    activated: false, mode: 'paytm', order: base,
    paytm: await startPaytm({ order, req, cfg }),
  });
});

/** POST /api/courses/:id/purchase/verify — confirm a demo payment or re-query Paytm status. */
const courseVerify = asyncHandler(async (req, res) => {
  const order = await q1(
    "SELECT * FROM subscription_orders WHERE id = ? AND user_id = ? AND kind='course'",
    [Number(req.body.order_db_id) || 0, req.user.id],
  );
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status === 'paid') {
    return ok(res, { activated: true, already: true, enrollment: await q1('SELECT * FROM enrollments WHERE id = ?', [order.enrollment_id]) });
  }
  if (order.gateway === 'demo') {
    if (!demoPaymentsAllowed()) throw ApiError.serviceUnavailable('Demo payments are disabled in production.');
    const enrollment = await service.activateOrder(order);
    return ok(res, { activated: true, mode: 'demo', enrollment });
  }
  if (order.gateway === 'upi') throw ApiError.badRequest('A UPI course payment is activated after administrator review — check its status under My Plan/Payments.');
  if (!['razorpay', 'paytm'].includes(order.gateway)) throw ApiError.badRequest(`This ${order.gateway} order cannot be verified here`);
  const result = order.gateway === 'razorpay'
    ? await settleWithRazorpay(order, {
      paymentId: req.body.razorpay_payment_id, signature: req.body.razorpay_signature,
    })
    : await settleWithPaytm(order);
  if (!result.paid && result.pending) {
    return ok(res, { activated: false, pending: true, mode: order.gateway, message: result.message });
  }
  if (!result.paid) throw ApiError.badRequest(result.message);
  ok(res, { activated: true, mode: order.gateway, enrollment: result.activated });
});

/** POST /api/subscriptions/checkout {plan_id} — create an order or activate a free/manual plan. */
const checkout = asyncHandler(async (req, res) => {
  const planId = Number(req.body.plan_id) || 0;
  const plan = await q1("SELECT * FROM plans WHERE id = ? AND status = 'active'", [planId]);
  if (!plan) throw ApiError.notFound('Plan not found (it may have become inactive)');

  // ---- Free plan: no payment is required, but the trial may be claimed only once. ----
  if (Number(plan.price_paise) <= 0) {
    const { subscription, alreadyActive } = await service.claimFreePlan(req.user.id, plan);
    const payload = { activated: true, mode: 'free', subscription, already_active: alreadyActive };
    return alreadyActive ? ok(res, payload) : created(res, payload);
  }

  // ---- paid plan ----
  const { gateway, cfg } = await resolveGateway(req.body.gateway);
  const { order, reused } = await findOrCreateOpenOrder({
    userId: req.user.id, kind: 'subscription', planId: plan.id,
    amountPaise: Number(plan.price_paise), gateway,
  });

  const base = {
    id: order.id, amount_paise: Number(order.amount_paise), currency: 'INR', plan_name: plan.name, reused,
  };

  if (gateway === 'demo') {
    return ok(res, {
      activated: false, mode: 'demo', order: base,
      message: 'DEMO MODE: no payment gateway is configured — the payment will be simulated, followed by subscription activation.',
    });
  }
  if (gateway === 'razorpay') {
    return ok(res, {
      activated: false, mode: 'razorpay', order: base,
      razorpay: await startRazorpay({ order, cfg, label: plan.name }),
    });
  }
  ok(res, {
    activated: false, mode: 'paytm', order: base,
    paytm: await startPaytm({ order, req, cfg }),
  });
});

/** POST /api/subscriptions/verify — re-query Paytm status or confirm a demo payment. */
const verify = asyncHandler(async (req, res) => {
  const orderId = Number(req.body.order_db_id) || 0;
  const order = await q1("SELECT * FROM subscription_orders WHERE id = ? AND user_id = ? AND COALESCE(kind,'subscription') = 'subscription'", [orderId, req.user.id]);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status === 'paid') {
    const existing = await q1('SELECT * FROM subscriptions WHERE order_id = ? LIMIT 1', [order.id]);
    return ok(res, { activated: true, already: true, subscription: existing });
  }
  if (order.status !== 'created') throw ApiError.badRequest(`This order is already ${order.status} — start a new checkout`);

  // ---- Demo mode: the user confirmed, so mark the order paid and activate it. ----
  if (order.gateway === 'demo') {
    if (!demoPaymentsAllowed()) throw ApiError.serviceUnavailable('Demo payments are disabled in production.');
    const subscription = await service.activateOrder(order);
    return ok(res, { activated: true, mode: 'demo', subscription });
  }

  if (order.gateway === 'upi') throw ApiError.badRequest('A UPI payment is activated after administrator review — check its status under My Plan.');
  if (order.gateway === 'manual') throw ApiError.badRequest('A manual or free order cannot be verified here — use an administrator grant or free checkout.');
  if (!['razorpay', 'paytm'].includes(order.gateway)) throw ApiError.badRequest(`This ${order.gateway} order cannot be verified here`);

  // ---- Real gateway: never trust the client; confirm directly with the gateway. ----
  const result = order.gateway === 'razorpay'
    ? await settleWithRazorpay(order, {
      paymentId: req.body.razorpay_payment_id, signature: req.body.razorpay_signature,
    })
    : await settleWithPaytm(order);
  if (!result.paid && result.pending) {
    return ok(res, { activated: false, pending: true, mode: order.gateway, message: result.message });
  }
  if (!result.paid) throw ApiError.badRequest(result.message);
  ok(res, { activated: true, mode: order.gateway, subscription: result.activated });
});

/* --------------------------------- admin --------------------------------- */

/** GET /api/admin/plans — all plans with subscriber counts. */
const adminPlans = asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT p.*,
            (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id) AS total_subs,
            (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status='active' AND s.ends_at > UTC_TIMESTAMP()) AS active_subs
       FROM plans p ORDER BY p.sort_order, p.price_paise`,
  );
  ok(res, rows.map((p) => ({
    ...planSafe(p),
    total_subs: Number(p.total_subs), active_subs: Number(p.active_subs),
  })));
});

const validPlanBody = (b, { partial = false } = {}) => {
  const data = {};
  if (!partial || b.name !== undefined) {
    if (!String(b.name || '').trim()) throw ApiError.badRequest('A plan name is required');
    data.name = String(b.name).trim().slice(0, 80);
  }
  if (b.description !== undefined) data.description = String(b.description || '').slice(0, 500) || null;
  if (b.features !== undefined) {
    const f = Array.isArray(b.features) ? b.features : String(b.features || '').split('\n');
    data.features = JSON.stringify(f.map((x) => String(x).trim()).filter(Boolean).slice(0, 12));
  }
  if (b.price_paise !== undefined) {
    const n = Math.round(Number(b.price_paise));
    if (!Number.isFinite(n) || n < 0 || n > 10000000) throw ApiError.badRequest('price_paise must be between 0 and 10,000,000 (₹100,000)');
    data.price_paise = n;
  }
  if (b.duration_days !== undefined) {
    const n = Math.round(Number(b.duration_days));
    if (!Number.isFinite(n) || n < 1 || n > 3650) throw ApiError.badRequest('duration_days must be between 1 and 3650');
    data.duration_days = n;
  }
  if (b.highlight !== undefined) data.highlight = b.highlight ? 1 : 0;
  if (b.sort_order !== undefined) data.sort_order = Math.round(Number(b.sort_order) || 0);
  if (b.status !== undefined) {
    if (!['active', 'inactive'].includes(b.status)) throw ApiError.badRequest('status must be either active or inactive');
    data.status = b.status;
  }
  return data;
};

/** POST /api/admin/plans */
const createPlan = asyncHandler(async (req, res) => {
  const data = validPlanBody(req.body);
  const slugBase = slugify(data.name) || 'plan';
  let slug = slugBase;
  let suffix = 2;
  while (await q1('SELECT id FROM plans WHERE slug = ?', [slug])) { // eslint-disable-line no-await-in-loop
    slug = `${slugBase}-${suffix}`.slice(0, 110); suffix += 1;
  }
  const r = await exec(
    'INSERT INTO plans (name, slug, description, features, price_paise, duration_days, highlight, sort_order, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [data.name, slug, data.description || null, data.features || '[]', data.price_paise ?? 0,
      data.duration_days ?? 30, data.highlight || 0, data.sort_order ?? 0, data.status || 'active', req.user.id],
  );
  created(res, planSafe(await q1('SELECT * FROM plans WHERE id = ?', [r.insertId])));
});

/** PUT /api/admin/plans/:id */
const updatePlan = asyncHandler(async (req, res) => {
  const plan = await q1('SELECT id FROM plans WHERE id = ?', [req.params.id]);
  if (!plan) throw ApiError.notFound('Plan not found');
  const data = validPlanBody(req.body, { partial: true });
  const keys = Object.keys(data);
  if (!keys.length) throw ApiError.badRequest('Nothing to update');
  await exec(`UPDATE plans SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), plan.id]);
  ok(res, planSafe(await q1('SELECT * FROM plans WHERE id = ?', [plan.id])));
});

/** DELETE /api/admin/plans/:id — archive as inactive instead of deleting when subscribers exist. */
const removePlan = asyncHandler(async (req, res) => {
  const plan = await q1('SELECT * FROM plans WHERE id = ?', [req.params.id]);
  if (!plan) throw ApiError.notFound('Plan not found');
  const { c } = await q1(
    'SELECT (SELECT COUNT(*) FROM subscriptions WHERE plan_id = ?) + (SELECT COUNT(*) FROM subscription_orders WHERE plan_id = ?) AS c',
    [plan.id, plan.id],
  );
  if (Number(c) > 0) {
    await exec("UPDATE plans SET status='inactive' WHERE id = ?", [plan.id]);
    return ok(res, { archived: true, message: 'This plan has subscribers or orders, so it was made INACTIVE instead of being deleted; existing subscriptions remain safe.' });
  }
  await exec('DELETE FROM plans WHERE id = ?', [plan.id]);
  ok(res, { archived: false, deleted: true });
});

/** GET /api/admin/subscriptions — subscriptions for all users, with filters. */
const adminSubs = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  await service.expireOverdue();
  const where = ['1=1'], params = [];
  if (req.query.status && ['active', 'expired', 'cancelled'].includes(req.query.status)) { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.search) { where.push('(u.full_name LIKE ? OR u.email LIKE ? OR p.name LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const rows = await q(
    `SELECT s.id, s.status, s.starts_at, s.ends_at, s.created_at,
            u.id AS user_id, u.full_name, u.email, r.slug AS user_role,
            p.id AS plan_id, p.name AS plan_name, p.price_paise,
            o.gateway, o.amount_paise, o.gateway_payment_id
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN subscription_orders o ON o.id = s.order_id
      ${whereSql} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [{ total }] = await q(
    `SELECT COUNT(*) AS total FROM subscriptions s JOIN users u ON u.id = s.user_id JOIN plans p ON p.id = s.plan_id ${whereSql}`,
    params,
  );
  const summary = await q1(
    `SELECT COUNT(*) AS total_subs,
            SUM(s.status='active' AND s.ends_at > UTC_TIMESTAMP()) AS active_subs,
            COALESCE(SUM(CASE WHEN o.status='paid' THEN o.amount_paise ELSE 0 END),0) AS collected_paise
       FROM subscriptions s LEFT JOIN subscription_orders o ON o.id = s.order_id`,
  );
  ok(res, rows, {
    page, limit, total: Number(total),
    summary: {
      total_subs: Number(summary.total_subs || 0),
      active_subs: Number(summary.active_subs || 0),
      collected_rupees: Number(summary.collected_paise || 0) / 100,
    },
  });
});

/** POST /api/admin/subscriptions/grant {user_id|email, plan_id} — manual activation */
const grant = asyncHandler(async (req, res) => {
  const plan = await q1('SELECT * FROM plans WHERE id = ?', [Number(req.body.plan_id) || 0]);
  if (!plan) throw ApiError.notFound('Plan not found');
  let user = null;
  if (req.body.user_id) user = await q1('SELECT id, full_name, email FROM users WHERE id = ?', [Number(req.body.user_id)]);
  else if (req.body.email) user = await q1('SELECT id, full_name, email FROM users WHERE email = ?', [String(req.body.email).trim()]);
  if (!user) throw ApiError.notFound('User not found (check the email or user_id)');
  if (user.id === req.user.id) throw ApiError.badRequest('There is no need to grant a plan to yourself — subscription gating does not apply to administrators or the owner');

  const r = await exec(
    "INSERT INTO subscription_orders (user_id, kind, plan_id, amount_paise, gateway, status) VALUES (?,'subscription',?,0,'manual','created')",
    [user.id, plan.id],
  );
  const order = await q1('SELECT * FROM subscription_orders WHERE id = ?', [r.insertId]);
  const subscription = await service.activateOrder(order);
  try {
    await notify({
      userId: user.id, audience: 'user', type: 'system', link: '/subscription',
      title: `⭐ Your ${plan.name} plan is now active!`,
      message: `An administrator has granted you ${plan.name} for ${plan.duration_days} days. All ⭐ premium courses, quizzes, and coding problems are now unlocked.`,
    });
  } catch (notifyErr) {
    console.warn('[subscriptions] grant notification failed (non-fatal):', notifyErr.message);
  }
  created(res, { subscription, user: { id: user.id, full_name: user.full_name, email: user.email } });
});

module.exports = {
  plans, myStatus, checkout, verify,
  paytmCallback, paytmStatus, razorpayWebhook, courseCheckout, courseVerify,
  adminPlans, createPlan, updatePlan, removePlan, adminSubs, grant,
};
