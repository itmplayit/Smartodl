import { useEffect, useState } from 'react';
import { miscApi } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import { Loader } from '../components/ui';

const GROUP_LABELS = {
  general: '🏷 General branding',
  auth: '🔐 Authentication & OAuth',
  features: '🧩 Feature toggles',
  content: '📚 Content & uploads',
  social: '📞 Contact & social links',
  system: '🛡 System, judge & mail',
  anti_cheat: '🛡 Anti-cheat (live quizzes)',
  payments: '💳 Payments (Razorpay, Paytm & UPI)',
};

export default function SettingsManager() {
  const { reload } = useSettings();
  const toast = useToast();
  const [groups, setGroups] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [activeGroup, setActiveGroup] = useState('');

  const ORDER = ['general', 'features', 'auth', 'content', 'social', 'system'];
  const load = async () => {
    try {
      const { data } = await miscApi.settings();
      const raw = data.data || {};
      const g = {};
      [...ORDER.filter((k) => raw[k]), ...Object.keys(raw).filter((k) => !ORDER.includes(k) && k !== 'landing')].forEach((k) => { g[k] = raw[k]; });
      setGroups(g);
      setActiveGroup(Object.keys(g)[0] || 'general');
      const flat = {};
      Object.values(g).forEach((list) => list.forEach((row) => { flat[row.setting_key] = row.setting_value ?? ''; }));
      setDraft(flat);
    } catch (e) { toast.error(e.message); setGroups({}); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    setBusy(true);
    try {
      await miscApi.updateSettings(draft);
      toast.success('Settings saved — live across the platform');
      await reload();
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const uploadBanner = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBannerBusy(true);
    try {
      const { data } = await miscApi.uploadLandingBanner(file);
      const url = data.data?.url || '';
      setDraft((value) => ({ ...value, landing_banner_image: url, landing_banner_enabled: '1' }));
      toast.success('Landing banner uploaded and enabled');
      await reload();
    } catch (error) { toast.error(error.message); } finally {
      setBannerBusy(false);
      event.target.value = '';
    }
  };

  const removeBanner = async () => {
    if (!window.confirm('Remove the landing banner image?')) return;
    setBannerBusy(true);
    try {
      await miscApi.removeLandingBanner();
      setDraft((value) => ({ ...value, landing_banner_image: '', landing_banner_enabled: '0' }));
      toast.success('Landing banner removed');
      await reload();
    } catch (error) { toast.error(error.message); } finally { setBannerBusy(false); }
  };

  if (!groups) return <Loader label="Loading website settings…" />;

  const list = groups[activeGroup] || [];

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Website configuration</span><h1>Settings</h1>
          <p className="muted small" style={{ marginBottom: 0 }}>Everything here is stored in the database — change site branding, toggles, upload limits and judge behaviour without touching code.</p></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={load}>↺ Reload</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : '💾 Save changes'}</button>
        </div>
      </div>

      <div className="tabs">
        {Object.keys(groups).map((g) => (
          <button key={g} className={`tab ${activeGroup === g ? 'active' : ''}`} onClick={() => setActiveGroup(g)}>
            {GROUP_LABELS[g] || g}
          </button>
        ))}
      </div>

      <div className="card mt">
        <div className="form-grid">
          {list.map((row) => {
            const key = row.setting_key;
            const value = draft[key] ?? '';
            if (key === 'landing_banner_image') {
              return (
                <div className="field full" key={key}>
                  <span>Banner image</span>
                  <div className="admin-banner-setting">
                    {value ? <img src={value} alt="Current landing banner preview" /> : <div className="admin-banner-empty">No banner image uploaded</div>}
                    <div className="admin-banner-actions">
                      <label className={`btn btn-primary ${bannerBusy ? 'disabled' : ''}`}>
                        {bannerBusy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
                        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={bannerBusy} onChange={uploadBanner} />
                      </label>
                      {value && <button type="button" className="btn btn-ghost" disabled={bannerBusy} onClick={removeBanner}>Remove image</button>}
                      <span className="tiny muted">Recommended: 1920 × 640px, JPG or WebP, maximum 8MB.</span>
                    </div>
                  </div>
                  <span className="tiny muted"><code>{key}</code> · uploaded securely to the banner library</span>
                </div>
              );
            }
            const isBool = String(row.input_type || '').toLowerCase() === 'boolean';
            const isOn = ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
            return (
              <label className={`field ${isBool ? '' : 'full'}`} key={key}>
                {row.label || key}
                {isBool ? (
                  <span className="row" style={{ gap: 8, marginTop: 6 }}>
                    <input type="checkbox" checked={isOn}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked ? '1' : '0' }))} />
                    <span className="tiny muted">{isOn ? 'enabled' : 'disabled'}</span>
                  </span>
                ) : String(row.input_type) === 'textarea' ? (
                  <textarea className="textarea" rows="3" value={value} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
                ) : String(row.input_type) === 'select' ? (
                  <select className="select" value={value} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}>
                    {['local', 'judge0', 'disabled'].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="input" type={row.input_type === 'number' ? 'number' : 'text'} value={value}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
                )}
                <span className="tiny muted"><code>{key}</code> · {String(row.input_type || 'text')} · group “{row.group_name}”</span>
              </label>
            );
          })}
          {list.length === 0 && <p className="muted small">This group has no settings.</p>}
        </div>
      </div>

      <div className="soft small mt">💡 Boolean values are stored as <code>1</code>/<code>0</code>. Feature toggles take effect immediately for every visitor — the public site reads them on load.</div>
    </div>
  );
}
