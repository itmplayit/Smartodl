'use strict';
/** UPI Direct: student-facing payment intent + UTR submission, and admin review. */
const { q, q1, exec, tx } = require('../config/db');
const { asyncHandler, ok, created, ApiError, parsePagination } = require('../utils/helpers');
const upi = require('../services/upi.service');
const subs = require('../services/subscription.service');
const qrcode = require('../utils/qrcode');
const events = require('../services/events.service');

/** Everything the payment screen needs for one order. */
async function paymentPayload(order, item, cfg) {
  const reference = order.upi_reference || upi.makeReference(order.id);
  const label = item.name || item.title || 'Payment';
  const uri = upi.buildUri({
    vpa: cfg.vpa,
    payee: cfg.payee,
    amountPaise: Number(order.amount_paise),
    reference,
    note: `${label} ${reference}`,
  });
  return {
    order_id: order.id,
    reference,
    kind: order.kind || 'subscription',
    amount_paise: Number(order.amount_paise),
    amount: (Number(order.amount_paise) / 100).toFixed(2),
    plan_name: label,
    item_name: label,
    vpa: cfg.vpa,
    payee: cfg.payee,
    uri,
    qr_svg: qrcode.toSvg(uri, { scale: 6, level: 'M' }),
    instructions: cfg.instructions,
    require_utr: cfg.requireUtr,
    auto_approve: cfg.autoApprove,
    status: order.status,
  };
}

/* ------------------------------- student ------------------------------- */

/** GET /api/subscriptions/upi/config — is UPI offered at checkout? */
const publicConfig = asyncHandler(async (req, res) => {
  const cfg = await upi.config();
  ok(res, { enabled: cfg.enabled, payee: cfg.enabled ? cfg.payee : null, instructions: cfg.enabled ? cfg.instructions : '' });
});

/** POST /api/subscriptions/upi/checkout {plan_id} — mint a UPI order + QR. */
const checkout = asyncHandler(async (req, res) => {
  const cfg = await upi.config({ force: true });
  if (!cfg.enabled) throw ApiError.badRequest('UPI payments are not enabled — ask the administrator to set a UPI ID in Website Settings');

  // One endpoint serves two cases: a subscription plan or one paid course.
  const courseId = Number(req.body.course_id) || 0;
  let item; let amountPaise; let kind; let planId = null; let cid = null;

  if (courseId) {
    if (req.user.role !== 'student') throw ApiError.forbidden('A course purchase can be made only from a student account');
    item = await q1('SELECT id, title, price, status FROM courses WHERE id = ?', [courseId]);
    if (!item) throw ApiError.notFound('Course not found');
    if (item.status !== 'published') throw ApiError.badRequest('This course has not been published yet');
    amountPaise = Math.round(Number(item.price || 0) * 100);
    if (amountPaise <= 0) throw ApiError.badRequest('This course is free — enrol directly');
    const already = await q1('SELECT id FROM enrollments WHERE course_id = ? AND user_id = ?', [courseId, req.user.id]);
    if (already) throw ApiError.badRequest('You are already enrolled in this course');
    kind = 'course'; cid = courseId;
  } else {
    if (!['student', 'developer'].includes(req.user.role)) throw ApiError.forbidden('Subscription checkout is not available for this account');
    item = await q1("SELECT * FROM plans WHERE id = ? AND status = 'active'", [Number(req.body.plan_id) || 0]);
    if (!item) throw ApiError.notFound('Plan not found (it may have become inactive)');
    if (Number(item.price_paise) <= 0) throw ApiError.badRequest('This plan is free — use the normal checkout');
    amountPaise = Number(item.price_paise);
    kind = 'subscription'; planId = item.id;
  }

  // One open UPI order per item: re-show it instead of spawning duplicates the
  // admin would then have to reconcile by hand. Serialize on the buyer row so
  // parallel clicks cannot both pass the "no open order" check. A created (not
  // yet UTR-submitted) order is refreshed if the item price changed; a
  // pending-review claim keeps the amount the student actually says they paid.
  const outcome = await tx(async (conn) => {
    const [[user]] = await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    if (!user) throw ApiError.notFound('User not found');
    const [[openOrder]] = await conn.query(
      `SELECT * FROM subscription_orders
        WHERE user_id = ? AND kind = ? AND COALESCE(plan_id,0) = ? AND COALESCE(course_id,0) = ?
          AND gateway = 'upi' AND status IN ('created','pending_review')
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [req.user.id, kind, planId || 0, cid || 0],
    );
    if (openOrder && (Number(openOrder.amount_paise) === Number(amountPaise)
        || openOrder.status === 'pending_review')) {
      return { order: openOrder, reused: true };
    }
    if (openOrder) {
      await conn.query(
        "UPDATE subscription_orders SET status='cancelled' WHERE id = ? AND status='created'",
        [openOrder.id],
      );
    }
    const [result] = await conn.execute(
      "INSERT INTO subscription_orders (user_id, kind, plan_id, course_id, amount_paise, gateway, status) VALUES (?,?,?,?,?,'upi','created')",
      [req.user.id, kind, planId, cid, amountPaise],
    );
    const reference = upi.makeReference(result.insertId);
    await conn.query(
      'UPDATE subscription_orders SET upi_reference = ? WHERE id = ?',
      [reference, result.insertId],
    );
    const [[order]] = await conn.query(
      'SELECT * FROM subscription_orders WHERE id = ?',
      [result.insertId],
    );
    return { order, reused: false };
  });
  const payload = { reused: outcome.reused, payment: await paymentPayload(outcome.order, item, cfg) };
  return outcome.reused ? ok(res, payload) : created(res, payload);
});

/** POST /api/subscriptions/upi/:id/submit {utr, payer_vpa} — "I have paid". */
const submit = asyncHandler(async (req, res) => {
  const cfg = await upi.config();
  const utr = String(req.body.utr || '').trim().toUpperCase();
  const payerVpa = String(req.body.payer_vpa || '').trim();
  if (cfg.requireUtr && !utr) throw ApiError.badRequest('A UTR or reference number is required');
  if (utr && !upi.isValidUtr(utr)) throw ApiError.badRequest('The UTR must contain 8–24 letters or digits — copy it from the payment receipt');
  if (payerVpa && !upi.isValidVpa(payerVpa)) throw ApiError.badRequest('The payer UPI ID is not in a valid format (for example, name@bank)');

  let order;
  try {
    order = await tx(async (conn) => {
      const [[locked]] = await conn.query(
        "SELECT * FROM subscription_orders WHERE id = ? AND gateway = 'upi' FOR UPDATE",
        [req.params.id],
      );
      if (!locked) throw ApiError.notFound('UPI order not found');
      if (Number(locked.user_id) !== Number(req.user.id)) throw ApiError.forbidden('This order does not belong to you');
      if (locked.status === 'paid') throw ApiError.badRequest('This payment has already been approved');
      if (locked.status !== 'created') throw ApiError.badRequest(`This order is in the ${locked.status} state — start a new checkout`);

      if (utr) {
        const [[clash]] = await conn.query(
          `SELECT id FROM subscription_orders
            WHERE UPPER(COALESCE(upi_utr, '')) = ? AND id <> ?
              AND status IN ('paid','pending_review') LIMIT 1`,
          [utr, locked.id],
        );
        if (clash) throw ApiError.conflict('This UTR has already been used for another payment');
      }
      await conn.execute(
        `UPDATE subscription_orders
            SET upi_utr = ?, upi_payer_vpa = ?, upi_submitted_at = NOW(),
                status = 'pending_review'
          WHERE id = ? AND status = 'created'`,
        [utr || null, payerVpa || null, locked.id],
      );
      const [[fresh]] = await conn.query(
        'SELECT * FROM subscription_orders WHERE id = ?',
        [locked.id],
      );
      return fresh;
    });
  } catch (error) {
    // The generated-column unique index is the final race guard if two
    // submissions pass the clash SELECT simultaneously.
    if (error && error.code === 'ER_DUP_ENTRY') {
      throw ApiError.conflict('This UTR has already been used for another payment');
    }
    throw error;
  }

  if (cfg.autoApprove) {
    const subscription = await subs.activateOrder(order, { paymentId: utr || null });
    await exec("UPDATE subscription_orders SET upi_reviewed_at = NOW(), upi_review_note = 'auto-approved' WHERE id = ?", [order.id]);
    events.publish('subscription_changed', { user_id: order.user_id, order_id: order.id });
    return ok(res, { activated: true, auto_approved: true, subscription });
  }

  events.publish('upi_payment_submitted', { order_id: order.id, user_id: order.user_id });
  ok(res, {
    activated: false,
    auto_approved: false,
    status: 'pending_review',
    message: order.kind === 'course'
      ? 'Payment details received — enrolment in the course will be completed as soon as an administrator verifies them.'
      : 'Payment details received — your plan will be activated as soon as an administrator verifies them.',
  });
});

/** GET /api/subscriptions/upi/mine — the student's own UPI orders. */
const mine = asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT o.id, o.amount_paise, o.status, o.upi_reference, o.upi_utr, o.upi_submitted_at,
            o.upi_reviewed_at, o.upi_review_note, o.created_at,
            COALESCE(p.name, c.title) AS plan_name, o.kind
       FROM subscription_orders o
       LEFT JOIN plans p ON p.id = o.plan_id
       LEFT JOIN courses c ON c.id = o.course_id
      WHERE o.user_id = ? AND o.gateway = 'upi' ORDER BY o.id DESC LIMIT 20`,
    [req.user.id],
  );
  ok(res, rows);
});

/* -------------------------------- admin -------------------------------- */

/** GET /api/admin/upi-payments?status=pending_review */
const adminList = asyncHandler(async (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  // This screen previously showed only UPI, so course sales through Razorpay, Paytm, or demo mode
  // were not visible to administrators anywhere. It now has a gateway filter
  // whose default is 'all', making this the complete payments ledger.
  const gateway = String(req.query.gateway || 'all').trim();
  // Scope means gateway plus kind. Status and search are not part of it because the counter
  // tiles above display the status breakdown for exactly this scope.
  const scope = [];
  const scopeParams = [];
  if (gateway && gateway !== 'all') {
    if (!subs.GATEWAYS.includes(gateway)) throw ApiError.badRequest(`Unknown gateway: ${gateway}`);
    scope.push('o.gateway = ?');
    scopeParams.push(gateway);
  }
  const kind = String(req.query.kind || '').trim();
  if (kind && kind !== 'all') {
    if (!['subscription', 'course'].includes(kind)) throw ApiError.badRequest(`Unknown kind: ${kind}`);
    scope.push('o.kind = ?');
    scopeParams.push(kind);
  }
  const where = [...scope];
  const params = [...scopeParams];
  const status = String(req.query.status || '').trim();
  if (status && status !== 'all') { where.push('o.status = ?'); params.push(status); }
  if (req.query.q) {
    where.push('(o.upi_utr LIKE ? OR o.upi_reference LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await q(
    `SELECT o.*, u.full_name, u.email, COALESCE(p.name, c.title) AS plan_name, p.duration_days,
            r.full_name AS reviewed_by_name
       FROM subscription_orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN plans p ON p.id = o.plan_id
       LEFT JOIN courses c ON c.id = o.course_id
       LEFT JOIN users r ON r.id = o.upi_reviewed_by
       ${whereSql} ORDER BY (o.status = 'pending_review') DESC, o.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [{ total }] = await q(
    `SELECT COUNT(*) AS total FROM subscription_orders o JOIN users u ON u.id = o.user_id ${whereSql}`,
    params,
  );
  const [counts] = await q(
    `SELECT SUM(status = 'pending_review') AS pending, SUM(status = 'paid') AS paid,
            SUM(status = 'failed') AS rejected, SUM(status = 'created') AS awaiting,
            COALESCE(SUM(IF(status = 'paid', amount_paise, 0)), 0) AS paid_paise
       FROM subscription_orders o ${scope.length ? `WHERE ${scope.join(' AND ')}` : ''}`,
    scopeParams,
  );
  ok(res, {
    rows,
    counts: {
      pending: Number(counts.pending || 0),
      paid: Number(counts.paid || 0),
      rejected: Number(counts.rejected || 0),
      awaiting: Number(counts.awaiting || 0),
      paid_paise: Number(counts.paid_paise || 0),
    },
  }, { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) });
});

/** POST /api/admin/upi-payments/:id/approve — money seen in the account. */
const approve = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId < 1) throw ApiError.badRequest('Invalid UPI payment id');
  const note = String(req.body?.note || '').trim().slice(0, 255);
  if (!note) {
    throw ApiError.badRequest('A verification note is required for approval so that an audit trail is preserved');
  }
  const order = await q1("SELECT * FROM subscription_orders WHERE id = ? AND gateway = 'upi'", [orderId]);
  if (!order) throw ApiError.notFound('UPI payment not found');
  if (order.status === 'paid') throw ApiError.badRequest('This payment has already been approved');
  // A `created` order is only an abandoned/unfinished checkout: the student
  // has not yet claimed that they paid. Approving it would grant paid access
  // with no submitted UTR/payment evidence at all, so approval is limited to
  // the explicit `pending_review` state created by the submit endpoint.
  if (order.status !== 'pending_review') {
    throw ApiError.badRequest(
      order.status === 'created'
        ? 'The student has not submitted payment details yet, so this order cannot be approved'
        : `This order cannot be approved because it is currently in the ${order.status} state`,
    );
  }
  const activated = await subs.activateOrder(order, { paymentId: order.upi_utr || null });
  const reviewed = await exec(
    `UPDATE subscription_orders
        SET upi_reviewed_by = ?, upi_reviewed_at = NOW(), upi_review_note = ?
      WHERE id = ? AND status = 'paid'`,
    [req.user.id, note, order.id],
  );
  if (Number(reviewed.affectedRows) !== 1) {
    throw ApiError.conflict('The payment was activated, but the review record could not be saved — refresh the list and verify it');
  }
  events.publish('subscription_changed', { user_id: order.user_id, order_id: order.id });
  ok(res, order.kind === 'course'
    ? { approved: true, kind: 'course', enrollment: activated }
    : { approved: true, kind: 'subscription', subscription: activated });
});

/** POST /api/admin/upi-payments/:id/reject {note} */
const reject = asyncHandler(async (req, res) => {
  const order = await q1("SELECT * FROM subscription_orders WHERE id = ? AND gateway = 'upi'", [req.params.id]);
  if (!order) throw ApiError.notFound('UPI payment not found');
  if (order.status === 'paid') throw ApiError.badRequest('An approved payment cannot be rejected — cancel the subscription first');
  const note = String(req.body.note || '').trim().slice(0, 255);
  if (!note) throw ApiError.badRequest('A rejection reason is required and will be shown to the student');
  const result = await exec(
    `UPDATE subscription_orders
        SET status = 'failed', upi_reviewed_by = ?, upi_reviewed_at = NOW(), upi_review_note = ?
      WHERE id = ? AND status IN ('created','pending_review')`,
    [req.user.id, note, order.id],
  );
  if (Number(result.affectedRows) !== 1) {
    const fresh = await q1('SELECT status FROM subscription_orders WHERE id = ?', [order.id]);
    throw ApiError.conflict(`The payment is now in the ${fresh ? fresh.status : 'missing'} state — the rejection was stopped to prevent a race; refresh the list.`);
  }
  ok(res, { rejected: true });
});

/** GET /api/admin/upi-payments/preview — QR preview for the settings screen. */
/**
 * Admin "does my QR work?" preview.
 *
 * A missing UPI ID is a SETUP state, not an error: the admin page loads this on
 * mount, so throwing 400 painted a red error on a freshly installed site. It now
 * answers 200 with `configured: false` and a sentence to show in a neutral panel;
 * a genuinely broken configuration (bad VPA format) still fails loudly.
 */
const adminPreview = asyncHandler(async (req, res) => {
  const cfg = await upi.config({ force: true });
  if (!cfg.configured) {
    return ok(res, {
      ...cfg,
      configured: false,
      uri: null,
      qr_svg: null,
      message: 'Set a valid UPI ID in Website Settings (for example, college@okicici) to see the payment QR here.',
    });
  }
  const uri = upi.buildUri({ vpa: cfg.vpa, payee: cfg.payee, amountPaise: 100, reference: 'SODLTEST', note: 'Test payment' });
  ok(res, { ...cfg, configured: true, uri, qr_svg: qrcode.toSvg(uri, { scale: 6, level: 'M' }) });
});

module.exports = { publicConfig, checkout, submit, mine, adminList, approve, reject, adminPreview };
