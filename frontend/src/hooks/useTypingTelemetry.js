import { useRef, useCallback } from 'react';

/**
 * Typing telemetry shared by the Coding Arena and the Live Quiz.
 *
 * WHY THIS EXISTS (see AI-DETECTION-AUDIT.md)
 * The two surfaces used to measure different things with the same name:
 *   • the arena counted CHARACTERS inserted (correct), while
 *   • the quiz counted KEYSTROKES and divided them by pasted CHARACTERS —
 *     mismatched units, so Monaco's auto-indent and auto-closing brackets
 *     silently inflated the paste share, and holding Backspace (counted as
 *     "typed") let a student dilute a real paste away.
 * One hook, one definition, both surfaces.
 *
 * It also records what the old version threw away:
 *   • blocked paste attempts — when the admin copy-paste block is ON a paste
 *     never lands, so the paste ratio was always 0 and the arena scored every
 *     student at zero. Trying to paste into a locked editor is itself signal.
 *   • keystroke rhythm — the one stream that still works when pasting is
 *     blocked AND when the student retypes from a chatbot on a second screen.
 *
 * Everything here is client-side and therefore forgeable; the server treats
 * it as evidence to show a human, never as proof.
 */

const MAX_INTERVALS = 4000;   // ring buffer — bounded memory on long papers
const IDLE_MS = 5000;         // gaps longer than this are "thinking", not typing
const FAST_MS = 30;           // faster than a human finger can repeat a key

export default function useTypingTelemetry(enabled = true) {
  const ref = useRef({
    typed: 0,
    pasted: 0,
    events: 0,
    blocked: 0,
    keystrokes: 0,
    typingMs: 0,
    fast: 0,
    intervals: [],
    last: 0,
    prev: '',       // last known editor content, for character deltas
  });

  /** Characters that appeared in the document by ordinary typing. */
  const noteInsert = useCallback((count) => {
    if (!enabled || !count || count <= 0) return;
    ref.current.typed += count;
  }, [enabled]);

  /**
   * Characters that actually landed via paste or drop. They were optimistically
   * booked as typed by the content-delta watcher, so take them back.
   */
  const notePaste = useCallback((count) => {
    if (!enabled || !count || count <= 0) return;
    const s = ref.current;
    s.pasted += count;
    s.typed = Math.max(0, s.typed - count);
    if (count >= 20) s.events += 1;
  }, [enabled]);

  /** A paste/drop the copy-paste block cancelled — nothing landed, but intent did. */
  const noteBlockedPaste = useCallback(() => {
    if (!enabled) return;
    ref.current.blocked += 1;
  }, [enabled]);

  /** One key press, for rhythm analysis. Call on printable keys only. */
  const noteKey = useCallback(() => {
    if (!enabled) return;
    const s = ref.current;
    const now = Date.now();
    s.keystrokes += 1;
    if (s.last) {
      const gap = now - s.last;
      if (gap > 0 && gap < IDLE_MS) {
        s.typingMs += gap;
        if (gap < FAST_MS) s.fast += 1;
        if (s.intervals.length < MAX_INTERVALS) s.intervals.push(gap);
        else s.intervals[Math.floor(Math.random() * MAX_INTERVALS)] = gap; // reservoir
      }
    }
    s.last = now;
  }, [enabled]);

  /**
   * Re-baseline the content watcher after a programmatic change (Reset,
   * language switch, loading a saved draft) so the next real keystroke is not
   * measured against stale content and booked as a giant paste.
   */
  const rebase = useCallback((value) => {
    ref.current.prev = String(value ?? '');
  }, []);

  /**
   * Feed the editor's current content; the positive delta counts as typing.
   * Pastes are subtracted again by notePaste, which the editor fires first.
   */
  const noteContent = useCallback((value) => {
    const s = ref.current;
    const next = String(value ?? '');
    const delta = next.length - s.prev.length;
    s.prev = next;
    if (enabled && delta > 0) s.typed += delta;
  }, [enabled]);

  /** Payload for the submit request. */
  const snapshot = useCallback(() => {
    const s = ref.current;
    const iv = s.intervals;
    let uniform = 0;
    if (iv.length >= 25) {
      const sorted = [...iv].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 0;
      if (median > 0) {
        const lo = median * 0.85;
        const hi = median * 1.15;
        uniform = iv.filter((g) => g >= lo && g <= hi).length / iv.length;
      }
    }
    return {
      typed_chars: Math.round(s.typed),
      pasted_chars: Math.round(s.pasted),
      paste_events: s.events,
      blocked_pastes: s.blocked,
      keystrokes: s.keystrokes,
      typing_ms: Math.round(s.typingMs),
      fast_intervals: s.fast,
      uniform_ratio: Number(uniform.toFixed(3)),
    };
  }, []);

  return { noteInsert, notePaste, noteBlockedPaste, noteKey, noteContent, rebase, snapshot, ref };
}
