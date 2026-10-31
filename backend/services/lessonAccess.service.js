'use strict';
/**
 * One place that decides "may this user open this lesson?".
 *
 * getLesson and the media routes (video stream, PDF view) must agree, or a
 * course could hide the text but hand over the video. Keeping the rule here
 * means the answer cannot drift between endpoints.
 */
const { q1 } = require('../config/db');
const { ApiError } = require('../utils/helpers');
const subs = require('./subscription.service');

const isCourseManager = (user, course) => !!user && (
  ['owner', 'admin'].includes(user.role)
  || (user.role === 'developer' && course && Number(course.instructor_id) === Number(user.id))
);

/**
 * Throws the right ApiError when the lesson may not be opened.
 * Returns { lesson, parent, isStaff, isPreview } on success.
 */
async function assertLessonAccess(user, lessonId) {
  const lesson = await q1('SELECT * FROM lessons WHERE id = ?', [lessonId]);
  if (!lesson) throw ApiError.notFound('Lesson not found');
  const parent = await q1('SELECT is_premium, price, status, instructor_id FROM courses WHERE id = ?', [lesson.course_id]);
  const isStaff = isCourseManager(user, parent);
  if (!parent || (parent.status !== 'published' && !isStaff)) throw ApiError.notFound('Lesson not found');

  const isPreview = !!Number(lesson.is_preview);
  if (!isPreview && !isStaff) {
    if (!user) throw ApiError.unauthorized('Login and enroll in this course to access the lesson');
    const enrolled = await q1(
      'SELECT id FROM enrollments WHERE course_id = ? AND user_id = ?',
      [lesson.course_id, user.id],
    );
    if (!enrolled) throw ApiError.forbidden('Enroll in this course to access the lesson');
    // Premium-without-price needs an active subscription; a purchased premium
    // course stays readable through its paid enrollment.
    if (Number(parent.is_premium) && Number(parent.price || 0) <= 0
        && !(await subs.hasPremiumAccess(user))) {
      throw subs.premiumError('lesson');
    }
  }
  return { lesson, parent, isStaff, isPreview };
}

module.exports = { assertLessonAccess, isCourseManager };
