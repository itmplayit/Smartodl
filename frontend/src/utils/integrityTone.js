/**
 * integrityTone.js — integrity "review band" ka ek hi colour source.
 *
 * Backend (`utils/integrityBand.js`) `tone` bhejta hai: `green` | `yellow` | `red` | `muted`.
 * Pehle yellow band `amber` bhej raha tha aur frontend isi naam ke chakkar me grey
 * fallback par chala jaata tha — yellow certificates rang kho dete the. Ab:
 *   • tone ke naam band ke naam se same hain (green / yellow / red),
 *   • `amber` yahan alias ke roop me rakha hai taaki purana payload bhi rangeen rahe.
 *
 * Colours WCAG-checked hain — har ink apne hi tint par 4.5:1+ (measured):
 *   green  #12703a  5.18:1 on tint · #def0de   | dark: #4ade80  9.95:1
 *   yellow #a54a08  5.11:1 on tint · #fdeed0   | dark: #fbbf24 10.39:1
 *   red    #c81e1e  4.54:1 on tint · #fadfd9   | dark: #f87171  6.27:1
 * (pure yellow #f59e0b light card par 2.11:1 — isliye yellow ka darker shade.)
 */

export const INTEGRITY_TONE = {
  green: { ink: '#12703a', inkDark: '#4ade80', soft: 'rgba(22,163,74,.14)', line: 'rgba(22,163,74,.45)', badge: 'green' },
  yellow: { ink: '#a54a08', inkDark: '#fbbf24', soft: 'rgba(245,158,11,.16)', line: 'rgba(245,158,11,.5)', badge: 'amber' },
  red: { ink: '#c81e1e', inkDark: '#f87171', soft: 'rgba(220,38,38,.14)', line: 'rgba(220,38,38,.45)', badge: 'red' },
  muted: { ink: '#64748b', inkDark: '#94a3b8', soft: 'rgba(100,116,139,.14)', line: 'rgba(100,116,139,.4)', badge: '' },
};

/** 'amber' (legacy) → 'yellow' */
export function normalizeTone(tone) {
  const key = String(tone || '').toLowerCase();
  if (key === 'amber') return 'yellow';
  return INTEGRITY_TONE[key] ? key : 'muted';
}

export function integrityTone(tone) {
  return INTEGRITY_TONE[normalizeTone(tone)];
}

/** Kisi bhi surface par dikhne wala readable ink (certificate cards light hote hain). */
export function integrityInk(tone, { dark = false } = {}) {
  const t = integrityTone(tone);
  return dark ? t.inkDark : t.ink;
}

/** Maujooda `.badge.green / .badge.amber / .badge.red` CSS classes. */
export function integrityBadgeClass(tone) {
  return integrityTone(tone).badge;
}

export default integrityTone;
