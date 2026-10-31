'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesPaiseAmount } = require('../../utils/paymentAmount');

test('gateway amount must be present and match the expected integer paise exactly', () => {
  assert.equal(matchesPaiseAmount('125.50', 12550), true);
  assert.equal(matchesPaiseAmount('125.5', 12550), true);
  assert.equal(matchesPaiseAmount('125', 12500), true);
  assert.equal(matchesPaiseAmount('125.51', 12550), false);
  assert.equal(matchesPaiseAmount('125.500', 12550), false);
});

test('missing or malformed gateway amounts fail closed', () => {
  for (const value of [null, undefined, '', ' ', 'NaN', '1e2', '-1.00', true]) {
    assert.equal(matchesPaiseAmount(value, 10000), false, `unexpected match for ${String(value)}`);
  }
});

test('invalid expected paise totals fail closed', () => {
  assert.equal(matchesPaiseAmount('1.00', NaN), false);
  assert.equal(matchesPaiseAmount('1.00', 100.5), false);
});
