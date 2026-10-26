'use strict';
/**
 * Subscriptions & premium gating service.
 *
 *  - plans            : admin-managed plans (price in paise, duration in days)
 *  - subscription_orders : payment record (razorpay | paytm | upi | demo | manual)
 *  - subscriptions    : activated membership windows
 *  - premium content  : courses/quizzes/coding_problems.is_premium flags
 *
 * When no gateway is configured, DEMO MODE is used: the payment is simulated and the
 * subscription is activated immediately (for local development on localhost).
 * As soon as keys are configured, real Razorpay/Paytm transactions and signature verification are used.
 */
const { q, q1, exec, tx } = require('../config/db');
const { ApiError } = require('../utils/helpers');

const DEFAULT_PLANS = [
  ['Free Starter', 'free-starter', 'Try premium features for 7 days — no card required.',
    JSON.stringify(['7-day premium trial', 'No card or payment required', 'Demo of premium courses and concepts']), 0, 7, 0, 1],
  ['Pro Monthly', 'pro-monthly', 'One month of full premium access — courses, quizzes, and coding problems.',
    JSON.stringify(['All ⭐ premium courses', 'Premium quizzes unlocked', 'Premium coding problems', 'Priority doubt support']), 19900, 30, 1, 2],
  ['Pro Max (6 months)', 'pro-max', 'Six months of premium access — the best value.',
    JSON.stringify(['All Pro benefits', 'Valid for 6 months', 'Lowest monthly cost']), 49900, 180, 0, 3],
];

/* --------------------------- schema management --------------------------- */

const DDL = [
  `CREATE TABLE IF NOT EXISTS plans (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     name VARCHAR(80) NOT NULL,
     slug VARCHAR(120) NOT NULL,
     description VARCHAR(500) DEFAULT NULL,
     features TEXT DEFAULT NULL,
     price_paise INT UNSIGNED NOT NULL DEFAULT 0,
     duration_days INT UNSIGNED NOT NULL DEFAULT 30,
     highlight TINYINT(1) NOT NULL DEFAULT 0,
     sort_order INT NOT NULL DEFAULT 0,
     status ENUM('active','inactive') NOT NULL DEFAULT 'active',
     created_by INT UNSIGNED DEFAULT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     UNIQUE KEY uq_plans_slug (slug)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS subscription_orders (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     user_id INT UNSIGNED NOT NULL,
     plan_id INT UNSIGNED NOT NULL,
     amount_paise INT UNSIGNED NOT NULL DEFAULT 0,
     currency VARCHAR(8) NOT NULL DEFAULT 'INR',
    gateway ENUM('razorpay','paytm','demo','manual','upi') NOT NULL DEFAULT 'demo',
    status ENUM('created','paid','failed','cancelled','pending_review') NOT NULL DEFAULT 'created',
    gateway_order_id VARCHAR(64) DEFAULT NULL,
    gateway_payment_id VARCHAR(64) DEFAULT NULL,
    subscription_id INT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME DEFAULT NULL,
    KEY ix_so_user (user_id),
    KEY ix_so_gw (gateway_order_id),
    CONSTRAINT fk_so_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_so_plan FOREIGN KEY (plan_id) REFERENCES plans(id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     user_id INT UNSIGNED NOT NULL,
     plan_id INT UNSIGNED NOT NULL,
     status ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
     starts_at DATETIME NOT NULL,
     ends_at DATETIME NOT NULL,
     order_id INT UNSIGNED DEFAULT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     KEY ix_sub_user (user_id, status, ends_at),
     CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
     CONSTRAINT fk_membership_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
     CONSTRAINT fk_membership_order FOREIGN KEY (order_id) REFERENCES subscription_orders(id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function ensureColumn(table, column, ddl) {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  if (!Number(row.c)) await exec(`ALTER TABLE \`${table}\` ${ddl}`);
}

/**
 * Idempotent upgrade — it runs at every startup and creates the plans/subscriptions
 * tables and is_premium columns even on an older database.
 */
/** Every payment gateway the orders table may reference. */
const GATEWAYS = ['razorpay', 'paytm', 'demo', 'manual', 'upi'];

/** Column exists? — used by the column-rename migration. */
async function hasColumn(table, column) {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  return Number(row.c) > 0;
}

/**
 * Normalises an older install's orders table:
 *   - the two gateway-specific columns get neutral names (data preserved), so
 *     one pair of columns serves Razorpay, Paytm and anything added later
 *   - the gateway enum is widened to every gateway we support
 *
 * Safe on every boot: each step is guarded and nothing is ever dropped.
 */
async function normalizeOrdersSchema() {
  const steps = [];
  // 1. rename the two gateway-specific columns to neutral names (keeps data)
  if (await hasColumn('subscription_orders', 'razorpay_order_id') && !(await hasColumn('subscription_orders', 'gateway_order_id'))) {
    await exec('ALTER TABLE subscription_orders CHANGE COLUMN razorpay_order_id gateway_order_id VARCHAR(64) DEFAULT NULL');
    steps.push('razorpay_order_id -> gateway_order_id');
  }
  if (await hasColumn('subscription_orders', 'razorpay_payment_id') && !(await hasColumn('subscription_orders', 'gateway_payment_id'))) {
    await exec('ALTER TABLE subscription_orders CHANGE COLUMN razorpay_payment_id gateway_payment_id VARCHAR(64) DEFAULT NULL');
    steps.push('razorpay_payment_id -> gateway_payment_id');
  }
  // 2. make sure every gateway we support is a legal enum value. Widening only
  //    — an install that already has rows keeps them exactly as they are.
  const col = await q1(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription_orders' AND COLUMN_NAME = 'gateway'`,
  );
  if (col) {
    const missing = GATEWAYS.filter((g) => !new RegExp(`'${g}'`).test(col.t));
    if (missing.length) {
      await exec(
        `ALTER TABLE subscription_orders MODIFY COLUMN gateway ENUM(${GATEWAYS.map((g) => `'${g}'`).join(',')}) NOT NULL DEFAULT 'demo'`,
      );
      steps.push(`gateway enum += ${missing.join(', ')}`);
    }
  }
  if (steps.length) console.log(`[billing] orders schema: ${steps.join('; ')}`);
  return steps;
}

/**
 * Orders started life as subscription-only. Courses can now be sold too, so an
 * order needs to say *what* it buys. plan_id becomes nullable for course orders.
 */
async function migrateOrdersForCourses() {
  const steps = [];
  if (!(await hasColumn('subscription_orders', 'kind'))) {
    await exec("ALTER TABLE subscription_orders ADD COLUMN kind ENUM('subscription','course') NOT NULL DEFAULT 'subscription' AFTER user_id");
    steps.push('+kind');
  }
  if (!(await hasColumn('subscription_orders', 'course_id'))) {
    await exec('ALTER TABLE subscription_orders ADD COLUMN course_id INT UNSIGNED DEFAULT NULL AFTER plan_id');
    steps.push('+course_id');
  }
  if (!(await hasColumn('subscription_orders', 'enrollment_id'))) {
    await exec('ALTER TABLE subscription_orders ADD COLUMN enrollment_id INT UNSIGNED DEFAULT NULL AFTER subscription_id');
    steps.push('+enrollment_id');
  }
  // plan_id must allow NULL for course orders
  const pc = await q1(
    `SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription_orders' AND COLUMN_NAME = 'plan_id'`,
  );
  if (pc && pc.n === 'NO') {
    await exec('ALTER TABLE subscription_orders MODIFY COLUMN plan_id INT UNSIGNED DEFAULT NULL');
    steps.push('plan_id nullable');
  }
  if (steps.length) console.log(`[billing] course orders: ${steps.join(', ')}`);
  return steps;
}

async function ensureSchema() {
  for (const stmt of DDL) await q(stmt); // eslint-disable-line no-await-in-loop
  await normalizeOrdersSchema();
  await migrateOrdersForCourses();
  await ensureColumn('courses', 'is_premium', 'ADD COLUMN is_premium TINYINT(1) NOT NULL DEFAULT 0 AFTER is_featured');
  await ensureColumn('quizzes', 'is_premium', 'ADD COLUMN is_premium TINYINT(1) NOT NULL DEFAULT 0 AFTER is_private');
  await ensureColumn('coding_problems', 'is_premium', 'ADD COLUMN is_premium TINYINT(1) NOT NULL DEFAULT 0 AFTER status');
  const { c } = await q1('SELECT COUNT(*) AS c FROM plans');
  if (!Number(c)) {
    for (const p of DEFAULT_PLANS) {
      await exec( // eslint-disable-line no-await-in-loop
        'INSERT INTO plans (name, slug, description, features, price_paise, duration_days, highlight, sort_order) VALUES (?,?,?,?,?,?,?,?)',
        p,
      );
    }
  }
}

/* --------------------------- membership helpers --------------------------- */

const expireOverdue = () => exec("UPDATE subscriptions SET status='expired' WHERE status='active' AND ends_at <= UTC_TIMESTAMP()");

/** The user's latest active subscription, including plan information, or null when none exists. */
async function getActiveSubscription(userId) {
  await expireOverdue();
  return q1(
    `SELECT s.id AS subscription_id, s.plan_id, s.status, s.starts_at, s.ends_at,
            p.name AS plan_name, p.slug AS plan_slug, p.price_paise, p.duration_days,
            TIMESTAMPDIFF(DAY, UTC_TIMESTAMP(), s.ends_at) AS days_left
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = ? AND s.status = 'active' AND s.starts_at <= UTC_TIMESTAMP() AND s.ends_at > UTC_TIMESTAMP()
      ORDER BY s.ends_at DESC LIMIT 1`,
    [userId],
  );
}

/** Staff (owner, administrators, and developers) and content creators always bypass this check; students need an active subscription. */
async function hasPremiumAccess(user) {
  if (!user) return false;
  if (['owner', 'admin', 'developer'].includes(user.role)) return true;
  return Boolean(await getActiveSubscription(user.id));
}

/** A 403 response with a machine-readable code that the frontend uses to display the upgrade interface. */
const premiumError = (label = 'content') => new ApiError(
  403,
  `⭐ This ${label} is PREMIUM content — an active subscription is required for access. Choose a plan on the pricing page, and it will unlock as soon as the plan is activated.`,
  { code: 'PREMIUM_REQUIRED' },
);

/**
 * Course order -> enrollment. Mirrors activateOrder() but for a one-off course
 * purchase: marks the order paid and creates (or reuses) the enrollment inside
 * one transaction, so a double callback can never double-enroll or double-charge.
 */
async function activateCourseOrder(order, { paymentId = null } = {}) {
  const course = await q1('SELECT id, title FROM courses WHERE id = ?', [order.course_id]);
  // The course was deleted while the payment remained pending. Tell the administrator that
  // approval can never succeed; the only path is to reject the payment and issue a refund.
  if (!course) {
    throw ApiError.badRequest(
      'The course for this payment has been deleted, so enrolment cannot be created. '
      + 'Reject the payment and refund the student manually.',
    );
  }
  const enrollmentId = await tx(async (conn) => {
    // Locking the order makes concurrent gateway callbacks idempotent; one
    // transaction either observes the completed activation or performs it.
    const [[locked]] = await conn.query(
      'SELECT * FROM subscription_orders WHERE id = ? FOR UPDATE',
      [order.id],
    );
    if (!locked || locked.kind !== 'course') throw ApiError.notFound('Course order not found');
    if (['failed', 'cancelled'].includes(locked.status)) {
      throw ApiError.badRequest(`This course order is ${locked.status} and cannot be activated`);
    }
    if (locked.enrollment_id) return locked.enrollment_id;

    await conn.query(
      'INSERT IGNORE INTO enrollments (course_id, user_id) VALUES (?,?)',
      [locked.course_id, locked.user_id],
    );
    const [[enrollment]] = await conn.query(
      'SELECT id FROM enrollments WHERE course_id = ? AND user_id = ? LIMIT 1',
      [locked.course_id, locked.user_id],
    );
    if (!enrollment) throw ApiError.badRequest('Enrollment could not be created for this course order');
    await conn.query(
      `UPDATE subscription_orders
          SET status='paid', paid_at=COALESCE(paid_at, UTC_TIMESTAMP()),
              gateway_payment_id = COALESCE(?, gateway_payment_id), enrollment_id = ?
        WHERE id = ?`,
      [paymentId, enrollment.id, locked.id],
    );
    await conn.query(
      'UPDATE courses SET total_students = (SELECT COUNT(*) FROM enrollments WHERE course_id = ?) WHERE id = ?',
      [locked.course_id, locked.course_id],
    );
    return enrollment.id;
  });
  return q1(
    `SELECT e.*, c.title, c.slug, c.thumbnail FROM enrollments e
       JOIN courses c ON c.id = e.course_id WHERE e.id = ?`,
    [enrollmentId],
  );
}

async function activateOrder(order, { paymentId = null } = {}) {
  if (order.kind === 'course') return activateCourseOrder(order, { paymentId });
  const plan = await q1('SELECT * FROM plans WHERE id = ?', [order.plan_id]);
  if (!plan) throw ApiError.notFound('Plan not found');
  const subId = await tx(async (conn) => {
    const [[locked]] = await conn.query(
      'SELECT * FROM subscription_orders WHERE id = ? FOR UPDATE',
      [order.id],
    );
    if (!locked || (locked.kind && locked.kind !== 'subscription')) {
      throw ApiError.notFound('Subscription order not found');
    }
    if (['failed', 'cancelled'].includes(locked.status)) {
      throw ApiError.badRequest(`This subscription order is ${locked.status} and cannot be activated`);
    }
    const [existing] = await conn.query(
      'SELECT id FROM subscriptions WHERE order_id = ? LIMIT 1',
      [locked.id],
    );
    if (existing.length) return existing[0].id;

    // Serialize renewals for one user, then queue the new period *after* the
    // current active period. Starting every renewal at NOW() silently stole
    // the days the customer had already paid for.
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [locked.user_id]);
    const [[nowRow]] = await conn.query('SELECT UTC_TIMESTAMP() AS now_utc');
    const [[latest]] = await conn.query(
      `SELECT ends_at FROM subscriptions
        WHERE user_id = ? AND status = 'active' AND ends_at > ?
        ORDER BY ends_at DESC LIMIT 1 FOR UPDATE`,
      [locked.user_id, nowRow.now_utc],
    );
    const startsAt = latest ? latest.ends_at : nowRow.now_utc;
    const [[windowRow]] = await conn.query(
      'SELECT DATE_ADD(?, INTERVAL ? DAY) AS ends_at',
      [startsAt, Number(plan.duration_days) || 30],
    );
    const [ins] = await conn.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, starts_at, ends_at, order_id)
       VALUES (?,?,'active',?,?,?)`,
      [locked.user_id, locked.plan_id, startsAt, windowRow.ends_at, locked.id],
    );
    await conn.query(
      `UPDATE subscription_orders
          SET status='paid', paid_at=COALESCE(paid_at, UTC_TIMESTAMP()),
              gateway_payment_id = COALESCE(?, gateway_payment_id), subscription_id = ?
        WHERE id = ?`,
      [paymentId, ins.insertId, locked.id],
    );
    return ins.insertId;
  });
  await expireOverdue();
  return q1(
    `SELECT s.*, p.name AS plan_name, p.slug AS plan_slug, p.duration_days,
            TIMESTAMPDIFF(DAY, UTC_TIMESTAMP(), s.ends_at) AS days_left
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = ?`,
    [subId],
  );
}

/**
 * Self-service ₹0 plans are trials, not an endlessly renewable premium bypass.
 * A user may claim each free plan once; administrators can still use the
 * explicit manual-grant flow when an exception is genuinely intended.
 */
async function claimFreePlan(userId, plan) {
  if (Number(plan.price_paise) > 0) throw ApiError.badRequest('This plan is not free');
  const outcome = await tx(async (conn) => {
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const [[active]] = await conn.query(
      `SELECT id FROM subscriptions
        WHERE user_id = ? AND status = 'active'
          AND starts_at <= UTC_TIMESTAMP() AND ends_at > UTC_TIMESTAMP()
        ORDER BY ends_at DESC LIMIT 1 FOR UPDATE`,
      [userId],
    );
    if (active) return { subscriptionId: active.id, alreadyActive: true };

    const [[used]] = await conn.query(
      'SELECT id FROM subscriptions WHERE user_id = ? AND plan_id = ? LIMIT 1',
      [userId, plan.id],
    );
    if (used) {
      throw ApiError.conflict('You have already used the free plan or trial — choose a paid plan to continue with premium access.');
    }

    const [orderResult] = await conn.query(
      "INSERT INTO subscription_orders (user_id, kind, plan_id, amount_paise, gateway, status) VALUES (?,'subscription',?,0,'manual','created')",
      [userId, plan.id],
    );
    const [subResult] = await conn.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, starts_at, ends_at, order_id)
       VALUES (?,?,'active',UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY),?)`,
      [userId, plan.id, Number(plan.duration_days) || 7, orderResult.insertId],
    );
    await conn.query(
      `UPDATE subscription_orders
          SET status='paid', paid_at=UTC_TIMESTAMP(), subscription_id = ?
        WHERE id = ?`,
      [subResult.insertId, orderResult.insertId],
    );
    return { subscriptionId: subResult.insertId, alreadyActive: false };
  });
  const subscription = await q1(
    `SELECT s.*, p.name AS plan_name, p.slug AS plan_slug, p.duration_days,
            TIMESTAMPDIFF(DAY, UTC_TIMESTAMP(), s.ends_at) AS days_left
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = ?`,
    [outcome.subscriptionId],
  );
  return { subscription, alreadyActive: outcome.alreadyActive };
}

module.exports = {
  ensureSchema,
  getActiveSubscription,
  hasPremiumAccess,
  premiumError,
  activateCourseOrder,
  GATEWAYS,
  activateOrder,
  claimFreePlan,
  expireOverdue,
};
