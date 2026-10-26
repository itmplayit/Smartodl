import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { quizApi } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';

/**
 * Host-side advanced proctoring monitor.
 *
 * Two live transports are supported behind administrator switches:
 *   • Snapshot — students post a small thumbnail every few seconds to the
 *     backend's memory-only relay (nothing is written to disk/database).
 *   • WebRTC — encrypted peer-to-peer media directly from student browser to
 *     this host browser; the API only relays signalling messages.
 *
 * In WebRTC mode slot 0 is always the webcam. Slot 1 is the screen, but the
 * student only attaches the real screen track for the participant selected
 * here; receiving thirty full-screen feeds at once would be wasteful and, on
 * many host connections, impossible.
 */

function LiveVideo({ stream, label, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    video.srcObject = stream || null;
    if (stream) video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      autoPlay
      playsInline
      aria-label={label}
      style={{
        width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#0f172a',
        ...style,
      }}
    />
  );
}

const flagsOf = (row) => String((row && row.proctor_flags) || '').split(',').filter(Boolean);
const randomSessionId = () => {
  if (window.crypto && window.crypto.randomUUID) return `host-${window.crypto.randomUUID()}`;
  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const DEFAULT_FRAME_TTL = { camera: 25000, screen: 45000, second_camera: 30000 };
const parsePolicy = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
};
/**
 * Whether THIS attempt's frozen policy includes an advanced feature.
 * Legacy participants without a snapshot fall back to the global switch
 * (the caller passes it as `fallback`) so old rows keep working.
 */
const policyAllows = (participant, key, fallback = true) => {
  const policy = parsePolicy(participant && participant.proctor_policy);
  if (!policy) return fallback;
  return !!(policy.live && policy.advanced && policy.advanced[key]);
};

export default function LiveProctorMonitor({ quizId, participants = [], active = false }) {
  const { isOn } = useSettings();
  const toast = useToast();
  const master = isOn('proctor_advanced_enabled', false);
  const adv = useCallback((key) => master && isOn(key, false), [master, isOn]);
  const snapshotEnabled = adv('proctor_live_snapshot_enabled');
  const webrtcEnabled = adv('proctor_live_webrtc_enabled');
  const secondEnabled = adv('proctor_second_camera_enabled');
  const identityEnabled = adv('proctor_identity_check_enabled');
  const warningsEnabled = adv('proctor_live_warnings_enabled');

  const [mode, setMode] = useState('snapshot');
  const [frames, setFrames] = useState({});
  const [secondStatuses, setSecondStatuses] = useState({});
  const [streams, setStreams] = useState({});
  const [connections, setConnections] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [warningText, setWarningText] = useState('Please remain seated, visible on camera, and look only at the quiz screen.');
  const [actionBusy, setActionBusy] = useState('');
  const [monitorError, setMonitorError] = useState('');
  const [frameTtl, setFrameTtl] = useState(DEFAULT_FRAME_TTL);
  const [frameNow, setFrameNow] = useState(() => Date.now());
  const [iceServers, setIceServers] = useState(DEFAULT_ICE_SERVERS);

  const sessionIdRef = useRef('');
  if (!sessionIdRef.current) sessionIdRef.current = randomSessionId();
  const peersRef = useRef(new Map());
  const candidatesRef = useRef(new Map());
  const peerMetaRef = useRef(new Map());   // attemptId -> { createdAt, negotiatedScreen }
  const peerRetryRef = useRef(new Map());  // attemptId -> last (re)create timestamp
  const frameSinceRef = useRef(0);
  const streamsRef = useRef({});
  streamsRef.current = streams;
  const participantsRef = useRef([]);
  participantsRef.current = participants;
  const selectedRef = useRef(null);

  const runningParticipants = useMemo(
    () => participants.filter((p) => p.status === 'in_progress'),
    [participants],
  );
  const runningWebrtcParticipants = useMemo(
    () => runningParticipants.filter((p) => policyAllows(p, 'webrtc', true)),
    [runningParticipants],
  );
  const runningWebrtcRef = useRef([]);
  runningWebrtcRef.current = runningWebrtcParticipants;
  const runningKey = runningWebrtcParticipants.map((p) => p.id).join(',');
  const selected = participants.find((p) => String(p.id) === String(selectedId))
    || runningParticipants[0]
    || participants[0]
    || null;
  selectedRef.current = selected ? selected.id : selectedId;

  useEffect(() => {
    if (!selectedId && runningParticipants[0]) setSelectedId(runningParticipants[0].id);
  }, [selectedId, runningParticipants]);

  useEffect(() => {
    if (snapshotEnabled) setMode((m) => (m === 'webrtc' && webrtcEnabled ? m : 'snapshot'));
    else if (webrtcEnabled) setMode('webrtc');
    else setMode('events');
  }, [snapshotEnabled, webrtcEnabled]);

  // ICE servers are fetched per attempt from the authenticated endpoint:
  // the list may contain short-lived TURN credentials and must never ride
  // along in public settings.
  const iceAttemptId = (selected && selected.status === 'in_progress' && selected.id)
    || (runningWebrtcParticipants[0] && runningWebrtcParticipants[0].id)
    || null;
  useEffect(() => {
    if (!webrtcEnabled || !iceAttemptId) return undefined;
    let cancelled = false;
    let timer = null;
    const load = async () => {
      try {
        const { data } = await quizApi.proctorIce(iceAttemptId);
        const d = data.data || {};
        if (cancelled) return;
        if (Array.isArray(d.ice_servers) && d.ice_servers.length) setIceServers(d.ice_servers);
        if (d.expires_at) {
          timer = setTimeout(load, Math.max(30000, new Date(d.expires_at).getTime() - Date.now() - 60000));
        }
      } catch (_) { /* STUN fallback stays in place */ }
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [webrtcEnabled, iceAttemptId]);

  /* ------------------------------- snapshot polling ------------------------------- */
  useEffect(() => {
    if (!quizId || !(snapshotEnabled || secondEnabled)) return undefined;
    let cancelled = false;
    frameSinceRef.current = 0;
    const load = async () => {
      try {
        const { data } = await quizApi.proctorFrames(quizId, frameSinceRef.current);
        if (cancelled) return;
        const payload = data.data || {};
        const incoming = payload.frames || {};
        const incremental = frameSinceRef.current > 0;
        setFrames((prev) => {
          if (!incremental) return incoming;
          // Merge only the feeds that actually changed; a null kind in an
          // incremental entry means "unchanged", not "gone" (expiry is
          // judged per frame by timestamp in freshFrame below).
          const next = { ...prev };
          Object.entries(incoming).forEach(([attemptId, entry]) => {
            const merged = { ...(next[attemptId] || {}) };
            ['camera', 'screen', 'second_camera'].forEach((kind) => {
              if (entry && entry[kind]) merged[kind] = entry[kind];
            });
            merged.updated_at = entry && entry.updated_at;
            next[attemptId] = merged;
          });
          return next;
        });
        if (payload.frame_ttl_ms) setFrameTtl(payload.frame_ttl_ms);
        const serverTime = Number(payload.server_time) || Date.now();
        setFrameNow(serverTime);
        frameSinceRef.current = serverTime;
        setSecondStatuses(payload.second_cameras || {});
        setMonitorError('');
      } catch (e) {
        if (!cancelled) setMonitorError(e.message || 'Live frames could not be loaded.');
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [quizId, snapshotEnabled, secondEnabled]);

  /** A frame is only shown while it is fresh for ITS feed's TTL. */
  const freshFrame = useCallback((frame, kind) => {
    if (!frame || !frame.image) return null;
    const ttl = Number(frameTtl && frameTtl[kind]) || DEFAULT_FRAME_TTL[kind] || 45000;
    const at = Number(frame.at) || 0;
    if (!at || frameNow - at > ttl) return null;
    return frame;
  }, [frameTtl, frameNow]);

  const sendSignal = useCallback((attemptId, payload) => quizApi.proctorSignal(attemptId, {
    session_id: sessionIdRef.current,
    ...payload,
  }).catch(() => {}), []);

  const closePeer = useCallback((attemptId, notify = true) => {
    const key = String(attemptId);
    const pc = peersRef.current.get(key);
    if (pc) {
      if (notify) sendSignal(attemptId, { kind: 'bye' });
      pc.close();
    }
    peersRef.current.delete(key);
    candidatesRef.current.delete(key);
    peerMetaRef.current.delete(key);
    setStreams((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setConnections((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [sendSignal]);

  const closeAllPeers = useCallback(() => {
    Array.from(peersRef.current.keys()).forEach((attemptId) => closePeer(attemptId));
  }, [closePeer]);

  const createPeer = useCallback(async (participant, { focusScreen } = {}) => {
    if (!participant || typeof RTCPeerConnection === 'undefined') return;
    const key = String(participant.id);
    if (peersRef.current.has(key)) return;
    // The screen m-line only becomes sendable when the student can attach
    // the track BEFORE answering. Focus therefore travels with the offer;
    // selecting a student whose peer was negotiated without it recreates
    // that peer (see the selection effect) instead of hoping a later
    // replaceTrack can renegotiate an inactive m-line.
    const focus = focusScreen !== undefined ? !!focusScreen : String(selectedRef.current) === key;

    const pc = new RTCPeerConnection({ iceServers });
    peersRef.current.set(key, pc);
    peerMetaRef.current.set(key, { createdAt: Date.now(), negotiatedScreen: focus });
    peerRetryRef.current.set(key, Date.now());
    setConnections((prev) => ({ ...prev, [key]: 'connecting' }));
    pc.addTransceiver('video', { direction: 'recvonly' }); // camera
    pc.addTransceiver('video', { direction: 'recvonly' }); // screen (focused only)

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(participant.id, {
          kind: 'candidate',
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };
    pc.ontrack = (event) => {
      const stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
      const kind = String(event.transceiver && event.transceiver.mid) === '1' ? 'screen' : 'camera';
      setStreams((prev) => ({
        ...prev,
        [key]: { ...(prev[key] || {}), [kind]: stream },
      }));
    };
    pc.onconnectionstatechange = () => {
      setConnections((prev) => ({ ...prev, [key]: pc.connectionState }));
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        peersRef.current.delete(key);
        peerMetaRef.current.delete(key);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(participant.id, { kind: 'offer', sdp: offer.sdp, focus_screen: focus });
    } catch (_) {
      setConnections((prev) => ({ ...prev, [key]: 'failed' }));
      peersRef.current.delete(key);
      peerMetaRef.current.delete(key);
      pc.close();
    }
  }, [iceServers, sendSignal]);
  const createPeerRef = useRef(null);
  createPeerRef.current = createPeer;

  /* Student answers/candidates arrive through the authenticated SSE hub. */
  useEffect(() => {
    if (mode !== 'webrtc' || !webrtcEnabled) return undefined;
    const onSignal = async (e) => {
      const d = (e && e.detail) || {};
      if (d.from !== 'student' || String(d.session_id) !== sessionIdRef.current) return;
      const key = String(d.attempt_id);
      const pc = peersRef.current.get(key);
      try {
        if (d.kind === 'answer' && pc && d.sdp) {
          await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
          const queued = candidatesRef.current.get(key) || [];
          candidatesRef.current.delete(key);
          for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => {});
          if (String(selectedRef.current) === key) {
            // Only nudge focus on peers whose screen m-line was negotiated
            // with a track; the selection/retry effects recreate the rest
            // with focus carried in a fresh offer.
            const meta = peerMetaRef.current.get(key);
            if (meta && meta.negotiatedScreen) {
              await sendSignal(d.attempt_id, { kind: 'focus', focus_screen: true });
            }
          }
        } else if (d.kind === 'candidate' && d.candidate) {
          if (pc && pc.remoteDescription) await pc.addIceCandidate(d.candidate).catch(() => {});
          else {
            const queued = candidatesRef.current.get(key) || [];
            queued.push(d.candidate);
            candidatesRef.current.set(key, queued.slice(-30));
          }
        } else if (d.kind === 'bye') {
          closePeer(d.attempt_id, false);
        }
      } catch (_) { /* one student's connection must not break the class grid */ }
    };
    window.addEventListener('smartodl:proctor_signal', onSignal);
    return () => window.removeEventListener('smartodl:proctor_signal', onSignal);
  }, [mode, webrtcEnabled, closePeer, sendSignal]);

  /* Create/retire peers as the running participant set changes. */
  useEffect(() => {
    if (mode !== 'webrtc' || !webrtcEnabled || !active) return;
    const wanted = new Set(runningWebrtcParticipants.map((p) => String(p.id)));
    Array.from(peersRef.current.keys()).forEach((attemptId) => {
      if (!wanted.has(String(attemptId))) closePeer(attemptId);
    });
    runningWebrtcParticipants.forEach((participant) => { createPeer(participant); });
    /* eslint-disable-next-line */
  }, [mode, webrtcEnabled, active, runningKey]);

  /* Retry loop: an offer sent before the student's runner was listening
     (consent/preflight still in progress, SSE reconnecting) is gone for
     good — the hub has no mailbox. Peers that never produce a camera, or
     a selected peer negotiated without its screen, are recreated until
     they connect instead of sitting on "connecting" for the whole exam. */
  useEffect(() => {
    if (mode !== 'webrtc' || !webrtcEnabled || !active) return undefined;
    const tick = () => {
      const now = Date.now();
      runningWebrtcRef.current.forEach((participant) => {
        const key = String(participant.id);
        const pc = peersRef.current.get(key);
        const meta = peerMetaRef.current.get(key);
        const lastRetry = peerRetryRef.current.get(key) || 0;
        const recreate = () => {
          if (now - lastRetry < 10000) return;
          peerRetryRef.current.set(key, now);
          if (pc) closePeer(participant.id);
          setTimeout(() => {
            if (createPeerRef.current) {
              createPeerRef.current(participant, {
                focusScreen: String(selectedRef.current) === key,
              });
            }
          }, 250);
        };
        if (!pc) { recreate(); return; }
        const hasCamera = !!(streamsRef.current[key] && streamsRef.current[key].camera);
        const stuck = ['new', 'connecting', 'disconnected'].includes(pc.connectionState)
          && !hasCamera && now - ((meta && meta.createdAt) || now) > 15000;
        const selectedNoScreen = String(selectedRef.current) === key
          && pc.connectionState === 'connected' && meta && !meta.negotiatedScreen;
        if (stuck || selectedNoScreen) recreate();
      });
    };
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [mode, webrtcEnabled, active, closePeer]);

  useEffect(() => {
    if (mode !== 'webrtc') closeAllPeers();
    return () => { if (mode === 'webrtc') closeAllPeers(); };
  }, [mode, closeAllPeers]);

  /* Only the selected student sends an actual screen track. Keyed on the
     selected ID (not the poll-refreshed object) so it runs once per real
     selection change. A selected peer negotiated WITHOUT its screen is
     recreated with focus in the offer; one negotiated WITH it can simply
     be told to resume/pause the track. */
  const selectedKey = selected ? String(selected.id) : '';
  useEffect(() => {
    if (mode !== 'webrtc' || !selectedKey) return;
    peersRef.current.forEach((pc, attemptId) => {
      const key = String(attemptId);
      if (key !== selectedKey) {
        sendSignal(attemptId, { kind: 'focus', focus_screen: false });
        return;
      }
      const meta = peerMetaRef.current.get(key);
      if (meta && !meta.negotiatedScreen) {
        const now = Date.now();
        if (now - (peerRetryRef.current.get(key) || 0) < 10000) return;
        peerRetryRef.current.set(key, now);
        const participant = participantsRef.current.find((p) => String(p.id) === key);
        closePeer(attemptId);
        if (participant) {
          setTimeout(() => {
            if (createPeerRef.current) createPeerRef.current(participant, { focusScreen: true });
          }, 250);
        }
      } else {
        sendSignal(attemptId, { kind: 'focus', focus_screen: true });
      }
    });
  }, [mode, selectedKey, sendSignal, closePeer]);

  const reconnectSelected = async () => {
    if (!selected) return;
    closePeer(selected.id);
    setTimeout(() => createPeer(selected, { focusScreen: true }), 250);
  };

  const sendWarning = async () => {
    if (!selected) return;
    setActionBusy('warning');
    try {
      const { data } = await quizApi.proctorAction(selected.id, { action: 'warning', message: warningText });
      if (data.data && data.data.delivered === false) {
        toast.info(`Warning recorded for ${selected.full_name}, but their browser appears offline right now`);
      } else {
        toast.success(`Warning sent to ${selected.full_name}`);
      }
    } catch (e) {
      toast.error(e.message);
    } finally { setActionBusy(''); }
  };

  const verifyIdentity = async () => {
    if (!selected) return;
    setActionBusy('identity');
    try {
      await quizApi.proctorAction(selected.id, { action: 'verify_identity' });
      toast.success(`Identity verified for ${selected.full_name}`);
    } catch (e) {
      toast.error(e.message);
    } finally { setActionBusy(''); }
  };

  if (!master || !(snapshotEnabled || webrtcEnabled || secondEnabled || warningsEnabled || identityEnabled)) {
    return null;
  }

  const selectedFrames = selected ? (frames[String(selected.id)] || {}) : {};
  const selectedStreams = selected ? (streams[String(selected.id)] || {}) : {};
  const selectedSecond = selected ? (secondStatuses[String(selected.id)] || {}) : {};
  const selectedFlags = flagsOf(selected);
  const identityVerified = selectedFlags.includes('identity_verified');
  const selectedSecondAllowed = secondEnabled && policyAllows(selected, 'second_camera', true);
  const selectedIdentityAllowed = identityEnabled && policyAllows(selected, 'identity', true);
  const selectedWarningsAllowed = warningsEnabled && policyAllows(selected, 'warnings', true);

  const renderFeed = (participant, kind, height = 150) => {
    const frame = frames[String(participant.id)] || {};
    const liveStreams = streams[String(participant.id)] || {};
    if (mode === 'webrtc' && liveStreams[kind]) {
      return <LiveVideo stream={liveStreams[kind]} label={`${participant.full_name} ${kind}`} />;
    }
    const fresh = freshFrame(frame[kind], kind);
    if (fresh) {
      return (
        <img
          src={fresh.image}
          alt={`${participant.full_name} ${kind}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#0f172a' }}
        />
      );
    }
    const staleSeconds = frame[kind] && frame[kind].at
      ? Math.max(0, Math.round((frameNow - Number(frame[kind].at)) / 1000)) : null;
    return (
      <div style={{
        height, display: 'grid', placeItems: 'center', background: '#0f172a', color: '#cbd5e1',
        textAlign: 'center', padding: 12, fontSize: '.82rem',
      }}>
        {participant.status !== 'in_progress'
          ? 'Attempt closed'
          : staleSeconds !== null
            ? `⚠ ${kind} feed stopped — last frame ${staleSeconds}s ago`
            : active ? `Waiting for ${kind}…` : 'Waiting for the host to start'}
      </div>
    );
  };

  return (
    <div className="card mt" aria-label="Live proctor monitor">
      <div className="between wrap mb-s" style={{ gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>🔴 Live Proctor Monitor</h3>
          <div className="tiny muted">
            Live-only authorised view. No photo, video or screen recording is saved.
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {snapshotEnabled && (
            <button type="button" className={`btn btn-sm ${mode === 'snapshot' ? 'btn-primary' : ''}`} onClick={() => setMode('snapshot')}>
              📸 Snapshot grid
            </button>
          )}
          {webrtcEnabled && (
            <button type="button" className={`btn btn-sm ${mode === 'webrtc' ? 'btn-primary' : ''}`} onClick={() => setMode('webrtc')}>
              🎥 Live WebRTC
            </button>
          )}
          <span className="badge">{runningParticipants.length} running</span>
        </div>
      </div>

      {monitorError && <div className="tiny" style={{ color: 'var(--amber, #f59e0b)', marginBottom: 8 }}>{monitorError}</div>}
      {!active && (
        <div className="soft small mb-s">
          <span>Students are still in the lobby. Live feeds begin after “Start for everyone” and each student grants permission.</span>
        </div>
      )}

      {participants.length === 0 ? (
        <div className="tiny muted">No participants to monitor yet.</div>
      ) : (
        <>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}
          >
            {participants.map((p) => {
              const isSelected = selected && String(p.id) === String(selected.id);
              const second = secondStatuses[String(p.id)] || {};
              const f = frames[String(p.id)] || {};
              const secondAllowed = secondEnabled && policyAllows(p, 'second_camera', true);
              const freshSecond = freshFrame(f.second_camera, 'second_camera');
              const flags = flagsOf(p);
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    textAlign: 'left', padding: 0, overflow: 'hidden', borderRadius: 14,
                    border: isSelected ? '2px solid var(--primary, #6366f1)' : '1px solid rgba(127,127,127,.25)',
                    background: 'var(--card, #111827)', color: 'inherit', cursor: 'pointer',
                  }}
                >
                  <div style={{ position: 'relative', height: 150 }}>
                    {renderFeed(p, 'camera')}
                    {secondAllowed && freshSecond && (
                      <img
                        src={freshSecond.image}
                        alt={`${p.full_name} second camera`}
                        style={{
                          position: 'absolute', right: 8, bottom: 8, width: 64, height: 48,
                          objectFit: 'cover', borderRadius: 8, border: '2px solid rgba(255,255,255,.8)',
                        }}
                      />
                    )}
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div className="between" style={{ gap: 6 }}>
                      <strong style={{ fontSize: '.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</strong>
                      {Number(p.proctor_violations) > 0 && <span className="badge red">⚠ {p.proctor_violations}</span>}
                    </div>
                    <div className="tiny muted" style={{ marginTop: 3 }}>
                      {p.status === 'in_progress' ? '● running' : 'submitted/closed'}
                      {mode === 'webrtc' && connections[String(p.id)] ? ` · ${connections[String(p.id)]}` : ''}
                      {secondAllowed ? ` · 📱 ${second.connected ? 'connected' : 'waiting'}` : ''}
                    </div>
                    {flags.length > 0 && (
                      <div className="tiny" style={{ marginTop: 4, color: 'var(--amber, #f59e0b)', wordBreak: 'break-word' }}>
                        {flags.slice(0, 3).join(' · ')}{flags.length > 3 ? '…' : ''}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="panel mt">
              <div className="between wrap" style={{ gap: 10, marginBottom: 10 }}>
                <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                  {selected.avatar && (
                    <img
                      src={selected.avatar}
                      alt=""
                      style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: '50%' }}
                    />
                  )}
                  <div>
                    <strong>{selected.full_name}</strong>
                    <div className="tiny muted">
                      {selected.status} · answered {selected.answered} · proctoring violations {selected.proctor_violations || 0}
                      {selectedFlags.length ? ` · ${selectedFlags.join(', ')}` : ''}
                    </div>
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {mode === 'webrtc' && (
                    <button type="button" className="btn btn-sm" onClick={reconnectSelected}>↻ Reconnect</button>
                  )}
                  {selectedIdentityAllowed && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={verifyIdentity}
                      disabled={actionBusy === 'identity' || identityVerified}
                    >
                      {identityVerified ? '✓ Identity verified' : '🪪 Verify identity'}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <figure style={{ margin: 0 }}>
                  <div style={{ height: 240, borderRadius: 12, overflow: 'hidden' }}>
                    {mode === 'webrtc' && selectedStreams.camera
                      ? <LiveVideo stream={selectedStreams.camera} label="Selected camera" />
                      : renderFeed(selected, 'camera', 240)}
                  </div>
                  <figcaption className="tiny muted" style={{ marginTop: 5 }}>🎥 Webcam</figcaption>
                </figure>
                <figure style={{ margin: 0 }}>
                  <div style={{ height: 240, borderRadius: 12, overflow: 'hidden' }}>
                    {mode === 'webrtc' && selectedStreams.screen
                      ? <LiveVideo stream={selectedStreams.screen} label="Selected screen" />
                      : renderFeed(selected, 'screen', 240)}
                  </div>
                  <figcaption className="tiny muted" style={{ marginTop: 5 }}>🖥️ Entire screen{mode === 'webrtc' ? ' (sent only for the selected student)' : ''}</figcaption>
                </figure>
                {selectedSecondAllowed && (
                  <figure style={{ margin: 0 }}>
                    <div style={{ height: 240, borderRadius: 12, overflow: 'hidden' }}>
                      {freshFrame(selectedFrames.second_camera, 'second_camera') ? (
                        <img
                          src={freshFrame(selectedFrames.second_camera, 'second_camera').image}
                          alt="Selected second camera"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : renderFeed(selected, 'second_camera', 240)}
                    </div>
                    <figcaption className="tiny muted" style={{ marginTop: 5 }}>
                      📱 Mobile second camera · {selectedSecond.connected ? 'connected' : 'waiting/disconnected'}
                    </figcaption>
                  </figure>
                )}
              </div>

              {selectedWarningsAllowed && selected.status === 'in_progress' && (
                <div className="row wrap mt" style={{ gap: 8 }}>
                  <input
                    className="input"
                    value={warningText}
                    onChange={(e) => setWarningText(e.target.value.slice(0, 240))}
                    placeholder="Warning message for this student"
                    style={{ flex: '1 1 320px' }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={sendWarning}
                    disabled={actionBusy === 'warning' || !warningText.trim()}
                  >
                    {actionBusy === 'warning' ? 'Sending…' : '⚠ Send warning'}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
