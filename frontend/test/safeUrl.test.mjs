import test from 'node:test';
import assert from 'node:assert/strict';
import { safeExternalHref } from '../src/utils/safeUrl.js';

test('allows http(s) and same-origin paths', () => {
  assert.equal(safeExternalHref('https://example.com/page'), 'https://example.com/page');
  assert.equal(safeExternalHref('http://example.com'), 'http://example.com/');
  assert.equal(safeExternalHref('/courses/3'), '/courses/3');
});

test('rejects scriptable schemes, protocol-relative and credentialled URLs', () => {
  assert.equal(safeExternalHref('javascript:alert(1)'), null);
  assert.equal(safeExternalHref('data:text/html,<script>1</script>'), null);
  assert.equal(safeExternalHref('//evil.example.com/x'), null);
  assert.equal(safeExternalHref('/\\evil.example.com/x'), null);
  assert.equal(safeExternalHref('https://user:pass@example.com/'), null);
  assert.equal(safeExternalHref('ftp://example.com/file'), null);
});

test('rejects empty/non-string input', () => {
  assert.equal(safeExternalHref(''), null);
  assert.equal(safeExternalHref('   '), null);
  assert.equal(safeExternalHref(null), null);
  assert.equal(safeExternalHref(42), null);
  assert.equal(safeExternalHref('not a url'), null);
});
