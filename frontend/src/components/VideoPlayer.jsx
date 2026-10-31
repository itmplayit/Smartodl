import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { courseApi } from '../services/api';

/**
 * Lesson video player.
 *
 * UI/UX notes:
 *  - custom control bar (▶/⏸, seek, time, speed, volume, PiP, fullscreen) over the
 *    native <video> element, so the controls match the rest of the app;
 *  - resumes where the learner stopped (coverage position comes from the server);
 *  - keyboard: space/←/→/M/F when the player has focus;
 *  - "watched" progress line that reflects the SLA the course enforces.
 *
 * Access is never decided here: the media route re-checks entitlement on every
 * request, so a copied URL still fails for the wrong learner.
 */

const YOUTUBE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d{4,})/i;

export function classifyVideoUrl(url) {
  const value = String(url || '').trim();
  if (!value) return { kind: 'none' };
  const youtube = value.match(YOUTUBE);
  if (youtube) return { kind: 'embed', provider: 'youtube', id: youtube[1], embedUrl: `https://www.youtube-nocookie.com/embed/${youtube[1]}` };
  const vimeo = value.match(VIMEO);
  if (vimeo) return { kind: 'embed', provider: 'vimeo', id: vimeo[1], embedUrl: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/\.(mp4|m4v|webm|ogv|ogg)(\?|#|$)/i.test(value)) return { kind: 'file', url: value };
  return { kind: 'link', url: value };
}

/** Builds the playable source for an uploaded file (adds the ticket if present). */
export function uploadedSource(media) {
  if (!media || !media.url) return null;
  const query = media.ticket ? `?ticket=${encodeURIComponent(media.ticket)}` : '';
  return `${media.url}${query}`;
}

const HEARTBEAT_MS = 10000;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const clock = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

function ControlButton({ label, children, ...rest }) {
  return (
    <button type="button" className="vp-btn" aria-label={label} title={label} {...rest}>{children}</button>
  );
}

export default function VideoPlayer({ media, externalUrl, title, lessonId, onWatchUpdate, resumeAt = 0 }) {
  const [failed, setFailed] = useState(false);
  const uploaded = uploadedSource(media);
  const external = useMemo(() => classifyVideoUrl(externalUrl), [externalUrl]);

  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const timerRef = useRef(null);
  const lastSentRef = useRef(0);
  const resumedRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const sendBeat = useCallback(async (force = false) => {
    const element = videoRef.current;
    if (!element || !lessonId) return;
    // `playing` is what the server counts watch time from, so a video left
    // running in a hidden/background tab must report playing:false. Without
    // this the 90% completion gate could be satisfied without watching.
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const payload = {
      position: Number(element.currentTime) || 0,
      duration: Number(element.duration) || 0,
      playing: visible && !element.paused && !element.ended,
      rate: Number(element.playbackRate) || 1,
    };
    if (!force && !payload.playing && Math.abs(payload.position - lastSentRef.current) < 1) return;
    lastSentRef.current = payload.position;
    try {
      const { data } = await courseApi.reportWatch(lessonId, payload);
      onWatchUpdate?.(data.data);
    } catch { /* tracking must never break playback */ }
  }, [lessonId, onWatchUpdate]);

  useEffect(() => {
    timerRef.current = setInterval(() => { sendBeat(); }, HEARTBEAT_MS);
    return () => { clearInterval(timerRef.current); sendBeat(true); };
  }, [sendBeat]);

  // Resume where the learner stopped (only once per lesson).
  useEffect(() => {
    const element = videoRef.current;
    if (!element || resumedRef.current || !resumeAt) return;
    resumedRef.current = true;
    const tryResume = () => {
      if (Number.isFinite(element.duration) && resumeAt < element.duration - 3) {
        element.currentTime = resumeAt;
      }
    };
    if (element.readyState >= 1) tryResume();
    else element.addEventListener('loadedmetadata', tryResume, { once: true });
  }, [resumeAt, uploaded]);

  const toggle = useCallback(async () => {
    const element = videoRef.current;
    if (!element) return;
    try {
      if (element.paused) await element.play(); else element.pause();
    } catch { setFailed(true); }
  }, []);

  const seekBy = (delta) => {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = Math.min((element.duration || 0), Math.max(0, element.currentTime + delta));
  };

  const onKeyDown = (event) => {
    const element = videoRef.current;
    if (!element) return;
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === ' ' || event.key === 'k') { event.preventDefault(); toggle(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(5); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-5); }
    else if (event.key === 'm') { element.muted = !element.muted; setMuted(element.muted); }
    else if (event.key === 'f') { shellRef.current?.requestFullscreen?.(); }
  };

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else shellRef.current?.requestFullscreen?.();
  };

  /* ------------------------------ uploaded ------------------------------ */
  if (uploaded) {
    const progress = duration ? (position / duration) * 100 : 0;
    return (
      <div className="vp mb" ref={shellRef} tabIndex={0} onKeyDown={onKeyDown} aria-label={title || 'Lesson video'}>
        <div className="vp-stage" onClick={toggle} role="presentation">
          <video
            key={uploaded}
            ref={videoRef}
            preload="metadata"
            playsInline
            controlsList="nodownload"
            style={{ width: '100%', display: 'block', background: '#000', maxHeight: fullscreen ? '100vh' : '62vh' }}
            onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration || 0); setRate(e.currentTarget.playbackRate || 1); }}
            onTimeUpdate={(e) => {
              const element = e.currentTarget;
              setPosition(element.currentTime || 0);
              if (element.buffered.length) setBuffered(element.buffered.end(element.buffered.length - 1));
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => { setPlaying(false); sendBeat(true); }}
            onEnded={() => { setPlaying(false); sendBeat(true); }}
            onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
            onVolumeChange={(e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted); }}
            onError={() => setFailed(true)}
          >
            <source src={uploaded} type={media.mime || undefined} />
            Your browser cannot play this video. <a href={uploaded}>Download it instead</a>.
          </video>
          {!playing && (
            <button type="button" className="vp-bigplay" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label="Play video">
              ▶
            </button>
          )}
        </div>

        <div className="vp-controls">
          <div
            className="vp-scrub"
            onClick={(event) => {
              const element = videoRef.current;
              const rect = event.currentTarget.getBoundingClientRect();
              if (!element || !rect.width) return;
              element.currentTime = ((event.clientX - rect.left) / rect.width) * (element.duration || 0);
            }}
            role="presentation"
          >
            <span className="vp-scrub-buffer" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
            <span className="vp-scrub-played" style={{ width: `${progress}%` }} />
            <span className="vp-scrub-knob" style={{ left: `${progress}%` }} />
          </div>

          <div className="vp-row">
            <ControlButton label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? '⏸' : '▶'}</ControlButton>
            <ControlButton label="Back 10 seconds" onClick={() => seekBy(-10)}>↺10</ControlButton>
            <ControlButton label="Forward 10 seconds" onClick={() => seekBy(10)}>10↻</ControlButton>
            <span className="vp-time">{clock(position)} <span className="vp-dim">/ {clock(duration)}</span></span>

            <span className="vp-spacer" />

            <label className="vp-speed" title="Playback speed">
              <select
                value={rate}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (videoRef.current) videoRef.current.playbackRate = value;
                  setRate(value);
                }}
                aria-label="Playback speed"
              >
                {SPEEDS.map((value) => <option key={value} value={value}>{value}x</option>)}
              </select>
            </label>

            <ControlButton
              label={muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                const element = videoRef.current;
                if (!element) return;
                element.muted = !element.muted;
              }}
            >
              {muted || volume === 0 ? '🔇' : '🔊'}
            </ControlButton>
            <input
              className="vp-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(event) => {
                const element = videoRef.current;
                if (!element) return;
                const value = Number(event.target.value);
                element.volume = value;
                element.muted = value === 0;
              }}
            />
            <ControlButton
              label="Picture in picture"
              onClick={() => videoRef.current?.requestPictureInPicture?.().catch(() => {})}
            >
              ⧉
            </ControlButton>
            <ControlButton label="Fullscreen" onClick={toggleFullscreen}>{fullscreen ? '⤡' : '⤢'}</ControlButton>
          </div>
        </div>

        {failed && (
          <p className="vp-note">
            Video load nahi hua. Page refresh karein — playback link 5 minute me expire hota hai.
          </p>
        )}
        {media.name && <p className="vp-note">🎬 {media.name}</p>}
      </div>
    );
  }

  /* --------------------------- YouTube / Vimeo --------------------------- */
  if (external.kind === 'embed') {
    return (
      <div className="vp-embed mb">
        <iframe
          src={external.embedUrl}
          title={title || 'Lesson video'}
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <p className="vp-note">
          {external.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video — external player.
          Iski watch-coverage naapi nahi ja sakti; sirf apne upload kiye video par hoti hai.
        </p>
      </div>
    );
  }

  if (external.kind === 'file') {
    return (
      <div className="vp mb">
        <video controls preload="metadata" playsInline style={{ width: '100%', display: 'block', background: '#000', maxHeight: '62vh' }}>
          <source src={external.url} />
          Your browser cannot play this video. <a href={external.url} target="_blank" rel="noreferrer">Open it instead</a>.
        </video>
      </div>
    );
  }

  if (external.kind === 'link') {
    return (
      <p className="small mb">
        🎬 <a className="link" href={external.url} target="_blank" rel="noreferrer">Open lesson video</a>
        <span className="tiny muted"> (external page — player available nahi)</span>
      </p>
    );
  }

  return null;
}
