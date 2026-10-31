'use strict';

/**
 * Editorials are available to problem managers, a student who has solved the
 * problem, and everyone after all non-draft contests containing it are over.
 * Problems not attached to a contest stay solution-gated until solved.
 */
function mayViewCodingEditorial({ canManage = false, solved = false, contests = [] } = {}, now = Date.now()) {
  if (canManage || solved) return true;
  if (!Array.isArray(contests) || contests.length === 0) return false;
  return contests.every((contest) => {
    if (!contest) return false;
    if (['completed', 'cancelled'].includes(String(contest.status || ''))) return true;
    const endAt = contest.end_at ? new Date(contest.end_at).getTime() : NaN;
    return Number.isFinite(endAt) && endAt < now;
  });
}

module.exports = { mayViewCodingEditorial };
