import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { quizApi } from '../services/api';

/**
 * Mobile second-camera companion page.
 *
 * The attempt-bound random token is the only credential: the phone normally
 * has no SmartODL login session. Frames are small thumbnails sent every few
 * seconds to the backend's memory-only live relay; this page never asks the
 * server to store a photo or recording.
 */
export default function SecondCamera() {
  const { token } = useParams();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const sendingRef = useRef(false);
  const wakeLockRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [lastSent, setLastSent] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    quizApi.secondCameraInfo(token)
      .then(({ data }) => { if (!cancelled) setInfo(data.data || null); })
      .catch((e) => { if (!cancelled) setError(e.message || 'This pairing link is invalid or has expired.'); });
    return () => { cancelled = true; };
  }, [token]);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
    setRunning(false);
  }, []);

  /**
   * Keep the phone awake. Wake locks are released by the OS whenever the
   * page is hidden, so the sentinel is held and re-acquired on return —
   * requesting once at start (the old behaviour) let the phone sleep a
   * minute later and silently killed the feed.
   */
  const requestWakeLock = useCallback(async () => {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    if (document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLockRef.current = lock;
      lock.addEventListener('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch (_) { /* unsupported / low battery — the page still works */ }
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running, requestWakeLock]);

  useEffect(() => () => stop(), [stop]);

  const sendFrame = useCallback(async () => {
    const video = videoRef.current;
    const track = streamRef.current && streamRef.current.getVideoTracks()[0];
    if (track && track.readyState !== 'live') {
      stop();
      setError('The phone camera stopped. Tap “Start second camera” to reconnect.');
      return;
    }
    if (!video || !video.videoWidth || sendingRef.current) return;
    sendingRef.current = true;
    try {
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
      const canvas = canvasRef.current;
      const scale = Math.min(1, 320 / video.videoWidth);
      canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL('image/jpeg', 0.55);
      if (image.length <= 320 * 1024) {
        await quizApi.secondCameraFrame(token, image);
        setLastSent(new Date());
        setError('');
      }
    } catch (e) {
      if (e && (e.status === 404 || e.status === 403)) {
        // Pairing link expired/rotated or the feature was switched off:
        // retrying every five seconds will never succeed. Stop and tell
        // the student exactly what to do instead.
        stop();
        setError('This pairing link is no longer active. On the quiz screen, use “Reconnect phone” / “New QR code” and scan the fresh code.');
      } else {
        setError(e.message || 'The second-camera connection was interrupted.');
      }
    } finally {
      sendingRef.current = false;
    }
  }, [token, stop]);

  useEffect(() => {
    if (!running) return undefined;
    sendFrame();
    const id = setInterval(sendFrame, 5000);
    return () => clearInterval(id);
  }, [running, sendFrame]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access requires HTTPS (or localhost) and a supported browser.');
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch (_) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          stop();
          setError('The phone camera stopped. Tap “Start second camera” to reconnect.');
        });
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      await requestWakeLock();
      setRunning(true);
    } catch (e) {
      setError(e.message || 'Camera permission was not granted.');
    } finally {
      setBusy(false);
    }
  };

  const closed = info && info.attempt_status !== 'in_progress';
  const disabled = info && info.enabled === false;

  return (
    <div style={{
      minHeight: '100vh', padding: 20, display: 'grid', placeItems: 'center',
      background: 'radial-gradient(circle at top, #172554, #020617 65%)', color: '#fff',
    }}>
      <main style={{ width: 'min(560px, 100%)', textAlign: 'center' }}>
        <div style={{ fontSize: '3.4rem' }}>📱</div>
        <h1 style={{ margin: '8px 0' }}>Second Camera</h1>
        {info ? (
          <p style={{ color: 'rgba(255,255,255,.78)' }}>
            For <strong>{info.student_name}</strong> · {info.quiz_title}
          </p>
        ) : !error ? <p style={{ color: 'rgba(255,255,255,.78)' }}>Checking pairing link…</p> : null}

        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 18,
            background: '#111827', border: '1px solid rgba(255,255,255,.22)', marginTop: 12,
          }}
        />

        <p style={{ color: 'rgba(255,255,255,.78)', lineHeight: 1.65 }}>
          Place this phone behind or beside you so your face, hands, desk and laptop screen are visible.
          Keep it plugged in and do not close this page during the quiz.
        </p>

        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 10, margin: '12px 0',
            background: 'rgba(127,29,29,.9)', border: '1px solid rgba(252,165,165,.5)',
          }}>
            {error}
          </div>
        )}

        {closed ? (
          <p><strong>This quiz attempt is closed.</strong></p>
        ) : disabled ? (
          <p><strong>The second camera has been switched off for this attempt by the administrator.</strong></p>
        ) : running ? (
          <>
            <div style={{ margin: '14px 0' }}>
              <span style={{
                display: 'inline-block', padding: '7px 12px', borderRadius: 999,
                background: 'rgba(22,163,74,.25)', border: '1px solid rgba(74,222,128,.6)',
              }}>
                🔴 Connected{lastSent ? ` · last frame ${lastSent.toLocaleTimeString()}` : ''}
              </span>
            </div>
            <button className="btn" type="button" onClick={stop}>Stop camera</button>
          </>
        ) : (
          <button className="btn btn-primary" type="button" onClick={start} disabled={busy || !info} style={{ fontSize: '1.05rem' }}>
            {busy ? 'Requesting camera…' : '✅ Start second camera'}
          </button>
        )}

        <p style={{ color: 'rgba(255,255,255,.62)', fontSize: '.84rem', lineHeight: 1.6, marginTop: 16 }}>
          🔒 Live-only: small preview frames are relayed briefly in server memory for the authorised host.
          No photo or video recording is saved.
        </p>
      </main>
    </div>
  );
}
