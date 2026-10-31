import { tokens } from '../services/api';
import { IS_EMBEDDED_PREVIEW } from './preview-compat';

/**
 * Realtime events over a fetch-based SSE stream. Fetch is used instead of
 * EventSource so the access token stays in the Authorization header rather
 * than leaking through URLs, browser history, proxy logs, or referrers.
 */
let controller = null;
let retryTimer = null;
let failures = 0;
const EVENTS = new Set([
  'notification', 'live_quiz', 'submission_judged', 'settings_changed',
  'proctor_signal', 'proctor_warning', 'proctor_recording_request', 'proctor_recording_stop',
]);

function dispatchFrame(frame) {
  let type = 'message';
  const data = [];
  frame.split('\n').forEach((line) => {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  });
  if (!EVENTS.has(type) || !data.length) return;
  try {
    window.dispatchEvent(new CustomEvent(`smartodl:${type}`, { detail: JSON.parse(data.join('\n')) }));
  } catch (_) { /* ignore malformed or incomplete frames */ }
}

async function openStream(signal, token) {
  const response = await fetch('/api/events/stream', {
    method: 'GET',
    headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Realtime stream failed (${response.status})`);
  failures = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) {
      if (!signal.aborted) throw new Error('Realtime stream closed');
      break;
    }
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (frame && !frame.startsWith(':')) dispatchFrame(frame);
    }
  }
}

export function connectRealtime({ resetFailures = true } = {}) {
  if (typeof window === 'undefined' || typeof fetch === 'undefined' || IS_EMBEDDED_PREVIEW) return;
  const token = tokens.access();
  if (!token) return;
  if (resetFailures) failures = 0;
  disconnectRealtime();
  controller = new AbortController();
  const active = controller;
  openStream(active.signal, token).catch(() => {
    if (active.signal.aborted) return;
    controller = null;
    failures += 1;
    clearTimeout(retryTimer);
    // Never give up permanently: AuthContext may restore a token later, and
    // realtime should return with it. Backoff caps the request rate.
    const delay = Math.min(60000, 5000 * (2 ** Math.min(failures - 1, 4)));
    retryTimer = setTimeout(() => connectRealtime({ resetFailures: false }), delay);
  });
}

export function disconnectRealtime() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (controller) controller.abort();
  controller = null;
}
