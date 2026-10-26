import { useCallback, useEffect, useRef, useState } from 'react';
import { debugDetect, detectPeople, detectorState } from '../utils/objectDetector';
import { openCamera, cameraErrorMessage } from '../utils/cameraAccess';

/**
 * Live self-test for webcam proctoring.
 *
 * Exists because "I held a phone up and it didn't detect it" is impossible to
 * diagnose otherwise: an admin cannot tell whether the switch was off, the
 * model was still downloading, the lighting was too poor, or the detector
 * genuinely missed it. This runs the SAME detector the exam uses and shows
 * every class it sees with its confidence, live.
 *
 * Nothing here is recorded or uploaded — it is a mirror, not a session.
 */
export default function ProctorTest() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState('idle');
  const [hits, setHits] = useState([]);
  const [people, setPeople] = useState([]);
  const [best, setBest] = useState(null);
  const [err, setErr] = useState('');

  const stop = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setRunning(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = async () => {
    setErr('');
    try {
      // Exactly the same call the exam makes — a diagnostic that tests
      // something else is worse than no diagnostic. (It used to ask for
      // 320x240 while the exam asked for 640x480.)
      const stream = await openCamera();
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      setRunning(true);
    } catch (e) {
      setErr(cameraErrorMessage(e));
    }
  };

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(async () => {
      setState(detectorState());
      const v = videoRef.current;
      if (!v || !v.videoWidth || busy.current) return;
      busy.current = true;
      try {
        const r = await debugDetect(v, 0.2);
        if (r === null) { setState('failed'); return; }
        setHits(r);
        const detectedPeople = await detectPeople(v);
        if (detectedPeople === null) { setPeople(null); setState('failed'); return; }
        setPeople(detectedPeople);
        const phone = r.find((x) => x.cls === 'cell phone');
        if (phone) setBest((b) => (!b || phone.score > b ? phone.score : b));
      } finally { busy.current = false; }
    }, 1200);
    return () => clearInterval(id);
  }, [running]);

  const LABEL = {
    idle: ['⏳', 'Starting…'],
    loading: ['⏳', 'Downloading the model (~18 MB, one time only)…'],
    ready: ['✅', 'The detector is running'],
    failed: ['⚠️', 'The model could not be loaded — the internet connection or CDN may be blocked'],
  }[state] || ['⏳', '…'];

  return (
    <div className="container section">
      <div className="section-head">
        <h1>📱 Proctoring detection test</h1>
        <p className="muted">
          Hold a phone or book in front of the camera to see what the detector recognises.
          Nothing is saved or uploaded here — this runs only in your browser.
        </p>
      </div>

      <div className="card">
        <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div>
            <video
              ref={videoRef} playsInline muted
              style={{
                width: 320, height: 240, background: '#000', borderRadius: 10,
                transform: 'scaleX(-1)', objectFit: 'cover',
              }}
            />
            <div className="mt-s">
              {!running
                ? <button className="btn btn-primary" onClick={start}>🎥 Start the camera</button>
                : <button className="btn" onClick={stop}>⏹ Stop</button>}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="panel">
              <strong>{LABEL[0]} {LABEL[1]}</strong>
              {state === 'loading' && (
                <div className="tiny muted mt-s">
                  This is needed only the first time; afterwards the browser caches it.
                </div>
              )}
            </div>

            {running && (
              <div className="panel mt-s">
                <strong>What is visible now</strong>
                {hits.length === 0
                  ? <div className="tiny muted mt-s">Nothing yet — bring the phone closer to the camera and increase the lighting.</div>
                  : (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.9 }}>
                      {hits.map((h) => (
                        <li key={h.cls}>
                          <strong>{h.cls}</strong> — {h.score}%
                          {h.watched
                            ? <span className="badge green" style={{ marginLeft: 6 }}>will be recorded</span>
                            : <span className="tiny muted" style={{ marginLeft: 6 }}>(ignore)</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                {best !== null && (
                  <div className="tiny mt-s">
                    Best phone score so far: <strong>{best}%</strong>
                    {best < 55
                      ? ' — this is below 55%, so it will NOT be recorded during an exam. Increase the lighting or bring the phone a little closer to the camera.'
                      : ' — this is above 55%, so it will be recorded during an exam. ✅'}
                  </div>
                )}
              </div>
            )}

            {running && (
              <div className="panel mt-s">
                <strong>🧍 Body/person check</strong>
                <div className="tiny muted mt-s">
                  {people === null
                    ? 'Person check unavailable — the model or inference failed (this is NOT reported as an empty seat during an exam).'
                    : people.length === 0
                      ? 'No person/body detected — move into the frame and increase the lighting.'
                      : `${people.length} person${people.length === 1 ? '' : 's'} detected. Largest frame coverage: ${Math.round(people[0].bbox.width * 100)}% × ${Math.round(people[0].bbox.height * 100)}% (${people[0].score}% confidence).`}
                </div>
              </div>
            )}

            {err && <div className="panel mt-s" style={{ color: 'var(--red, #ef4444)' }}>{err}</div>}

            {/* `.soft` is display:flex with a gap, so every bare text run becomes
                its own flex item and the sentence lays out in columns. One
                child element keeps it a single paragraph. */}
            <div className="soft small mt">
              <span>
                {'💡 During an exam, phone/book detection follows the Webcam switch. Body/person '}
                {'detection additionally requires the Advanced Proctoring master switch and its '}
                {'Body & person detection switch. Object detection runs about every 2 seconds.'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
