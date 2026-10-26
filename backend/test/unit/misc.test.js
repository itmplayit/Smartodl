'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const qrcode = require('../../utils/qrcode');
const { buildXlsx } = require('../../utils/xlsx');
const { buildQuestionOrder } = require('../../utils/quiz-question-order');

test('QR svg never embeds raw input (it is injected with dangerouslySetInnerHTML)', () => {
  const svg = qrcode.toSvg('upi://pay?pa=<script>alert(1)</script>', { scale: 2 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(!svg.includes('<script'), 'raw payload leaked into svg');
  assert.ok(!svg.includes('alert'), 'raw payload leaked into svg');
});

test('buildXlsx produces a zip (PK) buffer', () => {
  const buf = buildXlsx({
    sheets: [{ name: 'S', columns: [{ header: 'A', width: 10 }], rows: [[{ value: 'x' }]] }],
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
});

test('live question order: first N seats are position-disjoint and stable', () => {
  const questions = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  const opts = { shuffle: true, live: true, quizId: 9, sessionSeed: 's1' };
  const papers = [1, 2, 3, 4, 5].map((seat) => buildQuestionOrder(questions, { ...opts, seatNumber: seat }).questions.map((q) => q.id));
  for (let pos = 0; pos < 5; pos += 1) {
    assert.equal(new Set(papers.map((p) => p[pos])).size, 5, `position ${pos} collides`);
  }
  const again = buildQuestionOrder(questions, { ...opts, seatNumber: 3 }).questions.map((q) => q.id);
  assert.deepEqual(again, papers[2]);
});
