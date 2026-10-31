'use strict';

/** Compare a gateway-reported INR decimal amount to an integer paise order total. */
function matchesPaiseAmount(reportedAmount, expectedPaise) {
  if (reportedAmount === null || reportedAmount === undefined || typeof reportedAmount === 'boolean') return false;
  const text = String(reportedAmount).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return false;
  const expected = Number(expectedPaise);
  if (!Number.isSafeInteger(expected) || expected < 0) return false;
  const rupees = Number(match[1]);
  if (!Number.isSafeInteger(rupees)) return false;
  const paise = rupees * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise === expected;
}

module.exports = { matchesPaiseAmount };
