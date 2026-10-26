import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { noteApi, miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Empty, ErrorBox, Loader, Pagination } from '../components/ui';
import { timeAgo, fmtBytes, fileIcon } from '../utils/format';

const FILE_TYPES = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'image', 'zip'];

export default function Notes() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [notes, setNotes] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(0);
  const [filters, setFilters] = useState({ search: '', file_type: '', category: '', sort: 'created_at', page: 1 });

  const load = async (f = filters) => {
    setNotes(null); setError('');
    try { const { data } = await noteApi.list(f); setNotes(data.data); setMeta(data.meta); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { load(filters); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => { miscApi.categories().then(({ data }) => setCats(data.data)).catch(() => {}); }, []);

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  /** Login-gated download: anonymous users get the exact required message + redirect. */
  const download = async (note) => {
    if (!user) {
      toast.error('Please login to download this material.');
      return navigate('/login', { state: { from: '/notes', reason: 'download' } });
    }
    setBusy(note.id);
    try {
      const res = await noteApi.download(note.id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = note.file_name || `${note.title}.${note.file_type}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Download started');
      load();
    } catch (e) {
      if (e.status === 401) {
        toast.error('Please login to download this material.');
        navigate('/login', { state: { from: '/notes', reason: 'download' } });
      } else toast.error(e.message);
    } finally { setBusy(0); }
  };

  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Study material</span><h1>Notes & resources library</h1>
          <p className="muted small">PDFs, documents, slides, images and archives — downloadable for logged-in students only.</p></div>
      </div>

      {!user && (
        <div className="soft mb row between wrap" style={{ gap: 12 }}>
          <span className="small">🔐 <strong>Please login to download this material.</strong> Browsing is open to everyone.</span>
          <button className="btn btn-sm btn-primary" onClick={() => navigate('/login')}>Login to download</button>
        </div>
      )}

      <div className="card mb">
        <div className="form-grid">
          <label className="field full">🔎 Search notes
            <input className="input" placeholder="Title, subject, topic…" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
          </label>
          <label className="field">File type
            <select className="select" value={filters.file_type} onChange={(e) => set({ file_type: e.target.value })}>
              <option value="">All types</option>
              {FILE_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </select>
          </label>
          <label className="field">Category
            <select className="select" value={filters.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All categories</option>
              {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">Sort by
            <select className="select" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
              <option value="created_at">Newest first</option>
              <option value="download_count">Most downloaded</option>
              <option value="title">Title A → Z</option>
            </select>
          </label>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={() => load()} />}
      {!notes && !error && <Loader label="Fetching notes…" />}
      {notes && notes.length === 0 && <Empty title="No notes found" hint="Try a different search or file type." />}
      {notes && (
        <div className="grid g3">
          {notes.map((n) => (
            <div className="card hover" key={n.id}>
              <div className="between mb-s">
                <span style={{ fontSize: '2rem' }}>{fileIcon(n.file_type)}</span>
                <span className="tag">{n.file_type.toUpperCase()}</span>
              </div>
              <h3 style={{ fontSize: '1rem' }}>{n.title}</h3>
              <p className="tiny muted">{(n.description || '').slice(0, 110)}</p>
              <div className="row wrap tiny muted mt-s" style={{ gap: 10 }}>
                <span>📚 {n.subject || 'General'}</span>
                {n.course_title && <span>📘 {n.course_title}</span>}
                <span>⬇ {n.download_count}</span>
                <span>{fmtBytes(n.file_size)}</span>
              </div>
              <div className="between mt">
                <span className="tiny muted">{timeAgo(n.created_at)} • {n.uploaded_by_name || 'SmartODL'}</span>
                <button className="btn btn-sm btn-primary" disabled={busy === n.id} onClick={() => download(n)}>
                  {busy === n.id ? '…' : user ? '⬇ Download' : '🔒 Download'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {meta && <Pagination meta={meta} onPage={(page) => setFilters((f) => ({ ...f, page }))} />}
    </div>
  );
}
