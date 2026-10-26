import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pagesApi } from '../services/api';

const TYPE_META = {
  legal: { icon: '📄', label: 'Policy page', hint: 'Numbered heading + text sections' },
  faq:   { icon: '❓', label: 'FAQ page',    hint: 'Categories, each with questions' },
};
const GROUPS = [
  ['legal', 'Legal column'],
  ['support', 'Support column'],
  ['none', 'Hidden from footer'],
];
const TOKENS = ['{{site_name}}', '{{contact_email}}', '{{site_tagline}}', '{{contact_address}}', '{{contact_phone}}'];

const BLANK = {
  title: '', eyebrow: '', summary: '', page_type: 'legal',
  footer_group: 'legal', sort_order: 100, is_published: 1,
  body: [{ heading: '', text: '' }],
};

export default function PagesManager() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const flash = useCallback((text, kind = 'success') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async (keepId) => {
    setLoading(true);
    try {
      const { data } = await pagesApi.adminList();
      const rows = data.data.pages || [];
      setPages(rows);
      const pick = rows.find((p) => p.id === keepId) || rows[0];
      if (pick) { setSelectedId(pick.id); setForm(pick); setDirty(false); }
    } catch (e) { flash(e.response?.data?.error || e.message, 'error'); }
    setLoading(false);
  }, [flash]);

  useEffect(() => { load(); }, [load]);

  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setDirty(true); };

  function select(p) {
    if (dirty && !window.confirm('Discard unsaved changes to this page?')) return;
    setSelectedId(p.id); setForm(p); setDirty(false);
  }
  function startNew() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setSelectedId(null); setForm({ ...BLANK, body: [{ heading: '', text: '' }] }); setDirty(true);
  }

  /* ----------------------------------------------------- section editing */
  const setBody = (next) => { setForm((f) => ({ ...f, body: next })); setDirty(true); };
  const patchSection = (i, patch) => setBody(form.body.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addSection = () => setBody([...(form.body || []),
    form.page_type === 'faq' ? { category: '', items: [{ q: '', a: '' }] } : { heading: '', text: '' }]);
  const removeSection = (i) => setBody(form.body.filter((_, j) => j !== i));
  const moveSection = (i, delta) => {
    const next = [...form.body];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setBody(next);
  };
  const patchItem = (si, ii, patch) => patchSection(si, {
    items: form.body[si].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)),
  });
  const addItem = (si) => patchSection(si, { items: [...(form.body[si].items || []), { q: '', a: '' }] });
  const removeItem = (si, ii) => patchSection(si, { items: form.body[si].items.filter((_, j) => j !== ii) });

  /** Switching type converts the sections instead of throwing them away. */
  function changeType(next) {
    if (next === form.page_type) return;
    const converted = next === 'faq'
      ? (form.body || []).map((s) => ({ category: s.category || s.heading || '', items: s.items || [{ q: s.heading || '', a: s.text || '' }] }))
      : (form.body || []).map((s) => ({ heading: s.heading || s.category || '', text: s.text ?? (s.items || []).map((i) => `${i.q} ${i.a}`).join(' ') }));
    setForm((f) => ({ ...f, page_type: next, body: converted }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const { data } = selectedId
        ? await pagesApi.adminUpdate(selectedId, form)
        : await pagesApi.adminCreate(form);
      flash(selectedId ? 'Page saved and live' : 'Page created');
      setDirty(false);
      await load(data.data.id);
    } catch (e) { flash(e.response?.data?.error || e.message, 'error'); }
    setSaving(false);
  }

  async function act(verb, p) {
    try {
      if (verb === 'reset') {
        if (!window.confirm(`Restore “${p.title}” to the wording it shipped with? Your edits will be lost.`)) return;
        await pagesApi.adminReset(p.id);
        flash('Shipped wording restored');
        await load(p.id);
      } else if (verb === 'delete') {
        if (!window.confirm(`Delete “${p.title}”? This cannot be undone.`)) return;
        await pagesApi.adminRemove(p.id);
        flash('Page deleted');
        await load(null);
      } else if (verb === 'publish') {
        await pagesApi.adminUpdate(p.id, { is_published: p.is_published ? 0 : 1 });
        flash(p.is_published ? 'Page unpublished — visitors now get a notice' : 'Page published');
        await load(p.id);
      }
    } catch (e) { flash(e.response?.data?.error || e.message, 'error'); }
  }

  const selected = pages.find((p) => p.id === selectedId) || null;
  const isFaq = form.page_type === 'faq';
  const sectionCount = (form.body || []).length;
  const questionCount = isFaq ? (form.body || []).reduce((n, s) => n + (s.items?.length || 0), 0) : 0;

  if (loading) return <div className="panel" style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  return (
    <div className="page-wrap" style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <div className="eyebrow">ADMIN • CONTENT</div>
        <h1 className="theme-heading" style={{ margin: '8px 0', fontSize: 28 }}>Site Pages</h1>
        <p className="theme-muted" style={{ margin: 0 }}>
          Terms, privacy, refunds, FAQ and the other public information pages. Edits go live immediately —
          no redeploy.
        </p>
      </div>

      {toast && <div className={`notice ${toast.kind === 'error' ? 'error' : 'success'}`} style={{ marginBottom: 12 }}>{toast.text}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px,290px) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>

        {/* ------------------------------------------------------- page list */}
        <div className="panel" style={{ padding: 14, position: 'sticky', top: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <b style={{ color: 'var(--heading)' }}>Pages</b>
            <button className="btn btn-sm btn-primary" onClick={startNew}>+ New</button>
          </div>
          {pages.map((p) => {
            const active = p.id === selectedId;
            return (
              <button
                key={p.id} type="button" onClick={() => select(p)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 6, padding: '9px 10px',
                  borderRadius: 10, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'color-mix(in srgb,var(--accent) 12%,transparent)' : 'transparent',
                  color: 'inherit', display: 'flex', gap: 9, alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 16, flex: 'none' }}>{TYPE_META[p.page_type]?.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                  <span className="tiny theme-muted">
                    /{p.slug}{p.is_published ? '' : ' • draft'}{p.is_builtin ? ' • built-in' : ''}
                  </span>
                </span>
              </button>
            );
          })}
          <p className="tiny theme-muted" style={{ margin: '10px 0 0' }}>
            Built-in pages are wired into the site footer and router. New pages you create are reachable at
            <b> /p/your-slug</b>.
          </p>
        </div>

        {/* ---------------------------------------------------------- editor */}
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <b style={{ color: 'var(--heading)' }}>
              {selectedId ? `Editing: ${selected?.title || ''}` : 'New page'}
              {selected?.is_builtin ? <span className="badge" style={{ marginLeft: 8 }}>built-in</span> : null}
              {dirty && <span className="tiny" style={{ marginLeft: 8, color: 'var(--accent)' }}>• unsaved</span>}
            </b>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selected && (
                <Link className="btn btn-sm btn-ghost" target="_blank" rel="noreferrer"
                  to={selected.is_builtin ? `/${selected.slug}` : `/p/${selected.slug}`}
                >🔗 View live
                </Link>
              )}
              {selected && <button className="btn btn-sm btn-ghost" onClick={() => act('publish', selected)}>{selected.is_published ? '🚫 Unpublish' : '✅ Publish'}</button>}
              {selected?.is_builtin && <button className="btn btn-sm btn-ghost" onClick={() => act('reset', selected)}>↺ Restore shipped text</button>}
              {selected && !selected.is_builtin && (
                <button className="btn btn-sm" onClick={() => act('delete', selected)}
                  style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red)', border: '1px solid rgba(239,68,68,.3)' }}
                >🗑 Delete
                </button>
              )}
              <button className="btn btn-sm btn-primary" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : selectedId ? '💾 Save' : '＋ Create'}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <label className="field">
              <span>Page type</span>
              <select className="select" value={form.page_type} onChange={(e) => changeType(e.target.value)}>
                {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
              </select>
              <small className="theme-muted">{TYPE_META[form.page_type]?.hint}</small>
            </label>
            <label className="field">
              <span>Title</span>
              <input className="input" maxLength={160} value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="field">
              <span>Eyebrow</span>
              <input className="input" maxLength={80} value={form.eyebrow ?? ''} onChange={(e) => set('eyebrow', e.target.value)} />
              <small className="theme-muted">Small label above the title</small>
            </label>
            <label className="field">
              <span>Footer placement</span>
              <select className="select" value={form.footer_group} onChange={(e) => set('footer_group', e.target.value)}>
                {GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Sort order</span>
              <input className="input" type="number" min="0" max="9999" value={form.sort_order ?? 100} onChange={(e) => set('sort_order', e.target.value)} />
              <small className="theme-muted">Lower shows first</small>
            </label>
            <label className="field">
              <span>Visibility</span>
              <select className="select" value={form.is_published ? '1' : '0'} onChange={(e) => set('is_published', e.target.value === '1' ? 1 : 0)}>
                <option value="1">Published</option>
                <option value="0">Draft (hidden)</option>
              </select>
            </label>
          </div>

          <label className="field" style={{ display: 'block', marginTop: 12 }}>
            <span>Summary</span>
            <textarea className="input" rows={2} maxLength={400} value={form.summary ?? ''}
              onChange={(e) => set('summary', e.target.value)} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </label>

          <p className="tiny theme-muted" style={{ margin: '8px 0 0' }}>
            Placeholders usable anywhere on the page: {TOKENS.map((t) => (
              <code key={t} style={{ marginRight: 7 }}>{t}</code>
            ))} — filled in from Website Settings when a visitor opens the page.
          </p>

          <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 12px' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <b style={{ color: 'var(--heading)' }}>
              {isFaq ? `Categories (${sectionCount}) · ${questionCount} questions` : `Sections (${sectionCount})`}
            </b>
            <button className="btn btn-sm btn-ghost" onClick={addSection}>+ Add {isFaq ? 'category' : 'section'}</button>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {(form.body || []).map((sec, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span className="tiny theme-muted" style={{ fontWeight: 700, minWidth: 20 }}>{i + 1}</span>
                  <input
                    className="input" style={{ flex: 1 }} placeholder={isFaq ? 'Category name' : 'Section heading'}
                    value={(isFaq ? sec.category : sec.heading) ?? ''}
                    onChange={(e) => patchSection(i, isFaq ? { category: e.target.value } : { heading: e.target.value })}
                  />
                  <button className="btn btn-sm btn-ghost" onClick={() => moveSection(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => moveSection(i, 1)} disabled={i === sectionCount - 1} aria-label="Move down">↓</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => removeSection(i)} aria-label="Remove">✕</button>
                </div>

                {isFaq ? (
                  <div style={{ display: 'grid', gap: 8, paddingLeft: 28 }}>
                    {(sec.items || []).map((it, j) => (
                      <div key={j} style={{ display: 'grid', gap: 5, borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input className="input" style={{ flex: 1 }} placeholder="Question"
                            value={it.q ?? ''} onChange={(e) => patchItem(i, j, { q: e.target.value })}
                          />
                          <button className="btn btn-sm btn-ghost" onClick={() => removeItem(i, j)} aria-label="Remove question">✕</button>
                        </div>
                        <textarea className="input" rows={2} placeholder="Answer" value={it.a ?? ''}
                          onChange={(e) => patchItem(i, j, { a: e.target.value })}
                          style={{ resize: 'vertical', fontFamily: 'inherit' }}
                        />
                      </div>
                    ))}
                    <button className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => addItem(i)}>+ Add question</button>
                  </div>
                ) : (
                  <textarea
                    className="input" rows={4} placeholder="Section text" value={sec.text ?? ''}
                    onChange={(e) => patchSection(i, { text: e.target.value })}
                    style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
