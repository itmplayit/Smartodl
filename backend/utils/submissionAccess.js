'use strict';

/**
 * Submission details are private to their author, platform admins, or a
 * developer explicitly granted the same view_submissions permission used by
 * the submissions list endpoint.
 */
function canReadCodingSubmission(user, submissionUserId) {
  if (!user) return false;
  if (Number(user.id) === Number(submissionUserId)) return true;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.role === 'developer'
    && Array.isArray(user.permissions)
    && user.permissions.includes('view_submissions');
}

module.exports = { canReadCodingSubmission };
