import { useEffect, useState } from 'react';
import { miscApi, userApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Loader } from '../components/ui';
import Switch from '../components/Switch';

/**
 * 🛡 Anti-Cheating — per-developer control.
 *
 * Anti-cheat used to be one global set of switches: a developer who turned
 * the webcam off for a low-stakes class quiz turned it off for everyone.
 * These switches are now stored per developer and apply ONLY to content that
 * developer created (their quizzes and Coding Arena problems), layered over
 * the administrator's platform defaults. Anything not overridden here simply
 * follows the platform default shown on each card.
 *
 * Administrators additionally get a developer picker, so one particular
 * instructor can be configured without touching the platform defaults.
 */
const FEATURES = {
  tab_guard_enabled: { icon: '👁', title: 'Tab Guard (anti-cheat)', desc: 'Tab-switch detection during live quizzes' },
  tab_guard_auto_submit: { icon: '⏱', title: 'Auto-submit on limit', desc: 'Automatically submit the quiz when the strike limit is exceeded' },
  quiz_lockdown_enabled: { icon: '🔒', title: 'Fullscreen Lockdown', desc: 'Locks a live quiz in fullscreen; leaving records a violation, and refresh/DevTools actions are blocked' },
  quiz_cp_block: { icon: '📋', title: 'Live Quiz copy-paste block', desc: 'Disables copy, cut, paste, and right-click during a live quiz' },
  screenshot_block_enabled: { icon: '📸', title: 'Screenshot block', desc: 'Blocks the PrintScreen key in live quizzes and Coding Arena and records a violation' },
  exam_safe_mode: { icon: '🛑', title: 'Safe Exam Mode', desc: 'Kiosk-style lock: F5, F12, Ctrl+R/W/T/N/P/U, Alt, right-click, and refresh are blocked during a live quiz' },
  ai_classifier_quiz_enabled: { icon: '🤖', title: 'AI detection — Live Quiz', desc: 'Checks coding and written answers in live quizzes for AI use' },
  proctor_camera_enabled: { icon: '🎥', title: 'Proctoring — Webcam', desc: 'Requires camera permission during a live quiz (face presence, covered lens, phones/books on camera). No photo or video is saved — only events.' },
  proctor_screen_enabled: { icon: '🖥', title: 'Proctoring — Screen share', desc: 'Requires the ENTIRE screen to be shared during a live quiz. Stopping the share records a violation. No recording is saved.' },
  coding_arena_cp_block: { icon: '📋', title: 'Coding Arena copy-paste block', desc: 'Disables copy, paste, and cut in the Coding Arena editor' },
  ai_classifier_arena_enabled: { icon: '🤖', title: 'AI detection — Coding Arena', desc: 'Checks Coding Arena submissions for AI use (code style + typing/paste analytics)' },
};
const SECTIONS = [
  ['🛡 Anti-cheat (live quizzes)', ['tab_guard_enabled', 'tab_guard_auto_submit', 'quiz_lockdown_enabled', 'quiz_cp_block', 'screenshot_block_enabled', 'exam_safe_mode', 'ai_classifier_quiz_enabled']],
  ['🎥 Proctoring (live quizzes)', ['proctor_camera_enabled', 'proctor_screen_enabled']],
  ['💻 Coding Arena', ['coding_arena_cp_block', 'ai_classifier_arena_enabled']],
];
/** Runner fallbacks when neither an override nor a global row exists. */
const DEFAULTS = {
  tab_guard_enabled: '1', tab_guard_auto_submit: '1', quiz_lockdown_enabled: '1',
  quiz_cp_block: '1', screenshot_block_enabled: '1', exam_safe_mode: '1',
  ai_classifier_quiz_enabled: '1', coding_arena_cp_block: '1', ai_classifier_arena_enabled: '1',
  proctor_camera_enabled: '0', proctor_screen_enabled: '0',
  tab_guard_max_violations: '3', proctor_max_violations: '0',
};
const NUMBERS = [
  { key: 'tab_guard_max_violations', icon: '👁', label: 'Max tab-switch strikes', min: 1, max: 20, hint: 'Action is taken after this many tab-guard violations, according to the auto-submit setting' },
  { key: 'proctor_max_violations', icon: '🚨', label: 'Auto-submit after N proctoring violations', min: 0, max: 20, hint: 'Camera and screen faults share one count. Set 0 to never auto-submit (violations are only recorded)' },
];

const toBool = (v, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

export default function AntiCheatSettings() {
  const toast = useToast();
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const [data, setData] = useState(null); // { global, overrides, effective }
  const [saving, setSaving] = useState('');
  const [developers, setDevelopers] = useState(null);
  const [targetId, setTargetId] = useState(null); // null = myself
  const [drafts, setDrafts] = useState({}); // numeric field drafts

  const load = async (uid) => {
    try {
      const { data: res } = await miscApi.antiCheat(uid || undefined);
      setData(res.data);
      setDrafts({});
    } catch (e) { toast.error(e.message); }
  };

  useEffect(() => { load(targetId); /* eslint-disable-next-line */ }, [targetId]);

  useEffect(() => {
    if (!isAdmin) return;
    userApi.list({ role: 'developer', limit: 200 })
      .then(({ data: res }) => setDevelopers(res.data || []))
      .catch(() => setDevelopers([]));
  }, [isAdmin]);

  if (!data) return <Loader label="Loading anti-cheat settings…" />;

  const { global, overrides, effective } = data;
  const opts = isAdmin && targetId && Number(targetId) !== Number(user && user.id) ? { user_id: Number(targetId) } : {};
  const isOn = (key) => toBool(effective[key], DEFAULTS[key] === '1');
  const globalOn = (key) => toBool(global[key], DEFAULTS[key] === '1');
  const overridden = (key) => Object.prototype.hasOwnProperty.call(overrides, key);

  const applyResponse = (res) => setData(res.data);

  const setToggle = async (key, value) => {
    if (saving) return;
    const next = value ? '1' : '0';
    const previous = data;
    setData({ ...data, effective: { ...effective, [key]: next }, overrides: { ...overrides, [key]: next } }); // optimistic
    setSaving(key);
    try {
      const { data: res } = await miscApi.updateAntiCheat({ [key]: next }, opts);
      applyResponse(res);
      const meta = FEATURES[key];
      toast.success(`${meta.icon} ${meta.title} ${value ? 'ENABLED ✅' : 'DISABLED ⛔'} — applies to the selected developer's content`);
    } catch (e) {
      toast.error(e.message);
      setData(previous); // rollback
    } finally { setSaving(''); }
  };

  const resetKey = async (key) => {
    if (saving) return;
    setSaving(key);
    try {
      const { data: res } = await miscApi.updateAntiCheat({ [key]: null }, opts);
      applyResponse(res);
      toast.success('↩ Back to the platform default');
    } catch (e) { toast.error(e.message); } finally { setSaving(''); }
  };

  const resetAll = async () => {
    const keys = Object.keys(overrides);
    if (!keys.length || saving) return;
    if (!window.confirm('Remove ALL personal overrides? Every switch will follow the administrator\u2019s platform defaults again.')) return;
    setSaving('all');
    try {
      const patch = Object.fromEntries(keys.map((k) => [k, null]));
      const { data: res } = await miscApi.updateAntiCheat(patch, opts);
      applyResponse(res);
      toast.success('↩ All overrides removed — platform defaults apply everywhere');
    } catch (e) { toast.error(e.message); } finally { setSaving(''); }
  };

  const saveNumber = async (key, min, max) => {
    const raw = drafts[key];
    if (raw === undefined || saving) return;
    const n = Math.min(max, Math.max(min, Number(raw) || min));
    setSaving(key);
    try {
      const { data: res } = await miscApi.updateAntiCheat({ [key]: String(n) }, opts);
      applyResponse(res);
      toast.success(`Saved: ${n}`);
    } catch (e) { toast.error(e.message); } finally { setSaving(''); }
  };

  const targetName = !targetId || Number(targetId) === Number(user && user.id)
    ? 'your'
    : ((developers || []).find((d) => Number(d.id) === Number(targetId)) || {}).full_name || 'the selected developer\u2019s';

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Instructor</span><h2>🛡 Anti-Cheating — Per Developer</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            These switches apply <strong>only to quizzes and coding problems created by the selected developer</strong>,
            layered over the administrator&apos;s platform defaults. Anything you do not override follows the platform
            default shown on each card — other instructors are unaffected.
          </p></div>
      </div>

      {isAdmin && (
        <div className="card mb">
          <div className="between wrap" style={{ gap: 12 }}>
            <div>
              <strong>👤 Configure anti-cheating for</strong>
              <div className="tiny muted">Administrators can set one developer&apos;s switches without changing the platform defaults (Feature Control).</div>
            </div>
            <select
              className="select" style={{ minWidth: 260 }}
              value={targetId || ''}
              onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Myself ({user && user.full_name})</option>
              {(developers || []).filter((d) => Number(d.id) !== Number(user && user.id)).map((d) => (
                <option key={d.id} value={d.id}>{d.full_name} · {d.email}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="soft small mb">
        <span>
          {`🎯 Currently editing ${targetName} content. `}
          {Object.keys(overrides).length
            ? `${Object.keys(overrides).length} personal override(s) active.`
            : 'No personal overrides — everything follows the platform defaults.'}
          {Object.keys(overrides).length > 0 && (
            <> <button className="btn btn-sm btn-ghost" disabled={!!saving} onClick={resetAll}>↩ Reset all to platform defaults</button></>
          )}
        </span>
      </div>

      {SECTIONS.map(([title, keys]) => (
        <div className="card mb" key={title}>
          <h3 className="mb-s">{title}</h3>
          <div className="grid g2" style={{ gap: 12 }}>
            {keys.map((key) => {
              const meta = FEATURES[key];
              const on = isOn(key);
              const mine = overridden(key);
              return (
                <div className="panel between" key={key} style={{ gap: 10, opacity: saving === key ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                    <span style={{ fontSize: '1.7rem' }}>{meta.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{meta.title}</strong>
                      <div className="tiny muted">{meta.desc}</div>
                      <div className="tiny" style={{ marginTop: 4 }}>
                        {mine
                          ? <span className="badge amber">Personal override</span>
                          : <span className="badge">Platform default</span>}
                        <span className="muted"> · Admin default: {globalOn(key) ? 'ON' : 'OFF'}</span>
                        {mine && (
                          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} disabled={!!saving} onClick={() => resetKey(key)}>
                            ↩ Use default
                          </button>
                        )}
                      </div>
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
      ))}

      <div className="card mb">
        <h3 className="mb-s">🚨 Violation Limits</h3>
        {NUMBERS.map(({ key, icon, label, min, max, hint }) => {
          const mine = overridden(key);
          const shown = drafts[key] !== undefined ? drafts[key] : (effective[key] ?? DEFAULTS[key]);
          const dirty = drafts[key] !== undefined && String(drafts[key]) !== String(effective[key] ?? DEFAULTS[key]);
          return (
            <div className="between wrap" key={key} style={{ gap: 12, padding: '8px 0' }}>
              <div>
                <strong>{icon} {label}</strong>
                <div className="tiny muted">{hint}</div>
                <div className="tiny" style={{ marginTop: 4 }}>
                  {mine ? <span className="badge amber">Personal override</span> : <span className="badge">Platform default</span>}
                  <span className="muted"> · Admin default: {global[key] ?? DEFAULTS[key]}</span>
                  {mine && (
                    <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} disabled={!!saving} onClick={() => resetKey(key)}>
                      ↩ Use default
                    </button>
                  )}
                </div>
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  className="input" type="number" min={min} max={max} style={{ width: 90 }}
                  value={shown}
                  onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNumber(key, min, max); } }}
                  onBlur={() => saveNumber(key, min, max)}
                />
                {dirty && <button className="btn btn-sm btn-primary" disabled={!!saving} onClick={() => saveNumber(key, min, max)}>Save</button>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="soft small">
        <span>💡 Changes take effect immediately — including for students already inside a live quiz (open pages re-check these switches automatically). Platform features such as the quiz system itself remain under the administrator&apos;s Feature Control.</span>
      </div>
    </div>
  );
}
