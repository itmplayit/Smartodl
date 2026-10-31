/**
 * One place that turns an axios failure into the sentence the user should read.
 *
 * The API already answers 4xx with `{ success: false, error: "<why>" }` —
 * "Open the lesson and read it before marking it complete.", "This lesson just
 * needs a bit of time open — you can mark it complete in about 12s." — but the
 * default axios `message` is only "Request failed with status code 400", so the
 * UI showed nothing useful and the student was left guessing.
 *
 * Order of preference: server's `error` string → `message` → a generic fallback.
 */
export function errorText(err, fallback = 'Something went wrong — please try again.') {
  if (!err) return fallback;
  const data = err.response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  if (data && typeof data.message === 'string' && data.message.trim()) return data.message;
  if (err.message && !/^Request failed with status code \d+$/.test(err.message)) return err.message;
  if (err.response?.status) return `${fallback} (HTTP ${err.response.status})`;
  return fallback;
}

/** True when the 400 means "you never opened this lesson" (dwell gate). */
export function isLessonNotOpened(err) {
  return /open the lesson/i.test(errorText(err, ''));
}

/** Seconds the server says the lesson still needs to stay open, if it said so. */
export function dwellSecondsLeft(err) {
  const m = errorText(err, '').match(/about (\d+)s/);
  return m ? Number(m[1]) : null;
}

export default errorText;
