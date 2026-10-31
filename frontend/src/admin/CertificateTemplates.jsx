import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';

const TYPE_META = {
  course:    { icon: '🎓', label: 'Course Completion', ring: '#eab308' },
  quiz:      { icon: '📝', label: 'Quiz Excellence',   ring: '#3b82f6' },
  contest:   { icon: '🏆', label: 'Contest Champion',  ring: '#ef4444' },
  milestone: { icon: '💻', label: 'Coding Milestone',  ring: '#10b981' },
  path:      { icon: '🛤️', label: 'Programme completion (legacy)', ring: '#8b5cf6' },
};

const TEXT_FIELDS = [
  { key: 'name',           label: 'Template name',   hint: 'Only you see this', max: 120 },
  { key: 'headline',       label: 'Headline',        hint: 'Big title on the certificate', max: 120 },
  { key: 'recipient_line', label: 'Recipient line',  hint: '“Awarded to”, “Presented to”…', max: 60 },
  { key: 'seal_text',      label: 'Seal text',       hint: 'Inside the round seal', max: 40 },
  { key: 'label',          label: 'Type label',      hint: 'Small eyebrow label', max: 60 },
];

const TOKENS = [
  ['{{student}}', 'Learner name'], ['{{title}}', 'Course / quiz title'], ['{{score}}', 'Score, e.g. 94%'],
  ['{{grade}}', 'Grade, e.g. A+'], ['{{tier}}', 'Tier / rank'], ['{{date}}', 'Issue date'],
  ['{{duration}}', 'Course hours'], ['{{certificate_no}}', 'Certificate number'],
];

const COLOR_GROUPS = [
  { title: 'Background', fields: [['color_bg_from', 'From'], ['color_bg_to', 'To']] },
  { title: 'Accents',    fields: [['color_accent', 'Primary'], ['color_accent_2', 'Light'], ['color_accent_3', 'Deep']] },
  { title: 'Seal',       fields: [['color_seal_from', 'Inner'], ['color_seal_to', 'Outer'], ['color_seal_border', 'Ring']] },
];

/* The certificate renders at a fixed 1100px; give it margin so nothing clips. */
const PREVIEW_W = 1180;
const PREVIEW_H = 840;

const BLANK = {
  name: 'New template', cert_type: 'course',
  headline: 'Certificate of Completion', subtitle: 'has successfully completed the programme',
  recipient_line: 'Awarded to', seal_text: '★ VERIFIED', label: 'Course Completion',
  color_bg_from: '#0f172a', color_bg_to: '#0b1020',
  color_accent: '#fbbf24', color_accent_2: '#fde68a', color_accent_3: '#f59e0b',
  color_seal_from: '#fbbf24', color_seal_to: '#b45309', color_seal_border: '#fde68a',
  is_active: 1,
};

const PRESETS = [
  { name: 'Midnight Gold',  c: ['#0f172a', '#0b1020', '#fbbf24', '#fde68a', '#f59e0b', '#fbbf24', '#b45309', '#fde68a'] },
  { name: 'Ocean Blue',     c: ['#0a1530', '#070f22', '#60a5fa', '#93c5fd', '#22d3ee', '#60a5fa', '#1d4ed8', '#bfdbfe'] },
  { name: 'Violet Nebula',  c: ['#160b2e', '#090418', '#a78bfa', '#ddd6fe', '#7c3aed', '#a78bfa', '#4c1d95', '#ddd6fe'] },
  { name: 'Emerald',        c: ['#06140f', '#040b08', '#4ade80', '#bbf7d0', '#22c55e', '#4ade80', '#166534', '#bbf7d0'] },
  { name: 'Crimson',        c: ['#1a0b10', '#0b0508', '#f87171', '#fecaca', '#fb7185', '#f87171', '#991b1b', '#fecaca'] },
  { name: 'Rose Quartz',    c: ['#2b0d1b', '#140509', '#fb7185', '#fecdd3', '#e11d48', '#fb7185', '#881337', '#fecdd3'] },
  { name: 'Slate Platinum', c: ['#111827', '#030712', '#cbd5e1', '#f1f5f9', '#94a3b8', '#e2e8f0', '#475569', '#f8fafc'] },
  { name: 'Copper',         c: ['#1c0f08', '#0d0704', '#fb923c', '#fed7aa', '#c2410c', '#fb923c', '#7c2d12', '#fed7aa'] },
];
const COLOR_ORDER = ['color_bg_from', 'color_bg_to', 'color_accent', 'color_accent_2', 'color_accent_3', 'color_seal_from', 'color_seal_to', 'color_seal_border'];

export default function CertificateTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);   // null = creating a new one
  const [form, setForm] = useState(BLANK);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);             // {kind, text}
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [zoom, setZoom] = useState(0.5);
  const previewSeq = useRef(0);
  const subtitleRef = useRef(null);

  const flash = useCallback((text, kind = 'success') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async (keepId) => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/certificate-templates');
      const rows = data.data.templates || [];
      setTemplates(rows);
      const pick = rows.find((t) => t.id === keepId) || rows[0];
      if (pick) { setSelectedId(pick.id); setForm(pick); setDirty(false); }
    } catch (e) {
      flash(e.response?.data?.error || e.message, 'error');
    }
    setLoading(false);
  }, [flash]);

  useEffect(() => { load(); }, [load]);

  /* ------- live preview: re-render on every edit, 400 ms after typing stops */
  useEffect(() => {
    const seq = (previewSeq.current += 1);
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const target = selectedId || 'draft';
        const { data } = await api.post(
          `/admin/certificate-templates/preview/${target}`, form, { responseType: 'text' },
        );
        if (seq === previewSeq.current) setPreviewHtml(typeof data === 'string' ? data : '');
      } catch (e) {
        if (seq === previewSeq.current) {
          setPreviewHtml(`<body style="font:15px system-ui;color:#f87171;background:#0b1020;padding:24px">
            Preview unavailable — ${(e.response?.data?.error || e.message || '').toString().replace(/[<>]/g, '')}</body>`);
        }
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form, selectedId]);

  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setDirty(true); };
  function insertToken(tok) {
    const el = subtitleRef.current;
    const cur = form.subtitle || '';
    const at = el ? el.selectionStart ?? cur.length : cur.length;
    set('subtitle', cur.slice(0, at) + tok + cur.slice(el ? el.selectionEnd ?? at : at));
    window.setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(at + tok.length, at + tok.length); } }, 0);
  }
  const applyPreset = (p) => {
    setForm((f) => { const n = { ...f }; COLOR_ORDER.forEach((k, i) => { n[k] = p.c[i]; }); return n; });
    setDirty(true);
  };

  function select(t) {
    if (dirty && !window.confirm('Discard unsaved changes to this template?')) return;
    setSelectedId(t.id); setForm(t); setDirty(false);
  }
  function startNew() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setSelectedId(null); setForm({ ...BLANK }); setDirty(true);
  }

  async function save(makeDefault = false) {
    setSaving(true);
    try {
      const body = { ...form, make_default: makeDefault };
      const { data } = selectedId
        ? await api.put(`/admin/certificate-templates/${selectedId}`, body)
        : await api.post('/admin/certificate-templates', body);
      flash(selectedId ? 'Template saved' : 'Template created');
      setDirty(false);
      await load(data.data.id);
    } catch (e) {
      flash(e.response?.data?.error || e.message, 'error');
    }
    setSaving(false);
  }

  async function act(verb, t) {
    try {
      if (verb === 'default') {
        await api.post(`/admin/certificate-templates/${t.id}/default`);
        flash(`“${t.name}” is now the default for ${TYPE_META[t.cert_type].label}`);
        await load(t.id);
      } else if (verb === 'duplicate') {
        const { data } = await api.post(`/admin/certificate-templates/${t.id}/duplicate`);
        flash('Copy created — edit it freely');
        await load(data.data.id);
      } else if (verb === 'delete') {
        if (!window.confirm(`Delete “${t.name}”? This cannot be undone.`)) return;
        await api.delete(`/admin/certificate-templates/${t.id}`);
        flash('Template deleted');
        await load(null);
      }
    } catch (e) {
      flash(e.response?.data?.error || e.message, 'error');
    }
  }

  const grouped = useMemo(() => {
    const g = {};
    Object.keys(TYPE_META).forEach((k) => { g[k] = []; });
    templates.forEach((t) => { (g[t.cert_type] = g[t.cert_type] || []).push(t); });
    return g;
  }, [templates]);

  const selected = templates.find((t) => t.id === selectedId) || null;
  const builtin = !!selected?.is_builtin;

  if (loading) return <div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div>
      {toast && (
        <div className={`notice ${toast.kind === 'error' ? 'error' : 'success'}`} style={{ marginBottom: 12 }}>
          {toast.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px,300px) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>

        {/* ------------------------------------------------ template list */}
        <div className="panel" style={{ padding: 14, position: 'sticky', top: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <b style={{ color: 'var(--heading)' }}>Designs</b>
            <button className="btn btn-sm btn-primary" onClick={startNew}>+ New</button>
          </div>
          <p className="tiny theme-muted" style={{ margin: '0 0 12px' }}>
            The design flagged <b>Default</b> is what every new <i>and</i> existing certificate of that type renders with.
          </p>

          {Object.entries(TYPE_META).map(([type, meta]) => (
            <div key={type} style={{ marginBottom: 14 }}>
              <div className="tiny" style={{ color: meta.ring, fontWeight: 700, letterSpacing: '.06em', marginBottom: 6 }}>
                {meta.icon} {meta.label.toUpperCase()}
              </div>
              {(grouped[type] || []).length === 0 && <div className="tiny theme-muted" style={{ paddingLeft: 4 }}>No design yet</div>}
              {(grouped[type] || []).map((t) => {
                const active = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => select(t)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 6,
                      padding: '8px 10px', borderRadius: 10,
                      border: `1px solid ${active ? meta.ring : 'var(--border)'}`,
                      background: active ? `${meta.ring}1f` : 'transparent',
                      color: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{
                      width: 22, height: 22, borderRadius: 6, flex: 'none',
                      background: `linear-gradient(135deg,${t.color_accent_2},${t.color_accent},${t.color_accent_3})`,
                      border: `1px solid ${t.color_seal_border}`,
                    }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                      <span className="tiny theme-muted">
                        {t.is_default ? '● Default' : t.is_active ? 'Available' : 'Inactive'}
                        {t.is_builtin ? ' • built-in' : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* -------------------------------------------- editor + preview */}
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>

          {/* preview */}
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <b style={{ color: 'var(--heading)' }}>
                Live preview {previewing && <span className="tiny theme-muted">· rendering…</span>}
              </b>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="tiny theme-muted">Zoom</span>
                <input
                  type="range" min="0.3" max="1" step="0.02" value={zoom} aria-label="Preview zoom"
                  onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 110 }}
                />
                <span className="tiny theme-muted" style={{ width: 34 }}>{Math.round(zoom * 100)}%</span>
              </div>
            </div>
            <div style={{
              background: '#05080f', borderRadius: 12, overflow: 'auto',
              border: '1px solid var(--border)', padding: 12, display: 'grid', placeItems: 'center',
            }}
            >
              <div style={{ width: PREVIEW_W * zoom, height: PREVIEW_H * zoom, overflow: 'hidden', flex: 'none' }}>
                <iframe
                  title="Certificate preview"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin"
                  style={{
                    width: PREVIEW_W, height: PREVIEW_H, border: 0, background: '#0b1020',
                    transform: `scale(${zoom})`, transformOrigin: 'top left',
                  }}
                />
              </div>
            </div>
            <p className="tiny theme-muted" style={{ margin: '8px 0 0' }}>
              Rendered by the real certificate engine with sample data — exactly what a learner will print.
            </p>
          </div>

          {/* editor */}
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <b style={{ color: 'var(--heading)' }}>
                {selectedId ? `Editing: ${selected?.name || ''}` : 'New template'}
                {builtin && <span className="badge" style={{ marginLeft: 8 }}>built-in</span>}
                {dirty && <span className="tiny" style={{ marginLeft: 8, color: 'var(--accent)' }}>• unsaved</span>}
              </b>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selectedId && <button className="btn btn-sm btn-ghost" onClick={() => act('duplicate', selected)}>⧉ Duplicate</button>}
                {selectedId && !selected?.is_default && <button className="btn btn-sm btn-ghost" onClick={() => act('default', selected)}>★ Make default</button>}
                {selectedId && !builtin && !selected?.is_default && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red)', border: '1px solid rgba(239,68,68,.3)' }}
                    onClick={() => act('delete', selected)}
                  >🗑 Delete
                  </button>
                )}
                <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => save(false)}>
                  {saving ? 'Saving…' : selectedId ? '💾 Save' : '＋ Create'}
                </button>
                <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => save(true)} title="Save and use for every certificate of this type">
                  ★ Save &amp; set default
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
              <label className="field">
                <span>Certificate type</span>
                <select
                  className="select" value={form.cert_type} disabled={builtin}
                  onChange={(e) => set('cert_type', e.target.value)}
                >
                  {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
                </select>
                <small className="theme-muted">{builtin ? 'Built-in designs stay on their type — duplicate to move one' : 'Which certificates can use this design'}</small>
              </label>

              {TEXT_FIELDS.map((f) => (
                <label className="field" key={f.key}>
                  <span>{f.label}</span>
                  <input
                    className="input" maxLength={f.max} value={form[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  <small className="theme-muted">{f.hint}</small>
                </label>
              ))}
            </div>

            <label className="field" style={{ marginTop: 12, display: 'block' }}>
              <span>Subtitle line</span>
              <textarea
                className="input" ref={subtitleRef} rows={2} maxLength={255} value={form.subtitle ?? ''}
                onChange={(e) => set('subtitle', e.target.value)}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
              <span className="tiny theme-muted" style={{ fontWeight: 700 }}>INSERT:</span>
              {TOKENS.map(([tok, desc]) => (
                <button
                  key={tok} type="button" className="btn btn-sm btn-ghost" title={desc}
                  onClick={() => insertToken(tok)}
                  style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, padding: '3px 7px' }}
                >{tok}
                </button>
              ))}
            </div>
            <p className="tiny theme-muted" style={{ margin: '6px 0 0' }}>
              Placeholders are replaced with the learner's real data and shown in bold. Anything else is printed as plain
              text — HTML is escaped, so the certificate can never be used to inject markup.
            </p>

            <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 12px' }} />

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <span className="tiny theme-muted" style={{ fontWeight: 700 }}>COLOUR PRESETS</span>
              {PRESETS.map((p) => (
                <button
                  key={p.name} type="button" className="btn btn-sm btn-ghost" onClick={() => applyPreset(p)}
                  title={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: 4,
                    background: `linear-gradient(135deg,${p.c[3]},${p.c[2]},${p.c[4]})`,
                  }}
                  />
                  {p.name}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
              {COLOR_GROUPS.map((g) => (
                <div key={g.title}>
                  <div className="tiny theme-muted" style={{ fontWeight: 700, marginBottom: 8 }}>{g.title.toUpperCase()}</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {g.fields.map(([key, label]) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="color" value={form[key] || '#000000'} aria-label={`${g.title} ${label}`}
                          onChange={(e) => set(key, e.target.value)}
                          style={{ width: 38, height: 30, padding: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', flex: 'none' }}
                        />
                        <span style={{ fontSize: 13, width: 56 }}>{label}</span>
                        <input
                          className="input" value={form[key] || ''} spellCheck="false"
                          onChange={(e) => set(key, e.target.value)}
                          style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, padding: '5px 8px', flex: 1, minWidth: 0 }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {selected?.is_default && (
              <p className="tiny theme-muted" style={{ margin: '14px 0 0' }}>
                ★ This is the live design for <b>{TYPE_META[selected.cert_type].label}</b> — saving changes re-renders every
                certificate of that type instantly, including ones already issued.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
