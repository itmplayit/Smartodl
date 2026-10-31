'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-media-tickets';

const { signMediaTicket, verifyMediaTicket, ttlSeconds } = require('../../utils/mediaToken');
const lessonMedia = require('../../services/lessonMedia.service');
const { hasValidVideoSignature, hasValidNoteSignature } = require('../../middleware/upload');

test('media ticket round-trips for the same lesson, user and kind', () => {
  const ticket = signMediaTicket({ lessonId: 7, userId: 3, kind: 'video' });
  const verified = verifyMediaTicket(ticket, { kind: 'video' });
  assert.equal(verified.lessonId, 7);
  assert.equal(verified.userId, 3);
  assert.equal(verified.kind, 'video');
});

test('a ticket cannot be reused for the other media kind', () => {
  const ticket = signMediaTicket({ lessonId: 7, userId: 3, kind: 'video' });
  assert.equal(verifyMediaTicket(ticket, { kind: 'pdf' }), null);
});

test('a tampered or unsigned ticket is refused', () => {
  const ticket = signMediaTicket({ lessonId: 7, userId: 3, kind: 'video' });
  const [payload, mac] = ticket.split('.');
  assert.equal(verifyMediaTicket(`${payload}.${mac.slice(0, -1)}x`, { kind: 'video' }), null);
  assert.equal(verifyMediaTicket('not-a-ticket', { kind: 'video' }), null);
  assert.equal(verifyMediaTicket('', { kind: 'video' }), null);
  assert.equal(verifyMediaTicket(null, { kind: 'video' }), null);
  // payload swapped to another lesson keeps the old signature → must fail
  const forgedPayload = Buffer.from(JSON.stringify({ l: 8, u: 3, k: 'video', e: 9999999999 }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(verifyMediaTicket(`${forgedPayload}.${mac}`, { kind: 'video' }), null);
});

test('an expired ticket is refused, and ttl is clamped to something sane', () => {
  const issued = Date.now() - 10 * 60 * 1000; // ten minutes ago
  const ticket = signMediaTicket({ lessonId: 7, userId: 3, kind: 'pdf', ttl: 300, now: issued });
  assert.equal(verifyMediaTicket(ticket, { kind: 'pdf' }), null);
  assert.ok(ttlSeconds() >= 30 && ttlSeconds() <= 3600);
  assert.equal(ttlSeconds(1), 300); // too small → default, never a 1s ticket
  assert.equal(ttlSeconds(999999), 3600); // too large → capped
});

test('lesson media paths cannot escape their directory', () => {
  assert.equal(lessonMedia.resolveStoredPath('../../.env'), null);
  // A leading slash is stripped, so an absolute-looking path cannot escape:
  // it just resolves to a (non-existent) file inside the media directory.
  const absolute = lessonMedia.resolveStoredPath('/etc/passwd');
  assert.ok(absolute === null || absolute.startsWith(lessonMedia.ROOT + path.sep));
  assert.equal(lessonMedia.resolveStoredPath(''), null);
  const inside = lessonMedia.resolveStoredPath('12/video-1234.mp4');
  assert.ok(inside && inside.startsWith(lessonMedia.ROOT + path.sep));
});

test('mime types and stored names are safe', () => {
  assert.equal(lessonMedia.mimeFor('a/b.mp4'), 'video/mp4');
  assert.equal(lessonMedia.mimeFor('a/b.webm'), 'video/webm');
  assert.equal(lessonMedia.mimeFor('a/b.pdf'), 'application/pdf');
  assert.equal(lessonMedia.mimeFor('a/b.exe'), 'application/octet-stream');
  assert.equal(lessonMedia.sanitizeName('../../evil name.mp4'), '..-..-evil name.mp4');
  assert.equal(lessonMedia.sanitizeName(''), 'file');
});

test('describeMedia never leaks a filesystem path', () => {
  const described = lessonMedia.describeMedia({
    video_path: '12/lecture-1.mp4', video_name: 'lecture 1.mp4', pdf_path: '12/notes.pdf', pdf_name: 'notes.pdf',
  });
  assert.equal(described.video_upload.name, 'lecture 1.mp4');
  assert.equal(described.video_upload.mime, 'video/mp4');
  assert.equal(described.pdf_upload.mime, 'application/pdf');
  assert.equal(JSON.stringify(described).includes('12/'), false);
  assert.deepEqual(lessonMedia.describeMedia({}), { video_upload: null, pdf_upload: null });
});

test('video signature check rejects a renamed non-video file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-media-'));
  const write = (name, bytes) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.from(bytes));
    return { path: file, originalname: name };
  };
  // minimal MP4 header: size + 'ftyp' + brand
  const mp4 = write('ok.mp4', [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const webm = write('ok.webm', [0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  const ogg = write('ok.ogv', [...Buffer.from('OggS'), 0, 2, 0, 0, 0, 0, 0]);
  const fake = write('fake.mp4', [...Buffer.from('<?php echo 1; ?>'), 0, 0, 0, 0]);

  assert.equal(await hasValidVideoSignature(mp4), true);
  assert.equal(await hasValidVideoSignature(webm), true);
  assert.equal(await hasValidVideoSignature(ogg), true);
  assert.equal(await hasValidVideoSignature(fake), false);

  // the PDF guard used for lesson attachments
  const pdf = write('notes.pdf', [...Buffer.from('%PDF-1.7\n'), 10, 20]);
  const notPdf = write('notes2.pdf', [...Buffer.from('GIF89a')]);
  assert.equal(await hasValidNoteSignature(pdf), true);
  assert.equal(await hasValidNoteSignature(notPdf), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
