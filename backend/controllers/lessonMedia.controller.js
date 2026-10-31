'use strict';
/**
 * Lesson video + PDF: upload, serve and delete.
 *
 * Serving is gated, never static:
 *   - staff may always read their own course media,
 *   - preview lessons are public (that is what "preview" means),
 *   - everyone else must be enrolled (and subscribed, for premium courses),
 *   - a short-lived ticket identifies the user for <video>/<iframe> requests.
 */
const fs = require('fs');
const { q1, exec } = require('../config/db');
const { ApiError, asyncHandler, ok } = require('../utils/helpers');
const { assertLessonAccess, isCourseManager } = require('../services/lessonAccess.service');
const lessonMedia = require('../services/lessonMedia.service');
const lessonWatch = require('../services/lessonWatch.service');
const watch = require('../utils/watchProgress');
const { signMediaTicket, verifyMediaTicket, ttlSeconds } = require('../utils/mediaToken');

/** Finds the lesson and confirms the caller can edit its course. */
async function assertCanManageLesson(user, lessonId) {
  const lesson = await q1('SELECT id, course_id, video_path, video_name, pdf_path, pdf_name FROM lessons WHERE id = ?', [lessonId]);
  if (!lesson) throw ApiError.notFound('Lesson not found');
  const course = await q1('SELECT id, instructor_id, status FROM courses WHERE id = ?', [lesson.course_id]);
  if (!isCourseManager(user, course)) {
    throw ApiError.forbidden('Only the course owner or an administrator can change lesson media.');
  }
  return lesson;
}

/** GET /api/lessons/:id/media — what this lesson has, plus fresh tickets. */
const mediaInfo = asyncHandler(async (req, res) => {
  const { lesson } = await assertLessonAccess(req.user, req.params.id);
  const media = await lessonMedia.readLessonMedia(lesson.id);
  const exposed = lessonMedia.describeMedia(media);

  // Tickets are only minted for a caller who already passed the entitlement
  // check above; preview lessons work without one.
  const ticketFor = (kind) => {
    if (!req.user) return null;
    return signMediaTicket({ lessonId: lesson.id, userId: req.user.id, kind });
  };
  ok(res, {
    lesson_id: Number(lesson.id),
    video: exposed.video_upload
      ? {
        ...exposed.video_upload,
        url: `/api/lessons/${lesson.id}/video`,
        ...(ticketFor('video') ? { ticket: ticketFor('video') } : {}),
      }
      : null,
    pdf: exposed.pdf_upload
      ? {
        ...exposed.pdf_upload,
        url: `/api/lessons/${lesson.id}/pdf`,
        ...(ticketFor('pdf') ? { ticket: ticketFor('pdf') } : {}),
      }
      : null,
    external_video_url: lesson.video_url || null,
    ttl_seconds: ttlSeconds(),
  });
});

/**
 * Resolves the caller for a media request: Authorization header first, then the
 * `ticket` query parameter that <video>/<iframe> can carry.
 */
async function resolveMediaUser(req, kind) {
  if (req.user) return req.user;
  const ticket = req.query.ticket || req.query.t;
  if (!ticket) return null;
  const verified = verifyMediaTicket(String(ticket), { kind });
  if (!verified) throw ApiError.unauthorized('This media link has expired. Reopen the lesson to continue.');
  const user = await q1(
    `SELECT u.id, u.full_name, u.email, r.slug AS role
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ? AND u.status = 'active'`,
    [verified.userId],
  );
  if (!user) throw ApiError.unauthorized('This media link is no longer valid.');
  return { ...user, permissions: [] };
}

function sendMedia(res, absolutePath, { mime, downloadName, inline }) {
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  // Partial content: this is what lets a learner seek inside a long video.
  res.setHeader('Accept-Ranges', 'bytes');
  if (downloadName) {
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${lessonMedia.sanitizeName(downloadName)}"`,
    );
  }
  // sendFile handles Range requests, 206 responses and ETag/If-Range for us.
  return res.sendFile(absolutePath);
}

/** GET /api/lessons/:id/video — streams the uploaded video. */
const streamVideo = asyncHandler(async (req, res, next) => {
  const user = await resolveMediaUser(req, 'video');
  const { lesson } = await assertLessonAccess(user, req.params.id);
  const media = await lessonMedia.readLessonMedia(lesson.id);
  if (!media.video_path) throw ApiError.notFound('This lesson has no uploaded video');
  const absolute = lessonMedia.resolveStoredPath(media.video_path);
  if (!absolute || !fs.existsSync(absolute)) throw ApiError.notFound('The video file is no longer available');

  // A ticket is bound to one lesson; assertLessonAccess re-checks the rest.
  return sendMedia(res, absolute, {
    mime: lessonMedia.mimeFor(media.video_path),
    downloadName: media.video_name || null,
    inline: true,
  });
});

/** GET /api/lessons/:id/pdf — serves the uploaded PDF inline so it can be embedded. */
const viewPdf = asyncHandler(async (req, res) => {
  const user = await resolveMediaUser(req, 'pdf');
  const { lesson } = await assertLessonAccess(user, req.params.id);
  const media = await lessonMedia.readLessonMedia(lesson.id);
  if (!media.pdf_path) throw ApiError.notFound('This lesson has no uploaded PDF');
  const absolute = lessonMedia.resolveStoredPath(media.pdf_path);
  if (!absolute || !fs.existsSync(absolute)) throw ApiError.notFound('The PDF file is no longer available');

  const download = String(req.query.download || '') === '1';
  return sendMedia(res, absolute, {
    mime: 'application/pdf',
    downloadName: media.pdf_name || 'lesson.pdf',
    inline: !download,
  });
});

/** POST /api/lessons/:id/video — replace the uploaded video. */
const uploadVideo = asyncHandler(async (req, res) => {
  const lesson = await assertCanManageLesson(req.user, req.params.id);
  if (!req.file) throw ApiError.badRequest('Choose a video file to upload');
  let stored;
  try {
    stored = lessonMedia.storeFile(lesson.id, req.file.path, req.file.originalname);
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    throw error;
  }
  await exec(
    'UPDATE lessons SET video_path = ?, video_name = ? WHERE id = ?',
    [stored, lessonMedia.sanitizeName(req.file.originalname), lesson.id],
  );
  if (lesson.video_path && lesson.video_path !== stored) await lessonMedia.removeFile(lesson.video_path);
  const fresh = await q1('SELECT video_path, video_name, pdf_path, pdf_name FROM lessons WHERE id = ?', [lesson.id]);
  ok(res, { lesson_id: Number(lesson.id), ...lessonMedia.describeMedia(fresh) });
});

/** POST /api/lessons/:id/pdf — replace the uploaded PDF. */
const uploadPdf = asyncHandler(async (req, res) => {
  const lesson = await assertCanManageLesson(req.user, req.params.id);
  if (!req.file) throw ApiError.badRequest('Choose a PDF file to upload');
  let stored;
  try {
    stored = lessonMedia.storeFile(lesson.id, req.file.path, req.file.originalname);
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    throw error;
  }
  await exec(
    'UPDATE lessons SET pdf_path = ?, pdf_name = ? WHERE id = ?',
    [stored, lessonMedia.sanitizeName(req.file.originalname), lesson.id],
  );
  if (lesson.pdf_path && lesson.pdf_path !== stored) await lessonMedia.removeFile(lesson.pdf_path);
  const fresh = await q1('SELECT video_path, video_name, pdf_path, pdf_name FROM lessons WHERE id = ?', [lesson.id]);
  ok(res, { lesson_id: Number(lesson.id), ...lessonMedia.describeMedia(fresh) });
});

/** DELETE /api/lessons/:id/video */
const removeVideo = asyncHandler(async (req, res) => {
  const lesson = await assertCanManageLesson(req.user, req.params.id);
  await exec('UPDATE lessons SET video_path = NULL, video_name = NULL WHERE id = ?', [lesson.id]);
  if (lesson.video_path) await lessonMedia.removeFile(lesson.video_path);
  ok(res, { lesson_id: Number(lesson.id), video_upload: null });
});

/** DELETE /api/lessons/:id/pdf */
const removePdf = asyncHandler(async (req, res) => {
  const lesson = await assertCanManageLesson(req.user, req.params.id);
  await exec('UPDATE lessons SET pdf_path = NULL, pdf_name = NULL WHERE id = ?', [lesson.id]);
  if (lesson.pdf_path) await lessonMedia.removeFile(lesson.pdf_path);
  ok(res, { lesson_id: Number(lesson.id), pdf_upload: null });
});

/**
 * POST /api/lessons/:id/watch — player heartbeat.
 *
 * The player reports where it is; the server decides which 10-second slices
 * that proves were watched. Elapsed time is measured on the server, so a client
 * cannot claim a long gap in one call. Nothing here is a punishment: it only
 * decides whether "Mark complete" is allowed under the course policy.
 */
const reportWatch = asyncHandler(async (req, res) => {
  const { lesson, parent } = await assertLessonAccess(req.user, req.params.id);
  if (!req.user) throw ApiError.unauthorized('Login and enroll in this course first');
  const media = await lessonMedia.readLessonMedia(lesson.id);
  if (!media.video_path) {
    throw ApiError.badRequest('This lesson has no uploaded video to track');
  }
  const progress = await lessonWatch.recordHeartbeat(req.user.id, lesson.id, req.body || {});
  const policy = await q1('SELECT completion_policy FROM courses WHERE id = ?', [parent && lesson.course_id]);
  ok(res, {
    lesson_id: Number(lesson.id),
    ...progress,
    complete: watch.isCoverageComplete(progress.covered_buckets, progress.duration_seconds),
    target_percent: watch.COVERAGE_TARGET,
    policy: policy ? policy.completion_policy : 'click',
  });
});

/** GET /api/lessons/:id/watch — where the learner stands, for the UI. */
const watchStatus = asyncHandler(async (req, res) => {
  const { lesson } = await assertLessonAccess(req.user, req.params.id);
  let progress = null;
  try {
    progress = req.user ? await lessonWatch.readProgress(req.user.id, lesson.id) : null;
  } catch (error) {
    if (!error || error.code !== 'ER_NO_SUCH_TABLE') throw error;
  }
  const course = await q1('SELECT completion_policy FROM courses WHERE id = ?', [lesson.course_id]);
  ok(res, {
    lesson_id: Number(lesson.id),
    ...(progress || {
      duration_seconds: 0, covered_buckets: 0, total_buckets: 0,
      watched_seconds: 0, coverage_percent: 0, last_position: 0, last_beat_at: null,
    }),
    complete: progress
      ? watch.isCoverageComplete(progress.covered_buckets, progress.duration_seconds)
      : false,
    target_percent: watch.COVERAGE_TARGET,
    policy: course ? course.completion_policy : 'click',
  });
});

module.exports = {
  mediaInfo, streamVideo, viewPdf, uploadVideo, uploadPdf, removeVideo, removePdf,
  reportWatch, watchStatus,
};
