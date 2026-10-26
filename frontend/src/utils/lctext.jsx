/**
 * LeetCode-style inline text formatting:
 *  - `code`  -> inline code chip
 *  - **bold** -> strong
 * Returns an array of React nodes (plain strings pass through untouched).
 */
export function lcText(text) {
  if (!text) return null;
  const nodes = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      nodes.push(<code key={key++} className="lc-code-inline">{tok.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Splits a constraints/bullets blob into list items (strips leading -, *, •). */
export function lcLines(text) {
  if (!text) return [];
  return String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*•]\s*/, ''));
}
