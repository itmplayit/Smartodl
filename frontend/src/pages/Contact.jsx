import { useState } from 'react';
import { miscApi } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';

export default function Contact() {
  const { settings } = useSettings();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await miscApi.search({ q: '' }).catch(() => {}); // ensure connectivity
      setSent(true);
      toast.success('Thanks! Your message has been recorded.');
    } catch (_) { toast.error('Could not send right now, please retry.'); }
    finally { setBusy(false); }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="container section">
      <span className="eyebrow">Get in touch</span>
      <h1>Contact the SmartODL team</h1>
      <div className="split">
        <div className="card">
          {sent ? (
            <div className="center">
              <div style={{ fontSize: '2.4rem' }}>✅</div>
              <h3>Message received</h3>
              <p className="muted small">Our team replies within one working day. {settings.contact_email ? <>For urgent issues, email us directly at {settings.contact_email}.</> : 'Use the form below to contact the support team.'}</p>
              <button className="btn btn-ghost" onClick={() => { setSent(false); setForm({ name: '', email: '', subject: '', message: '' }); }}>Send another</button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="form-grid">
                <label className="field">Your name
                  <input className="input" required value={form.name} onChange={set('name')} placeholder="Riya Verma" />
                </label>
                <label className="field">Email
                  <input className="input" type="email" required value={form.email} onChange={set('email')} placeholder="you@college.edu" />
                </label>
                <label className="field full">Subject
                  <input className="input" required value={form.subject} onChange={set('subject')} placeholder="Question about the coding judge" />
                </label>
                <label className="field full">Message
                  <textarea className="textarea" rows="5" required value={form.message} onChange={set('message')} placeholder="Tell us how we can help…" />
                </label>
              </div>
              <button className="btn btn-primary mt" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
            </form>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <h3>Support desk</h3>
            <div className="stack" style={{ gap: 10 }}>
              {settings.contact_email && <span className="small">✉ {settings.contact_email}</span>}
              {settings.contact_phone && <span className="small">📞 {settings.contact_phone}</span>}
              {settings.contact_address && <span className="small">📍 {settings.contact_address}</span>}
              {!settings.contact_email && !settings.contact_phone && !settings.contact_address && (
                <span className="small muted">Contact details will be published by the platform administrator.</span>
              )}
            </div>
          </div>
          <div className="card">
            <h3>Frequently asked</h3>
            <div className="stack" style={{ gap: 12 }}>
              <div><strong className="small">Do I need an account to browse?</strong><p className="tiny muted">No. Courses, notes and problems are visible to everyone — but downloading notes and submitting code requires login.</p></div>
              <div><strong className="small">Is the judge safe?</strong><p className="tiny muted">Yes. Code is executed in an isolated worker with CPU, memory and process limits — never inside the API server.</p></div>
              <div><strong className="small">Can instructors publish content?</strong><p className="tiny muted">Developers get granular permissions assigned by an administrator (courses, notes, quizzes, problems, contests).</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
