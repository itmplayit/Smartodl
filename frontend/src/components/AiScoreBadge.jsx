/**
 * AI-assistance indicator.
 *
 * Replaces the old single opaque percentage. That number merged a prose
 * classifier with a paste ratio using Math.max, so a student who drafted in
 * their own editor and pasted read as "100% AI" while a student who retyped a
 * chatbot's answer read as "0% human" — and a teacher had no way to see which
 * half had fired. The three streams are now shown separately.
 *
 * Bands match the server (`band()` in utils/aiTextClassifier.js):
 *   >= 70 review   ·   >= 40 check   ·   below that, nothing to see
 */

const LABEL = {
  style: 'Writing/code style matches generated output',
  paste: 'Content arrived by paste, drop, or blocked paste attempts',
  timing: 'Keystroke rhythm — speed and uniformity',
};

function Bar({ kind, value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = v >= 70 ? '#ef4444' : v >= 40 ? '#f59e0b' : '#64748b';
  return (
    <div className="row" style={{ gap: 6, alignItems: 'center' }} title={LABEL[kind]}>
      <span className="tiny muted" style={{ width: 46, textTransform: 'capitalize' }}>{kind}</span>
      <span style={{ flex: 1, minWidth: 54, height: 5, borderRadius: 3, background: 'rgba(127,127,127,.22)', overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', width: `${v}%`, height: '100%', background: tone }} />
      </span>
      <span className="tiny muted" style={{ width: 26, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

/**
 * @param {object} row  record carrying ai_score / ai_style_score /
 *                      ai_paste_score / ai_timing_score / ai_verdict /
 *                      ai_trusted / ai_signals
 * @param {boolean} compact  one-line badge (tables) vs full breakdown
 * @param {boolean} detectOnly  outcome only — no numeric score or evidence breakdown
 * @param {string} pendingLabel  shown when the score has not been computed yet
 */
export default function AiScoreBadge({ row, compact = true, detectOnly = false, pendingLabel = '— after submit' }) {
  if (!row) return <span className="tiny muted">—</span>;

  const score = row.ai_score;
  const verdict = row.ai_verdict;

  if (verdict === 'error') {
    return <span className="badge amber" title="The classifier threw while grading — the score is unavailable, not clean.">⚠ check failed</span>;
  }
  if (score == null) {
    const why = verdict === 'n/a'
      ? 'Nothing to analyse — this paper has no written or code answers.'
      : 'Computed when the paper is submitted.';
    return <span className="tiny muted" title={why}>{verdict === 'n/a' ? '— not applicable' : pendingLabel}</span>;
  }

  if (detectOnly) {
    const n = Number(score);
    const title = 'Advisory only — review the work before acting.';
    if (verdict === 'ai' || n >= 70) {
      return <span className="badge red" title={title}>🤖 AI Detected</span>;
    }
    if (verdict === 'suspicious' || n >= 40) {
      return <span className="badge amber" title={title}>⚠ AI Suspected</span>;
    }
    return <span className="tiny" style={{ color: '#22c55e', fontWeight: 600 }} title={title}>✓ Not Detected</span>;
  }

  const n = Number(score);
  const trusted = Number(row.ai_trusted) === 1;
  const badge = n >= 70
    ? <span className="badge red">🤖 {n} review</span>
    : n >= 40
      ? <span className="badge amber">🤖 {n} check</span>
      : <span className="tiny" style={{ color: '#22c55e', fontWeight: 600 }}>✓ {n} clear</span>;

  const tip = [
    row.ai_signals ? `signals: ${row.ai_signals}` : 'no markers found',
    !trusted ? 'NOTE: the runner reported no typing telemetry — treat with care.' : '',
    'Advisory evidence, not proof. All inputs are client-reported.',
  ].filter(Boolean).join('\n');

  if (compact) {
    return (
      <span title={tip} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        {badge}
        {!trusted && <span className="tiny muted" title="No typing telemetry was reported for this attempt.">⚠</span>}
      </span>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 190 }} title={tip}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        {badge}
        {!trusted && <span className="tiny muted">⚠ no typing data</span>}
      </div>
      <Bar kind="style" value={row.ai_style_score} />
      <Bar kind="paste" value={row.ai_paste_score} />
      <Bar kind="timing" value={row.ai_timing_score} />
      {row.ai_signals ? <div className="tiny muted" style={{ wordBreak: 'break-word' }}>{row.ai_signals}</div> : null}
      <div className="tiny muted">Advisory only — review the work before acting.</div>
    </div>
  );
}
