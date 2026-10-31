'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canReadCodingSubmission } = require('../../utils/submissionAccess');

test('a student may read only their own coding submission', () => {
  assert.equal(canReadCodingSubmission({ id: 7, role: 'student' }, 7), true);
  assert.equal(canReadCodingSubmission({ id: 7, role: 'student' }, 8), false);
});

test('admins and owners may read any coding submission', () => {
  assert.equal(canReadCodingSubmission({ id: 1, role: 'admin' }, 8), true);
  assert.equal(canReadCodingSubmission({ id: 2, role: 'owner' }, 8), true);
});

test('developers need the explicit view_submissions permission for others', () => {
  assert.equal(canReadCodingSubmission({ id: 3, role: 'developer', permissions: [] }, 8), false);
  assert.equal(canReadCodingSubmission({ id: 3, role: 'developer', permissions: ['view_submissions'] }, 8), true);
  assert.equal(canReadCodingSubmission({ id: 3, role: 'developer', permissions: ['create_problem'] }, 8), false);
  assert.equal(canReadCodingSubmission({ id: 3, role: 'developer', permissions: [] }, 3), true);
});

test('missing or malformed principals fail closed', () => {
  assert.equal(canReadCodingSubmission(null, 8), false);
  assert.equal(canReadCodingSubmission({ id: 3, role: 'developer', permissions: 'view_submissions' }, 8), false);
});
