'use strict';

/**
 * Contest editorial visibility: managers can always view it; everyone else only
 * after the contest is completed or its scheduled end time has passed.
 */
function mayViewContestEditorial(user, contest, now = Date.now()) {
  if (!contest) return false;
  if (user && ['owner', 'admin'].includes(user.role)) return true;
  if (user && user.role === 'developer'
      && Number(user.id) === Number(contest.created_by)) return true;
  if (contest.status === 'completed') return true;
  const endAt = contest.end_at ? new Date(contest.end_at).getTime() : NaN;
  return Number.isFinite(endAt) && endAt < now;
}

module.exports = { mayViewContestEditorial };
