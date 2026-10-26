/**
 * One place that opens the webcam, and one place that explains why it failed.
 *
 * Two things went wrong before this existed:
 *
 *  1. Every getUserMedia failure was reported as "Camera permission was not granted
 *     — allow it from the 🔒 icon". That is true only for NotAllowedError. The
 *     most common real-world failure is NotReadableError, which means the
 *     camera is held by ANOTHER APP (Zoom, Meet, Teams, OBS, a second tab) or
 *     the driver cannot read it — telling that user to grant permission sends
 *     them hunting for a setting that is already correct.
 *
 *  2. The proctoring hook asked for 640x480 while the admin's "Detection test"
 *     page asked for 320x240, so the diagnostic tool was not testing what the
 *     exam actually does.
 */

/** Same request the exam makes — object detection needs the extra pixels. */
export const CAMERA_CONSTRAINTS = {
  video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
  audio: false,
};

/**
 * Open the camera, retrying once without resolution constraints.
 *
 * Some drivers reject an exact-ish size with OverconstrainedError (and a few
 * report NotReadableError for the same reason). A plain `{ video: true }`
 * usually succeeds, and a lower-resolution stream is far better than no
 * proctoring at all.
 */
export async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const err = new Error('getUserMedia unavailable');
    err.name = 'SecurityError';
    throw err;
  }
  try {
    return await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (error) {
    const retryable = ['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotReadableError'];
    if (!retryable.includes(error && error.name)) throw error;
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

/** Plain-language cause + fix for a getUserMedia/getDisplayMedia rejection. */
export function cameraErrorMessage(error, { screen = false } = {}) {
  const name = String((error && error.name) || 'Error');
  const what = screen ? 'Screen share' : 'Camera';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return screen
        ? 'Screen-sharing permission was not granted. Try again, choose “Entire Screen”, and click Share.'
        : 'Camera permission is blocked. Click the 🔒 or camera icon in the address bar, choose Camera → Allow, and reload the page.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is being used by another application. Close Zoom, Meet, Teams, OBS, or another browser tab, '
        + 'then try again. (This is NOT a permission problem.)';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this computer. Connect a USB webcam or turn on the laptop camera and try again.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'Your camera does not support the requested quality. Retrying at a lower resolution — '
        + 'if it still does not work, try another camera.';
    case 'SecurityError':
      return `${what} requires the page to be opened over HTTPS (or on localhost). On an http:// address, the browser `
        + 'will not provide camera access at all.';
    case 'AbortError':
      return 'The camera stopped as soon as it started — this looks like an operating-system or driver problem. Restart the browser and try again.';
    default:
      return `${what} could not be started (${name}). Close other applications, reload the page, and try again.`;
  }
}
