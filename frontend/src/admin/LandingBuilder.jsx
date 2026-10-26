import { useEffect, useMemo, useRef, useState } from 'react';
import { miscApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Loader } from '../components/ui';
import Icon from '../components/Icon';
import { BLOCK_TEMPLATES, cloneLandingValue, makeBlock } from '../config/landingBuilder';

const LAYOUT_OPTIONS = {
  banner: [['cinematic', 'Cinematic overlay'], ['content_card', 'Floating content card'], ['minimal', 'Minimal image']],
  hero: [['split', 'Split content + code'], ['centered', 'Centered showcase'], ['text_only', 'Text only']],
  technology: [['marquee', 'Animated marquee'], ['static_grid', 'Static technology grid'], ['compact', 'Compact marquee']],
  quick_services: [['color_bands', 'Colour bands'], ['elevated_cards', 'Elevated cards'], ['icon_tiles', 'Icon tiles'], ['horizontal_list', 'Horizontal list'], ['minimal', 'Minimal outline']],
  programmes: [['finder_first', 'Finder first'], ['courses_first', 'Courses first'], ['compact', 'Compact finder']],
  updates: [['split', 'Split panels'], ['stacked', 'Stacked panels']],
  stats: [['band', 'Full-width band'], ['cards', 'Statistic cards'], ['minimal', 'Minimal numbers']],
  schools: [['visual_cards', 'Visual cards'], ['compact_cards', 'Compact cards'], ['list', 'List layout']],
  competition: [['split', 'Split panels'], ['stacked', 'Stacked panels']],
  student_services: [['tiles', 'Icon tiles'], ['pills', 'Compact pills'], ['list', 'Service list']],
  cta: [['horizontal', 'Horizontal CTA'], ['centered', 'Centered CTA'], ['card', 'Contained card']],
  feature_grid: [['cards', 'Elevated cards'], ['outlined', 'Outlined cards'], ['minimal', 'Minimal columns']],
  image_text: [['split', 'Balanced split'], ['editorial', 'Editorial overlap']],
  content: [['contained', 'Contained copy'], ['centered', 'Centered copy'], ['wide', 'Wide statement']],
};

const humanize = (key) => String(key).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
const getAt = (value, path) => path.reduce((current, key) => current?.[key], value);
const setAt = (value, path, next) => {
  const clone = cloneLandingValue(value); let cursor = clone;
  path.forEach((key, index) => { if (index === path.length - 1) cursor[key] = next; else cursor = cursor[key]; });
  return clone;
};
const blankLike = (value) => {
  if (typeof value === 'string') return '';
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'icon' ? item : blankLike(item)]));
  return '';
};

function ObjectEditor({ value, path, onChange, onMedia, depth = 0 }) {
  if (!value || typeof value !== 'object') return null;
  return <div className={`landing-object-editor depth-${depth}`}>{Object.entries(value).map(([key, item]) => {
    const itemPath = [...path, key];
    if (Array.isArray(item)) return <div className="landing-array-editor" key={key}><div className="landing-field-heading"><strong>{humanize(key)}</strong><button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(itemPath, [...item, item.length ? blankLike(item[item.length - 1]) : ''])}>+ Add item</button></div>
      {item.map((entry, index) => <div className="landing-array-item" key={`${key}-${index}`}><div className="landing-array-item-head"><span>{humanize(key)} {index + 1}</span><div><button type="button" aria-label="Move item up" disabled={index === 0} onClick={() => { const next = [...item]; [next[index-1],next[index]]=[next[index],next[index-1]]; onChange(itemPath,next); }}>↑</button><button type="button" aria-label="Move item down" disabled={index === item.length - 1} onClick={() => { const next=[...item]; [next[index+1],next[index]]=[next[index],next[index+1]]; onChange(itemPath,next); }}>↓</button><button type="button" aria-label="Remove item" onClick={() => onChange(itemPath,item.filter((_,itemIndex)=>itemIndex!==index))}>×</button></div></div>
        {entry && typeof entry === 'object' ? <ObjectEditor value={entry} path={[...itemPath,index]} onChange={onChange} onMedia={onMedia} depth={depth+1} /> : <input className="input" value={entry ?? ''} onChange={(event) => { const next=[...item]; next[index]=event.target.value; onChange(itemPath,next); }} />}
      </div>)}</div>;
    if (item && typeof item === 'object') return <fieldset className="landing-nested-fieldset" key={key}><legend>{humanize(key)}</legend><ObjectEditor value={item} path={itemPath} onChange={onChange} onMedia={onMedia} depth={depth+1} /></fieldset>;
    if (typeof item === 'boolean') return <label className="landing-builder-checkbox" key={key}><input type="checkbox" checked={item} onChange={(event) => onChange(itemPath,event.target.checked)} /><span><strong>{humanize(key)}</strong><small>{item ? 'Enabled' : 'Disabled'}</small></span></label>;
    if (typeof item === 'number') return <label className="field" key={key}>{humanize(key)}<input className="input" type="number" value={item} onChange={(event) => onChange(itemPath,Number(event.target.value))} /></label>;
    if (/(color|background|backgroundDark)$/i.test(key)) return <label className="field" key={key}>{humanize(key)}<span className="landing-color-input"><input type="color" value={/^#[0-9a-f]{6}$/i.test(item) ? item : '#01507c'} onChange={(event) => onChange(itemPath,event.target.value)} /><input className="input" value={item} onChange={(event) => onChange(itemPath,event.target.value)} /></span></label>;
    if (/image$/i.test(key)) return <label className="field full" key={key}>{humanize(key)}<span className="landing-media-input"><input className="input" value={item || ''} onChange={(event) => onChange(itemPath,event.target.value)} placeholder="Choose an uploaded image" /><button className="btn btn-ghost" type="button" onClick={() => onMedia(itemPath)}>Media library</button></span>{item && <img className="landing-field-image" src={item} alt="" />}</label>;
    const multiline = /description|subtitle|message|text/i.test(key) || String(item).length > 90;
    return <label className="field full" key={key}>{humanize(key)}{multiline ? <textarea className="textarea" rows="3" value={item ?? ''} onChange={(event) => onChange(itemPath,event.target.value)} /> : <input className="input" value={item ?? ''} onChange={(event) => onChange(itemPath,event.target.value)} />}</label>;
  })}</div>;
}

function MediaLibrary({ items, busy, onUpload, onSelect, onDelete, onClose }) {
  return <div className="modal-backdrop landing-media-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal landing-media-dialog" role="dialog" aria-modal="true" aria-labelledby="media-library-title"><header><div><span className="eyebrow">Reusable assets</span><h2 id="media-library-title">Landing media library</h2><p>Upload once and reuse the image in any landing-page block.</p></div><button type="button" className="icon-btn" onClick={onClose} aria-label="Close media library">×</button></header><div className="landing-media-toolbar"><label className={`btn btn-primary ${busy ? 'disabled' : ''}`}>{busy ? 'Uploading…' : 'Upload image'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={onUpload} /></label><span>PNG, JPG or WebP · maximum 10MB</span></div><div className="landing-media-grid">{items.map((item) => <article key={item.id}><button type="button" className="landing-media-pick" onClick={() => onSelect(item.url)}><img src={item.url} alt={item.alt_text || item.original_name} /><span>{item.original_name}</span></button><button type="button" className="landing-media-delete" aria-label={`Delete ${item.original_name}`} onClick={() => onDelete(item)}>×</button></article>)}{!items.length && <div className="landing-media-empty"><Icon name="camera" size={32} /><strong>No uploaded landing images yet</strong><span>Upload your first image to build the shared library.</span></div>}</div></section></div>;
}

export default function LandingBuilder() {
  const toast = useToast();
  const previewRef = useRef(null);
  const [payload, setPayload] = useState(null);
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState('__theme');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [device, setDevice] = useState('desktop');
  const [media, setMedia] = useState([]);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaPath, setMediaPath] = useState(null);
  const [dragId, setDragId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [revisions, setRevisions] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = async () => {
    setBusy('load');
    try {
      const [{ data: builderResponse }, { data: mediaResponse }] = await Promise.all([miscApi.landingBuilder(), miscApi.landingMedia()]);
      setPayload(builderResponse.data); setDraft(cloneLandingValue(builderResponse.data.draft)); setMedia(mediaResponse.data || []); setDirty(false);
    } catch (error) { toast.error(error.message); } finally { setBusy(''); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const sendPreview = (document = draft) => {
    if (!document || !previewRef.current?.contentWindow) return;
    previewRef.current.contentWindow.postMessage({ type: 'smartodl:landing-preview', document }, window.location.origin);
  };
  useEffect(() => { const timer = setTimeout(() => sendPreview(draft), 80); return () => clearTimeout(timer); /* eslint-disable-next-line */ }, [draft]);
  useEffect(() => { const ready = (event) => { if (event.origin === window.location.origin && event.data?.type === 'smartodl:landing-preview-ready') sendPreview(); }; window.addEventListener('message',ready); return () => window.removeEventListener('message',ready); });

  const mutate = (updater) => { setDraft((current) => { const next = typeof updater === 'function' ? updater(current) : updater; return next; }); setDirty(true); };
  const selectedIndex = useMemo(() => draft?.sections?.findIndex((section) => section.id === selectedId) ?? -1, [draft, selectedId]);
  const selected = selectedIndex >= 0 ? draft.sections[selectedIndex] : null;
  const updateSelected = (path, value) => mutate((current) => setAt(current, ['sections',selectedIndex,...path], value));
  const updateTheme = (path, value) => mutate((current) => setAt(current, ['theme',...path], value));

  const moveSection = (from, to) => { if (to < 0 || to >= draft.sections.length) return; mutate((current) => { const next=cloneLandingValue(current); const [item]=next.sections.splice(from,1); next.sections.splice(to,0,item); return next; }); };
  const duplicateSection = (index) => mutate((current) => { const next=cloneLandingValue(current); const copy=cloneLandingValue(next.sections[index]); copy.id=`${copy.type}-${Date.now().toString(36)}`; copy.name=`${copy.name} copy`; next.sections.splice(index+1,0,copy); setSelectedId(copy.id); return next; });
  const removeSection = (index) => { if (!window.confirm(`Remove “${draft.sections[index].name}” from this draft?`)) return; mutate((current) => { const next=cloneLandingValue(current); next.sections.splice(index,1); setSelectedId('__theme'); return next; }); };
  const addSection = (type) => { const block=makeBlock(type); mutate((current) => ({...cloneLandingValue(current),sections:[...current.sections,block]})); setSelectedId(block.id); setAddOpen(false); };
  const dropSection = (targetId) => { if (!dragId || dragId === targetId) return; mutate((current) => { const next=cloneLandingValue(current); const from=next.sections.findIndex((item)=>item.id===dragId); const to=next.sections.findIndex((item)=>item.id===targetId); const [item]=next.sections.splice(from,1); next.sections.splice(to,0,item); return next; }); setDragId(''); };

  const saveDraft = async ({ quiet = false } = {}) => {
    setBusy('save');
    try {
      const { data } = await miscApi.saveLandingDraft(draft,payload.draft_version);
      setPayload(data.data); setDraft(cloneLandingValue(data.data.draft)); setDirty(false); if (!quiet) toast.success('Draft saved'); return data.data;
    } catch (error) { toast.error(error.message); return null; } finally { setBusy(''); }
  };
  const publish = async () => {
    if (!window.confirm('Publish this draft to the public landing page?')) return;
    setBusy('publish');
    try {
      let current = payload;
      if (dirty) { const { data } = await miscApi.saveLandingDraft(draft,payload.draft_version); current=data.data; }
      const { data } = await miscApi.publishLandingDraft(current.draft_version);
      setPayload(data.data); setDraft(cloneLandingValue(data.data.draft)); setDirty(false); toast.success('Landing page published successfully');
    } catch (error) { toast.error(error.message); } finally { setBusy(''); }
  };
  const revert = async () => { if (!window.confirm('Discard draft changes and restore the currently published page?')) return; setBusy('revert'); try { const {data}=await miscApi.revertLandingDraft(); setPayload(data.data);setDraft(cloneLandingValue(data.data.draft));setDirty(false);toast.success('Draft restored from published page'); } catch(error){toast.error(error.message);} finally{setBusy('');} };

  const openHistory = async () => { try { const {data}=await miscApi.landingRevisions(); setRevisions(data.data || []); setHistoryOpen(true); } catch(error){toast.error(error.message);} };
  const restoreRevision = async (item) => { if(!window.confirm(`Restore published version ${item.version} into the draft?`)) return; try { const {data}=await miscApi.restoreLandingRevision(item.id); setPayload(data.data);setDraft(cloneLandingValue(data.data.draft));setDirty(false);setHistoryOpen(false);toast.success(`Version ${item.version} restored to draft`); } catch(error){toast.error(error.message);} };

  const openMedia = (path) => { setMediaPath(path); setMediaOpen(true); };
  const chooseMedia = (url) => { if (mediaPath && selectedIndex >= 0) updateSelected(mediaPath,url); setMediaOpen(false); setMediaPath(null); };
  const uploadMedia = async (event) => { const file=event.target.files?.[0]; if(!file)return; setBusy('media'); try { const {data}=await miscApi.uploadLandingMedia(file); setMedia((items)=>[data.data,...items]); toast.success('Image added to media library'); } catch(error){toast.error(error.message);} finally{setBusy('');event.target.value='';} };
  const deleteMedia = async (item) => { if(JSON.stringify(draft).includes(item.url)){toast.error('Replace this image in the current draft before deleting it.');return;} if(!window.confirm(`Delete “${item.original_name}” from the media library?`))return; try{await miscApi.removeLandingMedia(item.id);setMedia((items)=>items.filter((entry)=>entry.id!==item.id));toast.success('Media deleted');}catch(error){toast.error(error.message);} };

  if (!draft || busy === 'load') return <Loader label="Opening landing page builder…" />;
  const previewWidth = { desktop: 1440, tablet: 820, mobile: 390 }[device];
  const unpublished = JSON.stringify(payload.draft) !== JSON.stringify(payload.published);
  const statusText = dirty ? '● Unsaved draft' : unpublished ? '● Draft saved — not published' : `✓ Published version ${payload.published_version} is live`;

  return <div className="landing-builder-shell">
    <header className="landing-builder-topbar"><div><span className="eyebrow">Website experience</span><h1>Landing Page Builder</h1><p>Design visually, save a private draft, preview it, then publish when it is ready.</p></div><div className="landing-builder-publish-actions"><span className={`landing-save-state ${dirty || unpublished ? 'dirty' : ''}`}>{statusText}</span><button className="btn btn-ghost" type="button" onClick={openHistory}>History</button><button className="btn btn-ghost" type="button" onClick={revert} disabled={!!busy}>Revert</button><button className="btn btn-ghost" type="button" onClick={() => saveDraft()} disabled={!!busy || !dirty}>{busy==='save'?'Saving…':'Save draft'}</button><button className="btn btn-primary" type="button" onClick={publish} disabled={!!busy || (!dirty && !unpublished)}>{busy==='publish'?'Publishing…':'Publish page'}</button></div></header>

    <div className="landing-builder-workspace">
      <aside className="landing-builder-sections" aria-label="Landing page sections"><div className="landing-builder-pane-head"><div><strong>Page structure</strong><span>{draft.sections.length} sections</span></div><div className="landing-add-wrap"><button type="button" className="btn btn-sm btn-primary" onClick={()=>setAddOpen((value)=>!value)}>+ Add</button>{addOpen && <div className="landing-add-menu">{Object.entries(BLOCK_TEMPLATES).filter(([,template])=>template).map(([type,template])=><button type="button" key={type} onClick={()=>addSection(type)}><Icon name={type==='hero'?'home':type==='technology'?'code':type==='image_text'?'camera':type==='feature_grid'?'layers':'file'} size={17}/><span>{template.name}</span></button>)}</div>}</div></div>
        <button type="button" className={`landing-section-row theme-row ${selectedId==='__theme'?'active':''}`} onClick={()=>setSelectedId('__theme')}><span className="landing-section-grip">◈</span><span><strong>Global design</strong><small>Colors, width & motion</small></span><Icon name="chevronRight" size={15}/></button>
        <div className="landing-section-list">{draft.sections.map((section,index)=><div key={section.id} draggable onDragStart={()=>setDragId(section.id)} onDragOver={(event)=>event.preventDefault()} onDrop={()=>dropSection(section.id)} className={`landing-section-row ${selectedId===section.id?'active':''} ${section.enabled===false?'is-hidden':''}`}><button type="button" className="landing-section-main" onClick={()=>setSelectedId(section.id)}><span className="landing-section-grip" title="Drag to reorder">⋮⋮</span><span><strong>{section.name}</strong><small>{humanize(section.type)}</small></span></button><button type="button" className="landing-visibility-button" aria-label={section.enabled===false?'Show section':'Hide section'} onClick={()=>mutate((current)=>setAt(current,['sections',index,'enabled'],section.enabled===false))}><Icon name={section.enabled===false?'eyeOff':'eye'} size={16}/></button></div>)}</div>
      </aside>

      <section className="landing-builder-canvas" aria-label="Landing page visual preview"><div className="landing-preview-toolbar"><div className="landing-device-buttons" aria-label="Preview size">{['desktop','tablet','mobile'].map((item)=><button type="button" key={item} className={device===item?'active':''} onClick={()=>setDevice(item)}>{item}</button>)}</div><span>Live draft preview</span><a className="btn btn-sm btn-ghost" href="/landing-preview" target="_blank" rel="noreferrer">Open full preview ↗</a></div><div className={`landing-preview-stage device-${device}`}><iframe ref={previewRef} title="Landing page draft preview" src="/landing-preview?embed=1" onLoad={()=>sendPreview()} style={{width:previewWidth}} /></div></section>

      <aside className="landing-builder-inspector"><div className="landing-builder-pane-head"><div><strong>{selectedId==='__theme'?'Global design':selected?.name}</strong><span>{selectedId==='__theme'?'Shared page styles':humanize(selected?.type || '')}</span></div>{selected && <div className="landing-inspector-actions"><button type="button" title="Move up" disabled={selectedIndex===0} onClick={()=>moveSection(selectedIndex,selectedIndex-1)}>↑</button><button type="button" title="Move down" disabled={selectedIndex===draft.sections.length-1} onClick={()=>moveSection(selectedIndex,selectedIndex+1)}>↓</button><button type="button" title="Duplicate" onClick={()=>duplicateSection(selectedIndex)}>⧉</button><button type="button" title="Remove" onClick={()=>removeSection(selectedIndex)}>×</button></div>}</div>
        <div className="landing-inspector-scroll">{selectedId==='__theme' ? <div className="landing-inspector-group"><h3>Brand & layout</h3><ObjectEditor value={draft.theme} path={[]} onChange={updateTheme} onMedia={openMedia}/></div> : selected ? <><div className="landing-inspector-group"><h3>Section</h3><label className="field">Internal name<input className="input" value={selected.name} onChange={(event)=>updateSelected(['name'],event.target.value)}/></label><label className="landing-builder-checkbox"><input type="checkbox" checked={selected.enabled!==false} onChange={(event)=>updateSelected(['enabled'],event.target.checked)}/><span><strong>Visible on page</strong><small>{selected.enabled!==false?'Published when page goes live':'Hidden in preview and public page'}</small></span></label></div><div className="landing-inspector-group"><h3>Layout & appearance</h3>{LAYOUT_OPTIONS[selected.type]&&<label className="field">Layout style<select className="select" value={selected.style?.layout||LAYOUT_OPTIONS[selected.type][0][0]} onChange={(event)=>updateSelected(['style','layout'],event.target.value)}>{LAYOUT_OPTIONS[selected.type].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><span className="tiny muted">Switch layouts instantly in the live preview.</span></label>}<label className="field">Background<select className="select" value={selected.style?.background || 'default'} onChange={(event)=>updateSelected(['style','background'],event.target.value)}>{['default','soft','brand','dark','accent'].map((value)=><option key={value} value={value}>{humanize(value)}</option>)}</select></label><label className="field">Spacing<select className="select" value={selected.style?.padding || 'normal'} onChange={(event)=>updateSelected(['style','padding'],event.target.value)}>{['none','compact','normal','spacious'].map((value)=><option key={value} value={value}>{humanize(value)}</option>)}</select></label><label className="field">Alignment<select className="select" value={selected.style?.alignment || 'left'} onChange={(event)=>updateSelected(['style','alignment'],event.target.value)}>{['left','center','right'].map((value)=><option key={value} value={value}>{humanize(value)}</option>)}</select></label>{selected.style?.columns!=null&&<label className="field">Columns<input className="input" type="number" min="1" max="6" value={selected.style.columns} onChange={(event)=>updateSelected(['style','columns'],Number(event.target.value))}/></label>}{selected.type==='banner'&&<><label className="field">Height<select className="select" value={selected.style?.height||'medium'} onChange={(event)=>updateSelected(['style','height'],event.target.value)}>{['compact','medium','tall'].map((value)=><option key={value} value={value}>{humanize(value)}</option>)}</select></label><label className="field">Overlay strength<input className="input" type="range" min="0" max="95" value={selected.style?.overlay??78} onChange={(event)=>updateSelected(['style','overlay'],Number(event.target.value))}/><span className="tiny muted">{selected.style?.overlay??78}%</span></label></>}{selected.type==='image_text'&&<label className="field">Image position<select className="select" value={selected.style?.imagePosition||'right'} onChange={(event)=>updateSelected(['style','imagePosition'],event.target.value)}><option value="left">Left</option><option value="right">Right</option></select></label>}</div><div className="landing-inspector-group"><h3>Content</h3><ObjectEditor value={selected.content} path={['content']} onChange={updateSelected} onMedia={openMedia}/></div></> : null}</div>
      </aside>
    </div>

    {mediaOpen && <MediaLibrary items={media} busy={busy==='media'} onUpload={uploadMedia} onSelect={chooseMedia} onDelete={deleteMedia} onClose={()=>{setMediaOpen(false);setMediaPath(null);}}/>}
    {historyOpen && <div className="modal-backdrop landing-history-modal" onMouseDown={(event)=>{if(event.target===event.currentTarget)setHistoryOpen(false);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="landing-history-title"><header><div><span className="eyebrow">Safe publishing</span><h2 id="landing-history-title">Publish history</h2></div><button className="icon-btn" type="button" onClick={()=>setHistoryOpen(false)}>×</button></header><div className="landing-history-list">{revisions.map((item)=><div key={item.id}><span><strong>Version {item.version}</strong><small>{new Date(item.published_at).toLocaleString()}</small></span><button type="button" className="btn btn-sm btn-ghost" onClick={()=>restoreRevision(item)}>Restore to draft</button></div>)}{!revisions.length&&<p className="muted">Publish the page once to create its first saved revision.</p>}</div></section></div>}
  </div>;
}
