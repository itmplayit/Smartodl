import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { miscApi } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import { Loader } from '../components/ui';
import Switch from '../components/Switch';

/**
 * 🎛 Feature Control — one screen for the admin to switch every platform
 * feature ON/OFF. Each switch saves instantly and takes effect everywhere:
 * nav links hide, gated pages show a notice, and the backend blocks the APIs.
 */
const FEATURES = {
  quiz_system_enabled: { icon: '🧠', title: 'Quiz System', desc: 'Quizzes, attempts, results, and certificates' },
  live_quiz_enabled: { icon: '📡', title: 'Live Quizzes', desc: 'Real-time hosting, lobby, and synchronised start' },
  coding_system_enabled: { icon: '💻', title: 'Coding Arena', desc: 'Coding problems, the judge, and submissions' },
  contests_enabled: { icon: '🏆', title: 'Contests', desc: 'Coding contests and rankings' },
  leaderboard_enabled: { icon: '📊', title: 'Leaderboard', desc: 'Platform-wide rankings' },
  achievements_enabled: { icon: '🎖', title: 'Achievements', desc: 'Badges and the achievements page' },
  enable_global_search: { icon: '🔍', title: 'Global Search', desc: 'Site-wide search bar' },
  tab_guard_enabled: { icon: '👁', title: 'Tab Guard (anti-cheat)', desc: 'Tab-switch detection during live quizzes' },
  tab_guard_auto_submit: { icon: '⏱', title: 'Auto-submit on limit', desc: 'Automatically submit the quiz when the strike limit is exceeded' },
  quiz_lockdown_enabled: { icon: '🔒', title: 'Fullscreen Lockdown', desc: 'Locks a live quiz in fullscreen; leaving records a violation, and refresh/DevTools actions are blocked' },
  module_quizzes_enabled: { icon: '📚', title: 'Module quizzes (course ke andar)', desc: 'Har course module ke saath ek quiz — course page par usi module ke andar dikhta hai, aur course ka completion rule isi quiz par chal sakta hai. OFF karne par module quiz banane/link karne ki API bhi band ho jaati hai (sirf chhupna nahi).' },
  module_quiz_anticheat_enabled: { icon: '🛡', title: 'Module quiz anti-cheat (no camera)', desc: 'Module quiz ke attempts par tab guard, fullscreen lockdown, copy-paste block aur screenshot block hamesha ON rakhta hai — creator apni settings se ise kam nahi kar sakta. Webcam aur screen share isme kabhi shamil nahi: module quiz hamesha normal quiz hota hai, live nahi.' },
  quiz_cp_block: { icon: '📋', title: 'Live Quiz copy-paste block', desc: 'Disables copy, cut, paste, and right-click during a live quiz; controlled separately from fullscreen lockdown' },
  coding_arena_cp_block: { icon: '📋', title: 'Coding Arena copy-paste block', desc: 'Disables copy, paste, and cut in Coding Arena (administrator-controlled)' },

  screenshot_block_enabled: { icon: '📸', title: 'Screenshot block', desc: 'Blocks the PrintScreen key in live quizzes and Coding Arena and records a violation' },
  ai_classifier_arena_enabled: { icon: '🤖', title: 'AI detection — Coding Arena', desc: 'Checks Arena submissions for AI use by combining code-style analysis with typing and paste analytics to produce an AI-use percentage' },
  ai_classifier_quiz_enabled: { icon: '🤖', title: 'AI detection — Live Quiz', desc: 'Checks coding and written answers in live quizzes for AI use; the two surfaces are controlled separately' },
  proctor_camera_enabled: { icon: '🎥', title: 'Proctoring — Webcam', desc: 'Requires camera permission during a live quiz. This single switch covers face presence, camera shutdown, a covered lens or darkness, frozen images, and phones, books, or laptops appearing on camera. No photo or video is saved. Unless an Advanced Proctoring live-view switch below is also ON, only events leave the browser. Phone/book detection downloads an approximately 18 MB model on each device the first time (from the CDN, not from your server); without internet access that check is silently skipped and the exam is not interrupted.' },
  proctor_screen_enabled: { icon: '🖥', title: 'Proctoring — Screen share', desc: 'Requires the ENTIRE screen to be shared during a live quiz, not just one tab or window. Stopping the share during the quiz records a violation. No recording is saved; host viewing is controlled separately by the Advanced Proctoring live-view switches.' },
  exam_safe_mode: { icon: '🛑', title: 'Safe Exam Mode', desc: 'A Safe Exam Browser-style kiosk lock: F5, F12, Ctrl+R/W/T/N/P/U, Alt, right-click, and refresh are all blocked during a live quiz' },

  proctor_advanced_enabled: { icon: '🚨', title: 'Advanced Proctoring — MAIN BUTTON', defaultOff: true, desc: 'Master switch for live-only advanced detection and live-view checks below. Turning this ON also enables Webcam, Screen share and those advanced checks; individual checks can then be turned OFF separately. Consent-based saved recording is deliberately controlled by its own independent switch below, and still requires separate student consent. Rules are frozen per attempt when the student opens the paper, so set switches BEFORE the host starts the session — turning a check ON mid-exam never adds it to running attempts.' },
  proctor_body_detection_enabled: { icon: '🧍', title: 'Body & person detection', defaultOff: true, desc: 'Checks in the student browser whether one person/body is visible and properly framed; another person or an empty seat is flagged for the host. Advisory only — browser body detection never counts toward auto-submit.' },
  proctor_head_pose_enabled: { icon: '👀', title: 'Head pose / looking away', defaultOff: true, desc: 'Flags sustained head turns away from the screen where the browser exposes native face geometry. Advisory only; unsupported browsers are reported and produce no pose check.' },
  proctor_live_snapshot_enabled: { icon: '📸', title: 'Live snapshot grid', defaultOff: true, desc: 'Authorised hosts see refreshing camera/screen thumbnails for all running students. Frames remain only briefly in server memory and are never written to disk or the database.' },
  proctor_live_webrtc_enabled: { icon: '🎥', title: 'Live WebRTC camera + screen', defaultOff: true, desc: 'Authorised hosts see live webcam video for all running students and the selected student’s entire screen over encrypted peer-to-peer WebRTC. Nothing is recorded. ICE servers are delivered only to signed-in participants/hosts; on restrictive networks configure TURN via PROCTOR_TURN_URLS / PROCTOR_TURN_SECRET on the server so credentials stay short-lived.' },
  proctor_second_camera_enabled: { icon: '📱', title: 'Mobile second camera', defaultOff: true, desc: 'Students pair a phone by QR code and position it to show themselves, their hands, desk and laptop. The phone feed is live-only and is not saved.' },
  proctor_room_scan_enabled: { icon: '🔄', title: 'Pre-exam room scan', defaultOff: true, desc: 'Before the paper opens, the student slowly shows the room and desk for 10 seconds. With a live-view switch on, the host can observe the scan as it happens; completion is otherwise the student’s attestation. No scan video is saved.' },
  proctor_identity_check_enabled: { icon: '🪪', title: 'Face & ID check', defaultOff: true, desc: 'The student holds their face and institute ID to the camera and completes a self-check. The host can mark a visual verification only when an enabled live camera view is actually available; without Snapshot/WebRTC, no host visual comparison is possible. Only the host can record verification. No identity photo is saved.' },
  proctor_mic_monitoring_enabled: { icon: '🎙️', title: 'Microphone voice activity', defaultOff: true, desc: 'Requires microphone permission and analyzes sound levels locally for sustained voice-level activity. Audio is never uploaded, transcribed or recorded; only an event flag is sent.' },
  proctor_dual_monitor_enabled: { icon: '🖥️', title: 'Multiple display detection', defaultOff: true, desc: 'Flags browsers that report more than one connected display. Support varies by browser and remains advisory; this does not request screen-sharing or screen-capture permission.' },
  proctor_live_warnings_enabled: { icon: '⚠️', title: 'Host live warnings', defaultOff: true, desc: 'Lets the host send an immediate on-screen warning to one selected running student from the Live Proctor Monitor.' },
  proctor_recording_enabled: { icon: '⏺️', title: 'Saved Proctor Recordings', defaultOff: true, desc: 'Independent master ON/OFF for host-requested webcam + full-screen recording. Student must separately consent; only admins can play recordings.' },
  integrity_score_enabled: { icon: '⚖️', title: 'Student Integrity Score', desc: 'Show an admin-only 0–100 review score based on recorded tab-switch and proctor-violation counts. This is not an automatic cheating decision.' },
  certificate_integrity_band_enabled: { icon: '🟢', title: 'Certificate integrity band', desc: 'Show a green / yellow / red integrity review band on course certificates (print page, student certificates list). Built from recorded tab-switch and proctor-violation counts of assessments linked to that course. It never blocks issuance or revokes a certificate.' },
  certificate_integrity_band_public: { icon: '🌐', title: 'Integrity band on public verification', defaultOff: true, desc: 'OFF by default. When ON, anyone using the public verify link or certificate number sees the band. Keep it OFF unless your institution has agreed to publish a review indicator about a named learner.' },
};
const ADVANCED_PROCTOR_KEYS = [
  'proctor_body_detection_enabled',
  'proctor_head_pose_enabled',
  'proctor_live_snapshot_enabled',
  'proctor_live_webrtc_enabled',
  'proctor_second_camera_enabled',
  'proctor_room_scan_enabled',
  'proctor_identity_check_enabled',
  'proctor_mic_monitoring_enabled',
  'proctor_dual_monitor_enabled',
  'proctor_live_warnings_enabled',
];

const SECTIONS = [
  ['⏺️ Saved Proctor Recordings (live quizzes)', ['proctor_recording_enabled']],
  ['⚖️ Student Integrity Score (admin only)', ['integrity_score_enabled', 'certificate_integrity_band_enabled', 'certificate_integrity_band_public']],
  ['🧩 Platform features', ['quiz_system_enabled', 'live_quiz_enabled', 'coding_system_enabled', 'contests_enabled', 'leaderboard_enabled', 'achievements_enabled', 'enable_global_search']],
  ['📚 Module quizzes (course ke andar — alag switch)', ['module_quizzes_enabled', 'module_quiz_anticheat_enabled']],
  ['🛡 Anti-cheat (live quizzes)', ['tab_guard_enabled', 'tab_guard_auto_submit', 'quiz_lockdown_enabled', 'quiz_cp_block', 'screenshot_block_enabled', 'exam_safe_mode', 'ai_classifier_quiz_enabled']],
  ['🎥 Proctoring (live quizzes)', ['proctor_camera_enabled', 'proctor_screen_enabled']],
  ['🚨 Advanced Proctoring (live quizzes · admin only)', ['proctor_advanced_enabled', ...ADVANCED_PROCTOR_KEYS]],
  ['📋 Coding Arena', ['coding_arena_cp_block', 'ai_classifier_arena_enabled']],
];


/**
 * A numeric setting that actually saves.
 *
 * The old fields were uncontrolled inputs wired to onBlur alone, which meant:
 *   • typing a value and pressing Enter did NOTHING (no blur, no request)
 *   • typing a value and clicking away to another page silently lost it
 * and nothing on screen admitted the value had not been stored. Both number
 * fields on this page had it.
 *
 * Now the input is controlled, Enter commits, blur commits, and while a change
 * is pending a Save button is visible so an unsaved value can never look saved.
 */
function LimitField({ icon, label, hint, value, min = 1, max = 20, onSave }) {
  const initial = String(value ?? min);
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);

  // Follow the server once it reports back, but never stomp on live typing.
  useEffect(() => { if (!dirty) setDraft(String(value ?? min)); }, [value, min, dirty]);

  const commit = () => {
    if (!dirty) return;
    const n = Math.min(max, Math.max(min, Number(draft) || min));
    setDraft(String(n));
    setDirty(false);
    onSave(n);
  };

  // Removing a focused element does NOT reliably fire blur, so navigating away
  // mid-edit used to drop the value on the floor. Flush it on unmount instead.
  const pending = useRef(null);
  pending.current = dirty
    ? () => onSave(Math.min(max, Math.max(min, Number(draft) || min)))
    : null;
  useEffect(() => () => { if (pending.current) pending.current(); }, []);

  return (
    <div className="between wrap" style={{ gap: 12 }}>
      <div>
        <strong>{icon} {label}</strong>
        <div className="tiny muted">{hint}</div>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input
          className="input" type="number" min={min} max={max} style={{ width: 90 }}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          onBlur={commit}
        />
        {dirty
          ? <button className="btn btn-primary" onClick={commit}>Save</button>
          : <span className="tiny muted" title="Saved on the server">✓ saved</span>}
      </div>
    </div>
  );
}

export default function FeatureControl() {
  const toast = useToast();
  const { reload } = useSettings();
  const [rows, setRows] = useState(null); // setting_key -> row
  const [saving, setSaving] = useState('');
  const [loadError, setLoadError] = useState('');

  const loadRows = async () => {
    setLoadError('');
    try {
      const { data } = await miscApi.settings();
      const flat = {};
      Object.values(data.data || {}).forEach((list) => list.forEach((r) => { flat[r.setting_key] = r; }));
      setRows(flat);
    } catch (e) {
      setLoadError(e.message || 'Could not load settings. Check your admin session and API connection.');
    }
  };

  useEffect(() => {
    loadRows();
    /* eslint-disable-next-line */
  }, []);

  if (!rows) return loadError
    ? <div className="container section"><div className="card"><h2>Could not load Feature Control</h2><p className="muted">{loadError}</p><button className="btn btn-primary" onClick={loadRows}>Retry</button></div></div>
    : <Loader label="Loading feature controls…" />;

  const isOn = (key) => ['1', 'true', 'yes', 'on'].includes(
    String(rows[key]?.setting_value ?? (FEATURES[key]?.defaultOff ? '0' : '1')).toLowerCase(),
  );

  const setToggle = async (key, value) => {
    if (saving) return;
    const next = value ? '1' : '0';

    // The Advanced Proctoring card is the requested MAIN BUTTON: one action
    // enables the complete package (including its camera/screen prerequisites)
    // while leaving every individual advanced switch independently adjustable.
    if (key === 'proctor_advanced_enabled') {
      const previousRows = rows;
      const payload = { proctor_advanced_enabled: next };
      ADVANCED_PROCTOR_KEYS.forEach((advancedKey) => { payload[advancedKey] = next; });
      if (value) {
        payload.proctor_camera_enabled = '1';
        payload.proctor_screen_enabled = '1';
      }
      setRows((r) => {
        const out = { ...r };
        Object.entries(payload).forEach(([k, v]) => { out[k] = { ...out[k], setting_value: v }; });
        return out;
      });
      setSaving(key);
      try {
        await miscApi.updateSettings(payload);
        await reload();
        toast.success(value
          ? '🚨 Advanced Proctoring ENABLED ✅ — all advanced checks are ON'
          : '🚨 Advanced Proctoring DISABLED ⛔ — advanced checks stopped');
      } catch (e) {
        toast.error(e.message);
        setRows(previousRows);
      } finally { setSaving(''); }
      return;
    }
    setRows((r) => ({ ...r, [key]: { ...r[key], setting_value: next } })); // optimistic
    setSaving(key);
    try {
      await miscApi.updateSettings({ [key]: next });
      await reload();
      const meta = FEATURES[key];
      toast.success(`${meta.icon} ${meta.title} ${value ? 'ENABLED ✅' : 'DISABLED ⛔'} — the change took effect immediately`);
    } catch (e) {
      toast.error(e.message);
      setRows((r) => ({ ...r, [key]: { ...r[key], setting_value: next === '1' ? '0' : '1' } })); // rollback
    } finally { setSaving(''); }
  };

  /** Shared by every numeric limit on this screen, not just the tab guard. */
  const setLimit = async (key, value, icon, what, floor = 1) => {
    const v = String(Math.min(20, Math.max(floor, Number(value) || floor)));
    setRows((r) => ({ ...r, [key]: { ...r[key], setting_value: v } }));
    try {
      await miscApi.updateSettings({ [key]: v });
      await reload();
      toast.success(`${icon} ${what}: ${v}`);
    } catch (e) { toast.error(e.message); }
  };

  const saveIntegrityPenalty = async (key, value, label) => {
    const v = String(Math.max(0, Math.min(100, Math.round(Number(value) || 0))));
    try {
      await miscApi.updateSettings({ [key]: v });
      setRows((r) => ({ ...r, [key]: { ...r[key], setting_value: v } }));
      await reload();
      toast.success(`${label} deduction set to ${v} marks`);
    } catch (e) { toast.error(e.message); }
  };

  const renderFeatureSections = (sections) => sections.map(([title, keys]) => (
    <div className="card mb" key={title}>
      <h3 className="mb-s">{title}</h3>
      <div className="grid g2" style={{ gap: 12 }}>
        {keys.map((key) => {
          const meta = FEATURES[key];
          if (!meta) return null;
          const on = isOn(key);
          return (
            <div className="panel between" key={key} style={{ gap: 10, opacity: saving === key ? 0.6 : 1 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                <span style={{ fontSize: '1.7rem' }}>{meta.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <strong>{meta.title}</strong>
                  <div className="tiny muted">{meta.desc}</div>
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                <span className={`badge ${on ? 'green' : 'red'}`}>{on ? 'ON' : 'OFF'}</span>
                <Switch checked={on} onChange={(value) => setToggle(key, value)} label={`${meta.title}: ${on ? 'enabled' : 'disabled'}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ));

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Admin</span><h2>🎛 Feature Control</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            A master switch for every feature — turning one OFF hides its navigation links, shows a notice on its pages,
            and blocks its backend APIs. <Link className="link" to="/admin/settings">Advanced settings →</Link>
          </p></div>
      </div>

      {renderFeatureSections(SECTIONS.slice(0, 2))}

      <div className="card mb">
        <h3>⚖️ Integrity score mark deductions</h3>
        <p className="tiny muted">Admin-only review score starts at 100 and subtracts these marks per recorded event. Changes recalculate displayed scores, including past attempts. Advisory detections, AI estimates, recording consent and technical failures are excluded.</p>
        <div className="grid g2" style={{ gap: 12 }}>
          <LimitField icon="↔️" label="Deduction per tab switch" min={0} max={100}
            value={rows.integrity_score_tab_switch_penalty?.setting_value ?? 5}
            hint="0 disables this deduction; maximum 100 marks per switch."
            onSave={(n) => saveIntegrityPenalty('integrity_score_tab_switch_penalty', n, 'Tab-switch')} />
          <LimitField icon="🎥" label="Deduction per proctor violation" min={0} max={100}
            value={rows.integrity_score_proctor_violation_penalty?.setting_value ?? 10}
            hint="0 disables this deduction; maximum 100 marks per violation."
            onSave={(n) => saveIntegrityPenalty('integrity_score_proctor_violation_penalty', n, 'Proctor-violation')} />
        </div>

        <div className="between wrap mt" style={{ gap: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div>
            <strong>🟢 Certificate band scope</strong>
            <div className="tiny muted">
              Which attempts feed the green / yellow / red band on a course certificate. Use
              <em> Linked course assessments</em> by default; <em>All monitored attempts</em> only when your
              quizzes are not linked to courses — it is a broader, weaker signal.
            </div>
          </div>
          <select
            className="select" style={{ maxWidth: 280 }}
            value={rows.certificate_integrity_scope?.setting_value ?? 'course'}
            onChange={async (event) => {
              const value = event.target.value;
              try {
                await miscApi.updateSettings({ certificate_integrity_scope: value });
                setRows((r) => ({ ...r, certificate_integrity_scope: { ...r.certificate_integrity_scope, setting_value: value } }));
                await reload();
                toast.success(`Certificate band scope: ${value === 'overall' ? 'all monitored attempts' : 'linked course assessments'}`);
              } catch (e) { toast.error(e.message); }
            }}
          >
            <option value="course">Linked course assessments (recommended)</option>
            <option value="overall">All monitored attempts (last 12 months)</option>
          </select>
        </div>
      </div>

      {renderFeatureSections(SECTIONS.slice(2))}

      <div className="card mb">
        <LimitField
          icon="🗓️" label="Proctor recording retention (days)" min={1} max={3650}
          value={rows.proctor_recording_retention_days?.setting_value ?? 30}
          hint="Choose how long private webcam/screen recordings are kept before automatic deletion (1–3650 days). Default: 30 days."
          onSave={async (n) => {
            const v = String(Math.min(3650, Math.max(1, Math.round(Number(n) || 30))));
            try {
              await miscApi.updateSettings({ proctor_recording_retention_days: v });
              await reload();
              setRows((r) => ({ ...r, proctor_recording_retention_days: { ...r.proctor_recording_retention_days, setting_value: v } }));
              toast.success(`Recording retention set to ${v} days`);
            } catch (e) { toast.error(e.message); }
          }}
        />
      </div>

      <div className="card">
        <LimitField
          icon="👁" label="Max tab-switch strikes" min={1} max={20}
          value={rows.tab_guard_max_violations?.setting_value ?? 3}
          hint="Action is taken after this many violations, according to the auto-submit setting"
          onSave={(n) => setLimit('tab_guard_max_violations', n, '👁', 'Max strikes set')}
        />
      </div>

      {/* Everything camera-side now lives behind one switch, so the only thing
          worth saying here is "go check it actually works on your camera". */}
      {isOn('proctor_camera_enabled') && (
        <div className="card">
          <div className="between wrap" style={{ gap: 12 }}>
            <div>
              <strong>📱 Verify for yourself whether detection is working</strong>
              <div className="tiny muted">
                Hold a phone in front of the camera for a live check of what the detector recognises —
                be sure to do this once before an exam.
              </div>
            </div>
            <Link className="btn" to="/admin/proctor-test">🔎 Detection test</Link>
          </div>
        </div>
      )}

      <div className="card">
        <LimitField
          icon="🚨" label="Auto-submit after N violations (camera and screen combined)" min={0} max={20}
          value={rows.proctor_max_violations?.setting_value ?? 0}
          hint={(
            <>
              {'There is a single combined count — '}
              <strong>both camera and screen-sharing</strong>
              {' faults are added to it: camera stopped, no visible face, covered lens or darkness, '}
              {'frozen image, stopping screen sharing, or sharing only one tab. After this many violations, '}
              {'the quiz will be submitted automatically. '}
              <strong>Set 0 to never auto-submit</strong>
              {' (violations will only be recorded). Phone/book detections do NOT count toward this limit — they are only '}
              {'recorded for the invigilator to review.'}
            </>
          )}
          onSave={(n) => setLimit('proctor_max_violations', n, '🚨', 'Auto-submit limit', 0)}
        />
      </div>

      {/* One child: `.soft` is a flex row with a gap, so loose text nodes each
          become their own column. This line used to render in three pieces. */}
      <div className="soft small mt">
        <span>
          {'💡 These switches apply across the whole site immediately — students will see the new state as soon as they refresh the page. For detailed branding, contact, and Judge settings, use '}
          <Link className="link" to="/admin/settings">Website Settings</Link>
          {'.'}
        </span>
      </div>
    </div>
  );
}
