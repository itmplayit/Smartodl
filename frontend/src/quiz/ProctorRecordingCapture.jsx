import { useCallback, useEffect, useRef, useState } from 'react';
import { quizApi } from '../services/api';

const RECORDING_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
];

function createRecorder(stream) {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support MediaRecorder. Use an up-to-date Chrome, Edge, Firefox, or Safari browser.');
  let recorder = null;
  if (typeof MediaRecorder.isTypeSupported === 'function') {
    const supported = RECORDING_MIME_CANDIDATES.filter((type) => MediaRecorder.isTypeSupported(type));
    for (const mimeType of supported) {
      try { recorder = new MediaRecorder(stream, { mimeType }); break; } catch (_) { /* try the next supported container */ }
    }
  }
  if (!recorder) {
    try { recorder = new MediaRecorder(stream); }
    catch (_) { throw new Error('This browser could not create a video recorder for the active camera/screen stream.'); }
  }
  const mimeType = String(recorder.mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (!['video/webm', 'video/mp4'].includes(mimeType)) {
    throw new Error('This browser is producing an unsupported video format. Update the browser or use Chrome, Edge, Firefox, or Safari with WebM/MP4 recording support.');
  }
  return { recorder, mimeType };
}

/** Student-side, explicit consent + dual-stream recording upload. */
export default function ProctorRecordingCapture({ attemptId, active, getStreams }) {
  const [request, setRequest] = useState(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(null);
  const recordersRef = useRef({});
  const queuesRef = useRef({});
  const indicesRef = useRef({ camera: 0, screen: 0 });
  const mimeTypesRef = useRef({ camera: '', screen: '' });
  const startedAtRef = useRef(0);
  const stoppingRef = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    const onRequest = (event) => {
      const detail = event.detail || {};
      if (String(detail.attempt_id) !== String(attemptId) || !detail.session_id) return;
      setRequest({ sessionId: detail.session_id });
      setError('');
    };
    const onStop = (event) => {
      const detail = event.detail || {};
      if (String(detail.attempt_id) !== String(attemptId)) return;
      if (String(detail.session_id) === String(sessionRef.current) && sessionRef.current) {
        stopRecording(false);
      } else {
        setRequest((current) => (current && String(current.sessionId) === String(detail.session_id) ? null : current));
      }
    };
    window.addEventListener('smartodl:proctor_recording_request', onRequest);
    window.addEventListener('smartodl:proctor_recording_stop', onStop);
    const checkPending = () => quizApi.proctorRecordingStatus(attemptId).then(({ data }) => {
      const latest = data.data;
      if (latest && latest.session_id) {
        if (latest.status === 'stopping' && String(latest.session_id) === String(sessionRef.current)) stopRecording(false);
        if (['interrupted', 'failed', 'cancelled'].includes(latest.status)
          && String(latest.session_id) === String(sessionRef.current)) stopRecording(true);
        setRequest((current) => {
          if (latest.status === 'requested') return current || { sessionId: latest.session_id };
          return current && String(current.sessionId) === String(latest.session_id) ? null : current;
        });
      }
    }).catch(() => {});
    checkPending();
    const timer = setInterval(checkPending, 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('smartodl:proctor_recording_request', onRequest);
      window.removeEventListener('smartodl:proctor_recording_stop', onStop);
    };
    // stopRecording reads mutable refs; it intentionally does not change per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, attemptId]);

  const stopRecording = useCallback(async (interrupted = false) => {
    const sessionId = sessionRef.current;
    if (!sessionId || stoppingRef.current) return;
    stoppingRef.current = true;
    const recorders = Object.values(recordersRef.current);
    const stopped = recorders.map((recorder) => new Promise((resolve) => {
      if (recorder.state === 'inactive') { resolve(); return; }
      recorder.addEventListener('stop', resolve, { once: true });
      try { recorder.stop(); } catch (_) { resolve(); }
    }));
    await Promise.all(stopped);
    await Promise.all(Object.values(queuesRef.current).map((queue) => queue.catch(() => {})));
    const elapsed = Math.max(0, Date.now() - startedAtRef.current);
    try {
      await quizApi.proctorRecordingFinalize(sessionId, {
        interrupted: !!interrupted,
        durations: { camera: elapsed, screen: elapsed },
      });
    } catch (_) { /* cleanup sweep will close an interrupted network loss */ }
    recordersRef.current = {};
    queuesRef.current = {};
    sessionRef.current = null;
    stoppingRef.current = false;
    setRecording(false);
  }, []);

  const consent = async (accepted) => {
    if (!request || busy) return;
    setBusy(true);
    setError('');
    let consentGranted = false;
    try {
      if (!accepted) {
        await quizApi.proctorRecordingConsent(request.sessionId, false);
        setRequest(null);
        return;
      }
      const streams = getStreams ? getStreams() : {};
      const feeds = { camera: streams.camera, screen: streams.screen };
      if (!feeds.camera || !feeds.screen
        || !feeds.camera.getVideoTracks().some((track) => track.readyState === 'live')
        || !feeds.screen.getVideoTracks().some((track) => track.readyState === 'live')) {
        throw new Error('Camera and full-screen sharing must both be active before recording can start.');
      }
      const created = {};
      const mimeTypes = {};
      for (const feed of ['camera', 'screen']) {
        const { recorder, mimeType } = createRecorder(feeds[feed]);
        mimeTypes[feed] = mimeType;
        created[feed] = recorder;
      }
      // Persist consent only after both recorders have been successfully
      // constructed, and tell the server the exact container for each feed.
      await quizApi.proctorRecordingConsent(request.sessionId, true, mimeTypes);
      consentGranted = true;
      mimeTypesRef.current = mimeTypes;
      sessionRef.current = request.sessionId;
      indicesRef.current = { camera: 0, screen: 0 };
      queuesRef.current = { camera: Promise.resolve(), screen: Promise.resolve() };
      startedAtRef.current = Date.now();
      stoppingRef.current = false;
      for (const feed of ['camera', 'screen']) {
        feeds[feed].getVideoTracks().forEach((track) => track.addEventListener('ended', () => stopRecording(true), { once: true }));
        const recorder = created[feed];
        recorder.ondataavailable = (event) => {
          if (!event.data || event.data.size < 1) return;
          const index = indicesRef.current[feed]++;
          queuesRef.current[feed] = queuesRef.current[feed]
            .then(() => quizApi.proctorRecordingChunk(request.sessionId, feed, index, event.data, mimeTypesRef.current[feed]))
            .catch((uploadError) => {
              setError(`${feed === 'camera' ? 'Webcam' : 'Screen'} upload failed: ${uploadError.message || 'server rejected a recording chunk.'}`);
              setTimeout(() => stopRecording(true), 0);
              throw uploadError;
            });
        };
        recorder.onerror = () => { setError('A recording stream stopped unexpectedly.'); stopRecording(true); };
      }
      recordersRef.current = created;
      Object.values(created).forEach((recorder) => recorder.start(1000));
      setRequest(null);
      setRecording(true);
    } catch (e) {
      if (consentGranted) {
        if (sessionRef.current) await stopRecording(true);
        else await quizApi.proctorRecordingFinalize(request.sessionId, { interrupted: true, durations: {} }).catch(() => {});
      }
      setError(e.message || 'Could not start recording.');
      // Keep the consent dialog open for preflight/temporary API failures so
      // the student can retry or explicitly decline. Once consent reached the
      // server, close it after the capture is finalized.
      if (consentGranted) setRequest(null);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!active && sessionRef.current) stopRecording(true);
  }, [active, stopRecording]);

  useEffect(() => () => {
    if (sessionRef.current) stopRecording(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {recording && (
        <div role="status" aria-live="polite" style={{
          position: 'fixed', top: 12, right: 14, zIndex: 3500, padding: '8px 12px',
          borderRadius: 999, background: '#991b1b', color: '#fff', fontWeight: 700,
          boxShadow: '0 4px 18px rgba(0,0,0,.35)',
        }}>⏺ RECORDING — webcam + screen</div>
      )}
      {request && (
        <div role="dialog" aria-modal="true" aria-labelledby="recording-consent-title" style={{
          position: 'fixed', inset: 0, zIndex: 5000, display: 'grid', placeItems: 'center', padding: 20,
          background: 'rgba(2,6,23,.92)', color: '#fff', textAlign: 'center',
        }}>
          <div style={{ maxWidth: 560, padding: 24, borderRadius: 16, background: '#111827', border: '1px solid #475569' }}>
            <div style={{ fontSize: '2.7rem' }}>⏺️</div>
            <h2 id="recording-consent-title">Host requested a saved recording</h2>
            <p>The host is asking to record <strong>both your webcam and full screen</strong> for this attempt. Nothing is uploaded unless you choose Allow.</p>
            <p className="tiny muted">If you allow, the video is sent to private app-server storage for the institution’s configured retention period. Playback is restricted to administrators. A visible recording indicator will remain on screen. You may decline; the request will be recorded as declined.</p>
            {error && <div role="alert" style={{ color: '#fca5a5', margin: '12px 0' }}>{error}</div>}
            <div className="row wrap" style={{ justifyContent: 'center', gap: 10, marginTop: 18 }}>
              <button className="btn" type="button" disabled={busy} onClick={() => consent(false)}>Decline</button>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => consent(true)}>{busy ? 'Starting…' : 'Allow recording'}</button>
            </div>
          </div>
        </div>
      )}
      {error && !request && !recording && <div role="status" className="tiny" style={{ position: 'fixed', top: 12, right: 14, zIndex: 3500, background: '#7f1d1d', color: 'white', padding: 8, borderRadius: 8 }}>{error}</div>}
    </>
  );
}
