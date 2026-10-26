/**
 * Return a URL only when it is safe to place in an href/src.
 * Server-side validation is the primary boundary; this also protects the UI
 * from legacy rows written before those checks existed.
 */
export function safeExternalHref(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\/(?![/\\])/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}
