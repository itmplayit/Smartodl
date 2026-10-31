import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { detectObjects, detectPeople, detectorState } from '../utils/objectDetector';
import { openCamera, cameraErrorMessage } from '../utils/cameraAccess';

/**
 * Live proctoring for a quiz attempt: webcam presence + full-screen share.
 *
 * PRIVACY CONTRACT — read before changing anything here.
 * By default not one pixel leaves the browser. Frames are drawn to an
 * off-screen canvas, reduced to a handful of numbers, and thrown away. Only
 * event NAMES ("no_face", "screen_stopped") are posted to the server.
 * The administrator may explicitly enable a live view: snapshot frames then
 * pass through backend memory only (never disk/database), and WebRTC media
 * goes directly to the authorised host. The consent copy in QuizAttempt.jsx
 * is driven by the same switches and must stay in step with this contract.
 *
 * No ML library is pulled in either. Face counting uses the browser's own
 * FaceDetector when it exists (Chrome/Edge) and is skipped — loudly, via a
 * `face_check_unsupported` event — when it does not. A 20 MB model download
 * at the start of an exam is not a trade worth making, and a silent
 * no-op would be worse: the invigilator would think faces were being checked.
 */

const SAMPLE_MS = 5000;      // how often a frame is inspected
const FLUSH_MS = 15000;      // how often queued events are posted
const DARK_LUMA = 18;        // mean 0-255 below this = lens covered / lights off
const FROZEN_DIFF = 1.2;     // mean abs diff below this = identical frame
const FROZEN_STREAK = 3;     // consecutive identical samples before flagging
const REPEAT_COOLDOWN_MS = 20000; // don't re-log the same condition every sample
// Objects get their own, faster loop. A phone is held up for a couple of
// seconds; the 5 s camera sample missed it outright more often than not.
// Inference is ~50-100 ms, so 2 s is comfortable.
const OBJECT_SAMPLE_MS = 2000;
const OBJECT_COOLDOWN_MS = 8000;
const LIVENESS_MS = 3000;    // how often the screen track is checked
/** Already one-per-outage via the *Down refs — must not be cooldown-gated. */
const OUTAGE_EVENTS = ['screen_stopped', 'camera_off'];

export default function useProctoring({
  attemptId,
  cameraRequired,
  screenRequired,
  objectsRequired,
  bodyRequired = false,
  headPoseRequired = false,
  faceCheckRequired = false,
  micRequired = false,
  dualMonitorRequired = false,
  snapshotRequired = false,
  active,
  // Live publishing may begin during preflight (room scan / identity) —
  // after the student pressed "Allow access", before the paper opens — so
  // the host can actually observe those checks. Detection stays gated on
  // `active`; only the snapshot relay honours this earlier signal.
  publishActive = false,
  onAutoSubmit,
  violationLimit = 0,
  initialViolations = 0,
}) {
  const [cameraState, setCameraState] = useState('idle');  // idle|prompting|on|denied|lost
  const [screenState, setScreenState] = useState('idle');
  const [micState, setMicState] = useState('idle');
  const [bodyState, setBodyState] = useState('idle');
  const [displayCount, setDisplayCount] = useState(null);
  const [violations, setViolations] = useState(0);
  const violationsRef = useRef(0);
  const violationAttemptRef = useRef(attemptId);
  // The attempt detail is the persisted source of truth on reload. Keep this
  // count monotonic so delayed batch responses can never roll it backwards.
  useEffect(() => {
    if (String(violationAttemptRef.current) !== String(attemptId)) {
      violationAttemptRef.current = attemptId;
      violationsRef.current = 0;
      setViolations(0);
    }
    const initial = Number(initialViolations);
    if (Number.isFinite(initial) && initial >= 0 && initial > violationsRef.current) {
      violationsRef.current = initial;
      setViolations(initial);
    }
  }, [attemptId, initialViolations]);
  // Seeded from public settings so the student sees the real limit straight
  // away. It used to sit at 0 until the first flush came back, so the gate
  // read "Proctoring violations: 0" with no limit for up to 15 seconds and
  // looked like nothing was being counted at all.
  const [maxViolations, setMaxViolations] = useState(violationLimit);
  useEffect(() => { setMaxViolations((m) => (m === 0 ? violationLimit : m)); }, [violationLimit]);
  const [lastIssue, setLastIssue] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [screenError, setScreenError] = useState('');
  const [micError, setMicError] = useState('');

  const camStream = useRef(null);
  const scrStream = useRef(null);
  const micStream = useRef(null);
  // Permission prompts are asynchronous; refs make policy-off take effect
  // even if a prompt resolves after the feature was disabled.
  const cameraRequiredRef = useRef(cameraRequired);
  const screenRequiredRef = useRef(screenRequired);
  const micRequiredRef = useRef(micRequired);
  cameraRequiredRef.current = cameraRequired;
  screenRequiredRef.current = screenRequired;
  micRequiredRef.current = micRequired;
  const videoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const snapshotCanvasRef = useRef(null);
  const micAudioRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const micDataRef = useRef(null);
  const prevFrame = useRef(null);
  const frozenCount = useRef(0);
  const queue = useRef([]);
  const lastLogged = useRef({});
  const detector = useRef(undefined); // undefined = not tried, null = unsupported
  const screenDown = useRef(false);   // one violation per outage, not per poll
  const cameraDown = useRef(false);   // same for the camera
  const micDown = useRef(false);      // same for the microphone
  const camRetryAt = useRef(0);       // throttle silent re-acquire attempts
  const micRetryAt = useRef(0);
  const voiceStreak = useRef(0);
  const bodyMissStreak = useRef(0);
  const bodyMultiStreak = useRef(0);
  const bodyFrameStreak = useRef(0);
  const headAwayStreak = useRef(0);
  const displayReported = useRef(null);

  /**
   * Is the share actually alive?
   *
   * Never trust the stored stream object on its own: `ended` does NOT fire for
   * a track killed by MediaStreamTrack.stop(), a disconnected display, or
   * another app seizing the device. The guards in startScreen/resumeScreen
   * used to check `scrStream.current` alone, so after a stop they saw a
   * (dead) stream, returned early, and the student could never re-share.
   */
  /** Same contract as screenLive(): readyState is the truth, not `ended`. */
  const cameraLive = useCallback(() => {
    const t = camStream.current && camStream.current.getVideoTracks()[0];
    if (t && t.readyState === 'live' && !t.muted) return true;
    if (camStream.current) { camStream.current.getTracks().forEach((x) => x.stop()); camStream.current = null; }
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
    return false;
  }, []);

  const screenLive = useCallback(() => {
    const t = scrStream.current && scrStream.current.getVideoTracks()[0];
    if (t && t.readyState === 'live') return true;
    scrStream.current = null;          // drop the corpse so a retry can work
    if (screenVideoRef.current) { screenVideoRef.current.srcObject = null; screenVideoRef.current = null; }
    return false;
  }, []);

  const micLive = useCallback(() => {
    const t = micStream.current && micStream.current.getAudioTracks()[0];
    if (t && t.readyState === 'live' && !t.muted) return true;
    if (micStream.current) { micStream.current.getTracks().forEach((x) => x.stop()); micStream.current = null; }
    return false;
  }, []);
  const objectBusy = useRef(false);   // one inference at a time, never queue up
  const objectDead = useRef(false);   // loader already failed — stop trying
  const autoSubmitted = useRef(false);
  // The caller passes an inline arrow, so its identity changes on every render.
  // Depending on it directly would rebuild `flush`, which would tear down and
  // restart the 15 s interval on every render — and a quiz screen re-renders
  // once a second for the countdown, so the interval would NEVER fire.
  const onAutoSubmitRef = useRef(onAutoSubmit);
  useEffect(() => { onAutoSubmitRef.current = onAutoSubmit; }, [onAutoSubmit]);

  /** Queue an event, de-duplicating a condition that persists across samples. */
  // Set by the flush effect below. push() needs to kick a flush the moment
  // something real happens, but flush is defined after it.
  const flushNow = useRef(null);

  const push = useCallback((type, detail) => {
    const now = Date.now();
    // Outage events are ALREADY de-duplicated at source by screenDown /
    // cameraDown — one event per outage, however long it lasts. Putting them
    // behind the repeat cooldown as well was swallowing genuine separate
    // violations: stop sharing, resume, stop again inside 20 s and the second
    // stop vanished, so the count stuck at 1 and auto-submit never triggered.
    const exempt = OUTAGE_EVENTS.includes(type);
    const cooldown = type.endsWith('_detected') ? OBJECT_COOLDOWN_MS : REPEAT_COOLDOWN_MS;
    if (!exempt && lastLogged.current[type] && now - lastLogged.current[type] < cooldown) return;
    lastLogged.current[type] = now;
    queue.current.push({ type, detail });
    const housekeeping = type === 'camera_granted' || type === 'screen_granted'
      || type === 'mic_granted' || type === 'face_check_unsupported'
      || type === 'body_check_unavailable' || type === 'dual_monitor_check_unavailable'
      || type === 'room_scan_started' || type === 'room_scan_completed'
      || type === 'second_camera_connected' || type === 'identity_check_completed'
      || type === 'live_view_started';
    if (!housekeeping) setLastIssue({ type, at: now });
    // Anything that is not housekeeping goes to the server AT ONCE rather than
    // waiting for the 15 s tick. Before this the counter on the student's
    // screen (and the invigilator's) lagged by up to 15 seconds, and the
    // auto-submit threshold was checked just as late.
    if (!housekeeping && flushNow.current) flushNow.current();
  }, []);

  const handleEventResponse = useCallback((res) => {
    // The API wraps everything as { success, data }, and axios wraps THAT as
    // res.data — so the payload is res.data.data. Reading res.data gave the
    // envelope, where `violations`, `max` and `auto_submit` are all
    // undefined: the counter sat on 0 forever and auto-submit never fired.
    const d = (res && res.data && res.data.data) || {};
    if (typeof d.violations === 'number' && Number.isFinite(d.violations)) {
      const canonical = Math.max(violationsRef.current, d.violations);
      violationsRef.current = canonical;
      setViolations(canonical);
    }
    if (typeof d.max === 'number') setMaxViolations(d.max);
    if (d.auto_submit && !autoSubmitted.current) {
      autoSubmitted.current = true;
      if (onAutoSubmitRef.current) onAutoSubmitRef.current();
    }
    return d;
  }, []);

  const flush = useCallback(async () => {
    if (!attemptId || !queue.current.length) return true;
    const events = queue.current.splice(0, queue.current.length);
    try {
      handleEventResponse(await api.post(`/quiz-attempts/${attemptId}/proctor`, { events }));
      return true;
    } catch (_) {
      // Never let a proctoring post break the exam. Ordinary queued events
      // are dropped rather than retried forever — a student must not be
      // punished for our outage. (Critical one-shot reports below do NOT
      // use this path; they must be acknowledged.)
      return false;
    }
  }, [attemptId, handleEventResponse]); // deliberately stable — see onAutoSubmitRef above

  // Wire the immediate-flush hook up now that `flush` exists.
  useEffect(() => { flushNow.current = flush; return () => { flushNow.current = null; }; }, [flush]);

  /**
   * Critical one-shot reports (preflight completion, second-camera outage).
   *
   * These bypass the de-duplicating queue and are posted directly: the
   * caller is only told "done" when the server confirms it accepted the
   * event. The old push()+flush() path swallowed network failures and the
   * 20 s repeat cooldown, so the UI cheerfully advanced past a room scan
   * that was never recorded — and submit then charged the student with a
   * missing check. Now a failure throws and the student stays on the step
   * with a retry.
   */
  const reportEvent = useCallback(async (type, detail) => {
    if (!attemptId) throw new Error('Attempt is not ready yet');
    await flush().catch(() => false);
    const res = await api.post(`/quiz-attempts/${attemptId}/proctor`, { events: [{ type, detail }] });
    const d = handleEventResponse(res);
    if (!d || Number(d.accepted || 0) < 1) {
      throw new Error(`The ${type} report was not accepted by the server`);
    }
    lastLogged.current[type] = Date.now();
    return true;
  }, [attemptId, flush, handleEventResponse]);

  /* ----------------------------------------------------------- camera ---- */
  /**
   * `silent` is used by the automatic re-acquire loop. A failed AUTOMATIC
   * retry must not be charged to the student: the outage already cost them
   * one `camera_off`, and billing every background attempt as `camera_denied`
   * (weight 1) was quietly doubling the penalty for one hiccup.
   * Only a real user action — the consent gate or the recovery button —
   * reports a denial.
   */
  const startCamera = useCallback(async (silent = false) => {
    if (!cameraRequired) return true;
    if (cameraLive()) return true;
    if (!silent) setCameraState('prompting');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('denied');
      if (!silent) push('camera_denied', 'browser has no camera API (needs HTTPS)');
      return false;
    }
    try {
      // Shared with the admin Detection test so both open the camera exactly
      // the same way (and both retry without constraints if the driver balks).
      const stream = await openCamera();
      if (!cameraRequiredRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setCameraState('idle');
        return true;
      }
      camStream.current = stream;
      const v = document.createElement('video');
      v.playsInline = true; v.muted = true; v.srcObject = stream;
      await v.play().catch(() => {});
      videoRef.current = v;
      stream.getVideoTracks().forEach((t) => {
        t.addEventListener('ended', () => {
          setCameraState('lost');
          if (!cameraDown.current) { cameraDown.current = true; push('camera_off', 'track ended'); }
        });
      });
      setCameraState('on');
      setCameraError('');
      if (cameraDown.current) { cameraDown.current = false; push('camera_resumed'); }
      else push('camera_granted');
      return true;
    } catch (err) {
      setCameraState('lost');
      // Keep the raw name in the audit trail (useful to an invigilator) but
      // hand the student a sentence that names the ACTUAL cause.
      setCameraError(cameraErrorMessage(err));
      if (!silent) push('camera_denied', String((err && err.name) || 'error').slice(0, 60));
      return false;
    }
  }, [cameraRequired, push, cameraLive]);

  /* ------------------------------------------------------------ screen --- */
  const startScreen = useCallback(async () => {
    if (!screenRequired) return true;
    if (screenLive()) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setScreenState('denied');
      push('screen_denied', 'browser has no screen-share API (needs HTTPS)');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' }, audio: false,
      });
      if (!screenRequiredRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setScreenState('idle');
        return true;
      }
      const track = stream.getVideoTracks()[0];
      const surface = (track && track.getSettings && track.getSettings().displaySurface) || '';
      // Sharing only the quiz tab defeats the point — the student could keep
      // notes open in another window. `displaySurface` is advisory in the
      // constraint but authoritative in the settings, so it is checked here.
      if (surface && surface !== 'monitor') {
        stream.getTracks().forEach((t) => t.stop());
        setScreenState('wrong');
        push('screen_wrong_surface', surface);
        return false;
      }
      scrStream.current = stream;
      // A hidden video element lets the snapshot relay and WebRTC publisher
      // use exactly the same screen track the liveness check is watching.
      const sv = document.createElement('video');
      sv.playsInline = true; sv.muted = true; sv.srcObject = stream;
      await sv.play().catch(() => {});
      screenVideoRef.current = sv;
      track.addEventListener('ended', () => {
        scrStream.current = null;
        if (screenVideoRef.current) { screenVideoRef.current.srcObject = null; screenVideoRef.current = null; }
        setScreenState('lost');
        if (!screenDown.current) {
          screenDown.current = true;
          push('screen_stopped', 'user pressed stop sharing');
        }
      });
      setScreenState('on');
      setScreenError('');
      // Re-sharing after a stop is a separate, non-punitive event so the
      // invigilator can see the gap was closed rather than just "stopped".
      if (screenDown.current) { screenDown.current = false; push('screen_resumed', surface || 'monitor'); }
      else push('screen_granted', surface || 'monitor');
      return true;
    } catch (err) {
      setScreenState('denied');
      setScreenError(cameraErrorMessage(err, { screen: true }));
      push('screen_denied', String((err && err.name) || 'error').slice(0, 60));
      return false;
    }
  }, [screenRequired, push, screenLive]);

  /**
   * Re-acquire the screen share after the student stopped it.
   *
   * getDisplayMedia() can only be called from a user gesture, so the quiz
   * cannot silently restart it — the UI has to put a button in front of the
   * student. Without this the share stayed dead for the rest of the paper and
   * the whole check became pointless after one click of "Stop sharing".
   */
  /* --------------------------------------------------------- microphone -- */
  const micErrorText = (err) => {
    const name = String((err && err.name) || 'Error');
    // A LAN IP opened over plain HTTP is not a secure context. Browser site
    // settings cannot override that restriction; localhost is exempt, while
    // another device needs HTTPS with a certificate it trusts.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return 'Microphone access requires a secure page. On another laptop, plain http://<LAN-IP> is blocked even if browser permission is Allow; use trusted HTTPS, or test from localhost on this computer.';
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Microphone permission is blocked by the browser or operating system. Allow this site in the address-bar/site settings, check Windows microphone privacy settings, then retry.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found on this computer.';
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The microphone is being used by another application. Close Zoom, Meet, Teams or another tab and try again.';
    }
    if (name === 'SecurityError') return 'Microphone access requires HTTPS (or localhost).';
    return `Microphone could not be started (${name}). Reload the page and try again.`;
  };

  const startMic = useCallback(async (silent = false) => {
    if (!micRequired) return true;
    if (micLive()) return true;
    if (!silent) setMicState('prompting');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicState('denied');
      setMicError('Microphone access requires HTTPS (or localhost).');
      if (!silent) push('mic_denied', 'browser has no microphone API (needs HTTPS)');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!micRequiredRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setMicState('idle');
        return true;
      }
      micStream.current = stream;
      stream.getAudioTracks().forEach((t) => {
        t.addEventListener('ended', () => {
          setMicState('lost');
          if (!micDown.current) { micDown.current = true; push('mic_off', 'track ended'); }
        });
      });

      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) {
        if (!micAudioRef.current) micAudioRef.current = new AudioCtor();
        if (micAudioRef.current.state === 'suspended') await micAudioRef.current.resume().catch(() => {});
        const source = micAudioRef.current.createMediaStreamSource(stream);
        const analyser = micAudioRef.current.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        micAnalyserRef.current = analyser;
        micDataRef.current = new Uint8Array(analyser.fftSize);
      }

      setMicState('on');
      setMicError('');
      if (micDown.current) { micDown.current = false; push('mic_resumed'); }
      else push('mic_granted');
      return true;
    } catch (err) {
      setMicState('lost');
      setMicError(micErrorText(err));
      if (!silent) push('mic_denied', String((err && err.name) || 'error').slice(0, 60));
      return false;
    }
  }, [micRequired, micLive, push]);

  const resumeMic = useCallback(async () => {
    if (micLive()) return true;
    return startMic();
  }, [micLive, startMic]);

  /** Manual fallback when the silent re-acquire keeps failing. */
  const resumeCamera = useCallback(async () => {
    if (cameraLive()) return true;
    return startCamera();
  }, [startCamera, cameraLive]);

  const resumeScreen = useCallback(async () => {
    if (screenLive()) return true;
    return startScreen();
  }, [startScreen, screenLive]);

  const start = useCallback(async () => {
    // getDisplayMedia requires a transient user activation. Invoke it directly
    // from the click handler before any camera permission await; once the
    // student has selected the screen, camera/mic permission can follow.
    const screen = await startScreen();
    const [camera, mic] = await Promise.all([startCamera(), startMic()]);
    return screen && camera && mic;
  }, [startCamera, startScreen, startMic]);

  const releaseCamera = useCallback(() => {
    if (camStream.current) { camStream.current.getTracks().forEach((t) => t.stop()); camStream.current = null; }
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
    setCameraState('idle');
  }, []);

  const releaseScreen = useCallback(() => {
    if (scrStream.current) { scrStream.current.getTracks().forEach((t) => t.stop()); scrStream.current = null; }
    if (screenVideoRef.current) { screenVideoRef.current.srcObject = null; screenVideoRef.current = null; }
    setScreenState('idle');
  }, []);

  const releaseMic = useCallback(() => {
    if (micStream.current) { micStream.current.getTracks().forEach((t) => t.stop()); micStream.current = null; }
    if (micAudioRef.current) {
      micAudioRef.current.close().catch(() => {});
      micAudioRef.current = null;
    }
    micAnalyserRef.current = null;
    micDataRef.current = null;
    micDown.current = false;
    voiceStreak.current = 0;
    setMicState('idle');
  }, []);

  const stop = useCallback(() => {
    releaseCamera();
    releaseScreen();
    releaseMic();
  }, [releaseCamera, releaseScreen, releaseMic]);

  // A feature can be switched off while the attempt remains active for other
  // checks. Release only its sensor; do not keep a mic/display stream alive
  // merely because the webcam or another transport is still in use.
  useEffect(() => { if (!cameraRequired) releaseCamera(); }, [cameraRequired, releaseCamera]);
  useEffect(() => { if (!screenRequired) releaseScreen(); }, [screenRequired, releaseScreen]);
  useEffect(() => { if (!micRequired) releaseMic(); }, [micRequired, releaseMic]);

  const getStreams = useCallback(() => ({
    camera: camStream.current,
    screen: scrStream.current,
    mic: micStream.current,
  }), []);

  /* ------------------------------------------------- per-sample analysis -- */
  useEffect(() => {
    if (!active || !cameraRequired) return undefined;
    let cancelled = false;

    const sample = async () => {
      const v = videoRef.current;
      const stream = camStream.current;
      if (!v || !stream) return;
      const track = stream.getVideoTracks()[0];
      // The sampler is the authority on liveness, not the 'ended' listener:
      // MediaStreamTrack.stop() and several real-world failures (USB unplug,
      // another app grabbing the device) do NOT fire 'ended', which would
      // leave the status pill cheerfully showing a camera that is dead.
      if (!track || track.readyState !== 'live' || track.muted) {
        setCameraState('lost');
        // ONE violation per outage. This used to fire on every sample, so a
        // five-minute webcam hiccup quietly stacked up ~15 violations and
        // could auto-submit an honest student's paper.
        if (!cameraDown.current) {
          cameraDown.current = true;
          push('camera_off', track && track.muted ? 'track muted' : 'track not live');
        }
        // Unlike screen share, getUserMedia does not need a fresh user gesture
        // once permission is granted — so try to heal silently before putting
        // a wall in front of someone whose USB camera blinked.
        if (Date.now() - camRetryAt.current > 8000) {
          camRetryAt.current = Date.now();
          startCamera(true).catch(() => {});   // silent: no penalty if it fails
        }
        return;
      }
      setCameraState((prev) => (prev === 'on' ? prev : 'on'));
      if (!v.videoWidth) return;

      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
      const c = canvasRef.current;
      const W = 64; const H = 48;                   // tiny: this is a statistic, not a picture
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, W, H);
      let data;
      try { data = ctx.getImageData(0, 0, W, H).data; } catch (_) { return; }

      let sum = 0;
      const grey = new Uint8Array(W * H);
      for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
        grey[p] = g; sum += g;
      }
      const mean = sum / grey.length;

      if (mean < DARK_LUMA) { push('camera_dark', `luma ${mean.toFixed(0)}`); }

      if (prevFrame.current) {
        let diff = 0;
        for (let i = 0; i < grey.length; i += 1) diff += Math.abs(grey[i] - prevFrame.current[i]);
        diff /= grey.length;
        // A real camera always has sensor noise. A perfectly static frame means
        // a still image is being fed in (taped photo, virtual camera, paused).
        if (diff < FROZEN_DIFF) {
          frozenCount.current += 1;
          if (frozenCount.current >= FROZEN_STREAK) push('camera_frozen', `diff ${diff.toFixed(2)}`);
        } else frozenCount.current = 0;
      }
      prevFrame.current = grey;

      // Face counting is part of the explicit basic Webcam check; head pose
      // also needs face geometry. Other camera-only features must not silently
      // activate face-presence monitoring.
      if (!faceCheckRequired && !headPoseRequired) return;
      if (detector.current === undefined) {
        if (typeof window !== 'undefined' && 'FaceDetector' in window) {
          try { detector.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 }); }
          catch (_) { detector.current = null; }
        } else detector.current = null;
        if (detector.current === null && faceCheckRequired) push('face_check_unsupported', 'no FaceDetector in this browser');
        if (detector.current === null && headPoseRequired) push('head_pose_check_unavailable', 'no FaceDetector geometry in this browser');
      }
      if (detector.current) {
        try {
          const faces = await detector.current.detect(v);
          if (cancelled) return;
          if (!faces.length) {
            headAwayStreak.current = 0;
            if (faceCheckRequired) push('no_face');
          } else if (faces.length > 1) {
            headAwayStreak.current = 0;
            if (faceCheckRequired) push('multiple_faces', `${faces.length} faces`);
          } else if (headPoseRequired) {
            const face = faces[0] || {};
            const box = face.boundingBox || {};
            const points = (Array.isArray(face.landmarks) ? face.landmarks : [])
              .flatMap((landmark) => (Array.isArray(landmark.locations) ? landmark.locations : [])
                .map((point) => ({ ...point, type: String(landmark.type || '').toLowerCase() })));
            const eyes = points.filter((point) => point.type.includes('eye'));
            const nose = points.find((point) => point.type.includes('nose'));
            let away = false;
            let detail = '';
            if (eyes.length >= 2 && nose) {
              const eyeMidX = (Number(eyes[0].x) + Number(eyes[1].x)) / 2;
              const eyeDistance = Math.max(1, Math.abs(Number(eyes[1].x) - Number(eyes[0].x)));
              const yaw = Math.abs((Number(nose.x) - eyeMidX) / eyeDistance);
              if (yaw > 0.48) { away = true; detail = `head yaw estimate ${yaw.toFixed(2)}`; }
            } else if (box.width && v.videoWidth) {
              const centre = (Number(box.x) + Number(box.width) / 2) / Number(v.videoWidth);
              if (centre < 0.16 || centre > 0.84) { away = true; detail = 'face held at the frame edge'; }
            }
            if (away) {
              headAwayStreak.current += 1;
              if (headAwayStreak.current >= 2) push('looking_away', detail || 'sustained head turn');
            } else headAwayStreak.current = 0;
          }
        } catch (_) { /* detector hiccup — not the student's problem */ }
      }

    };

    const id = setInterval(sample, SAMPLE_MS);
    sample();
    return () => { cancelled = true; clearInterval(id); };
  }, [active, cameraRequired, objectsRequired, headPoseRequired, faceCheckRequired, push, startCamera]);

  /* ------------------------------------------------- object detection ----
     Deliberately its own loop, not folded into the camera sample: it runs 2.5x
     more often (a phone is only up for a moment) and it must never delay the
     cheap luminance/frozen checks while an inference is in flight. */
  useEffect(() => {
    if (!active || !objectsRequired) return undefined;
    let cancelled = false;
    const tick = async () => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || objectDead.current || objectBusy.current) return;
      objectBusy.current = true;
      try {
        const hits = await detectObjects(v);
        if (cancelled) return;
        if (hits === null) {
          objectDead.current = true;        // loader gave up; stop asking
          push('object_check_unavailable', 'model could not load');
        } else {
          hits.forEach((h) => push(h.event, `${h.label} ${h.score}%`));
        }
      } catch (_) { /* never let this break the attempt */ }
      finally { objectBusy.current = false; }
    };
    const id = setInterval(tick, OBJECT_SAMPLE_MS);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [active, objectsRequired, push]);

  // Surfaced so the student can see the detector is still downloading rather
  // than silently doing nothing — the single biggest "it isn't working"
  // complaint, because there used to be no signal at all.
  const [objectState, setObjectState] = useState('idle');
  useEffect(() => {
    if (!active || !objectsRequired) return undefined;
    const id = setInterval(() => setObjectState(detectorState()), 1000);
    return () => clearInterval(id);
  }, [active, objectsRequired]);

  /* --------------------------------------------------- body detection ----
     Uses the same COCO model as phone/book detection, but full-frame person
     boxes only. The shared objectBusy gate serialises inferences so enabling
     body detection cannot make two model passes compete for the main thread. */
  useEffect(() => {
    if (!active || !cameraRequired || !bodyRequired) return undefined;
    let cancelled = false;
    let unavailableReported = false;
    const tick = async () => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || objectBusy.current) return;
      objectBusy.current = true;
      try {
        const people = await detectPeople(v);
        if (cancelled) return;
        if (people === null) {
          setBodyState('unavailable');
          if (!unavailableReported) {
            unavailableReported = true;
            push('body_check_unavailable', 'person check unavailable (model/inference)');
          }
          return;
        }

        if (!people.length) {
          bodyMissStreak.current += 1;
          bodyMultiStreak.current = 0;
          bodyFrameStreak.current = 0;
          setBodyState('missing');
          if (bodyMissStreak.current >= 3) push('body_missing', 'no person in three samples');
          return;
        }

        if (people.length > 1) {
          bodyMultiStreak.current += 1;
          bodyMissStreak.current = 0;
          bodyFrameStreak.current = 0;
          setBodyState('multiple');
          if (bodyMultiStreak.current >= 2) push('multiple_people', `${people.length} people`);
          return;
        }

        bodyMissStreak.current = 0;
        bodyMultiStreak.current = 0;
        const box = people[0].bbox;
        const poorlyFramed = box.width < 0.18 || box.height < 0.28
          || box.x < 0.015 || box.y < 0.015 || box.x + box.width > 0.985;
        if (poorlyFramed) {
          bodyFrameStreak.current += 1;
          setBodyState('framing');
          if (bodyFrameStreak.current >= 3) {
            push('body_out_of_frame', `person box ${(box.width * 100).toFixed(0)}% x ${(box.height * 100).toFixed(0)}%`);
          }
        } else {
          bodyFrameStreak.current = 0;
          setBodyState('ok');
        }
      } catch (_) {
        // Inference failure is never charged to the student.
      } finally {
        objectBusy.current = false;
      }
    };
    const id = setInterval(tick, 2500);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [active, cameraRequired, bodyRequired, push]);

  /* ------------------------------------------------ microphone analysis -- */
  useEffect(() => {
    if (!active || !micRequired) return undefined;
    const tick = () => {
      if (!micLive()) {
        setMicState('lost');
        if (!micDown.current) {
          micDown.current = true;
          push('mic_off', 'track not live');
        }
        if (Date.now() - micRetryAt.current > 8000) {
          micRetryAt.current = Date.now();
          startMic(true).catch(() => {});
        }
        return;
      }
      setMicState((prev) => (prev === 'on' ? prev : 'on'));
      const analyser = micAnalyserRef.current;
      const data = micDataRef.current;
      if (!analyser || !data) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const centred = (data[i] - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / Math.max(1, data.length));
      if (rms > 0.055) {
        voiceStreak.current += 1;
        if (voiceStreak.current >= 3) {
          push('voice_detected', `audio level ${(rms * 100).toFixed(0)}% for 3 seconds`);
          voiceStreak.current = 0;
        }
      } else voiceStreak.current = 0;
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [active, micRequired, micLive, push, startMic]);

  /* ------------------------------------------------ multiple displays ---- */
  useEffect(() => {
    if (!active || !dualMonitorRequired) return undefined;
    let cancelled = false;
    let details = null;
    let onScreensChange = null;

    const report = (count) => {
      if (cancelled) return;
      setDisplayCount(count);
      if (count === null) {
        if (displayReported.current !== 'unavailable') {
          displayReported.current = 'unavailable';
          push('dual_monitor_check_unavailable', 'no display-count API in this browser');
        }
        return;
      }
      if (count > 1 && displayReported.current !== count) {
        displayReported.current = count;
        push('multiple_displays_detected', `${count} displays connected`);
      } else if (count <= 1) {
        displayReported.current = count;
      }
    };

    const fallback = () => {
      if (window.screen && typeof window.screen.isExtended === 'boolean') {
        report(window.screen.isExtended ? 2 : 1);
      } else report(null);
    };

    (async () => {
      if (typeof window !== 'undefined' && typeof window.getScreenDetails === 'function') {
        try {
          details = await window.getScreenDetails();
          report(Array.isArray(details.screens) ? details.screens.length : null);
          onScreensChange = () => report(Array.isArray(details.screens) ? details.screens.length : null);
          if (details.addEventListener) details.addEventListener('screenschange', onScreensChange);
          return;
        } catch (_) { /* permission/policy refusal falls back below */ }
      }
      fallback();
    })();

    const id = setInterval(() => { if (!details) fallback(); }, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (details && onScreensChange && details.removeEventListener) {
        details.removeEventListener('screenschange', onScreensChange);
      }
    };
  }, [active, dualMonitorRequired, push]);

  /* ---------------------------------------------- live snapshot relay -----
     Only runs under the administrator's explicit snapshot-grid switch. The
     backend keeps the newest thumbnail per attempt in memory for seconds;
     no frame is stored in the database or on disk. */
  useEffect(() => {
    if (!(active || publishActive) || !snapshotRequired || !attemptId) return undefined;
    let cancelled = false;
    let busy = false;

    const capture = async (kind) => {
      if (busy || cancelled) return;
      const source = kind === 'camera' ? videoRef.current : screenVideoRef.current;
      if (!source || !source.videoWidth || !source.videoHeight) return;
      busy = true;
      try {
        if (!snapshotCanvasRef.current) snapshotCanvasRef.current = document.createElement('canvas');
        const canvas = snapshotCanvasRef.current;
        const targetWidth = kind === 'camera' ? 240 : 420;
        const scale = Math.min(1, targetWidth / source.videoWidth);
        canvas.width = Math.max(2, Math.round(source.videoWidth * scale));
        canvas.height = Math.max(2, Math.round(source.videoHeight * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', kind === 'camera' ? 0.55 : 0.5);
        if (image.length <= (kind === 'camera' ? 260 * 1024 : 520 * 1024)) {
          await api.post(`/quiz-attempts/${attemptId}/proctor-frame`, { kind, image });
        }
      } catch (_) {
        // A relay failure must never interrupt the exam.
      } finally {
        busy = false;
      }
    };

    const first = setTimeout(async () => {
      await capture('camera');
      await capture('screen');
    }, 1200);
    const cameraTimer = setInterval(() => capture('camera'), 10000);
    const screenTimer = setInterval(() => capture('screen'), 20000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(cameraTimer);
      clearInterval(screenTimer);
    };
  }, [active, publishActive, snapshotRequired, attemptId]);

  /* --------------------------------------------- screen liveness + flush --
     Liveness is checked far more often than the network flush. `ended` fires
     for Chrome's own "Stop sharing" bar, but NOT when a display is unplugged
     or another app seizes the capture — those used to take up to 15 s to
     notice because the check rode on the flush tick. push() now flushes
     immediately anyway, so the slow timer is only a backstop. */
  useEffect(() => {
    if (!active || !screenRequired) return undefined;
    const id = setInterval(() => {
      if (!screenLive()) {
        setScreenState('lost');
        if (!screenDown.current) {
          screenDown.current = true;
          push('screen_stopped', 'track no longer live');
        }
      }
    }, LIVENESS_MS);
    return () => clearInterval(id);
  }, [active, screenRequired, push, screenLive]);

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      if (screenRequired) {
        if (!screenLive()) {
          // `ended` does not fire for every way a share can die, so this poll
          // is the backstop — but it must not re-charge the student every
          // 15 s while the share is down. One outage, one violation.
          setScreenState('lost');
          if (!screenDown.current) {
            screenDown.current = true;
            push('screen_stopped', 'track no longer live');
          }
        }
      }
      flush();
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, [active, screenRequired, flush, push, screenLive]);

  // Final flush + release when the attempt ends or the page goes away.
  useEffect(() => {
    if (active) return undefined;
    flush();
    stop();
    return undefined;
  }, [active, flush, stop]);

  useEffect(() => () => { stop(); }, [stop]);

  const ready = (!cameraRequired || cameraState === 'on')
    && (!screenRequired || screenState === 'on')
    && (!micRequired || micState === 'on');

  return {
    start, stop, flush, reportEvent, resumeScreen, resumeCamera, resumeMic, getStreams,
    cameraState, screenState, micState, bodyState, displayCount,
    objectState, ready, cameraError, screenError, micError,
    violations, maxViolations, lastIssue,
    cameraStream: camStream,
    screenStream: scrStream,
    micStream,
  };
}
