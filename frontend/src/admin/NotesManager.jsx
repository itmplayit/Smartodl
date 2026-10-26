import { useEffect, useState } from 'react';
import { noteApi, courseApi, miscApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import FileUploadField from '../components/FileUploadField';
import { Empty, Loader, Modal, StatusBadge } from '../components/ui';
import { fmtBytes, timeAgo, fileIcon } from '../utils/format';

const FILE_TYPES = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'image', 'zip', 'txt', 'md'];

/** Notes manager: upload (multipart), publish/unpublish, download and delete. */
export default function NotesManager({ scope = 'admin' }) {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [courses, setCourses] = useState([]);
  const [cats, setCats] = useState([]);
  const [filters, setFilters] = useState({ search: '', file_type: '', status: '', page: 1 });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', subject: '', course_id: '', category_id: '', status: 'published', pages: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const { data } = await noteApi.list({ ...filters, limit: 10, ...(scope === 'developer' ? { mine: 1 } : {}) }); setRows(data.data); setMeta(data.meta); }
    catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [JSON.stringify(filters)]);
  useEffect(() => {
    courseApi.list({ limit: 100 }).then(({ data }) => setCourses(data.data)).catch(() => {});
    miscApi.categories().then(({ data }) => setCats(data.data)).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null); setFile(null);
    setForm({ title: '', description: '', subject: '', course_id: '', category_id: '', status: 'published', pages: '' });
    setOpen(true);
  };

  const openEdit = (n) => {
    setEditing(n); setFile(null);
    setForm({
      title: n.title, description: n.description || '', subject: n.subject || '', course_id: n.course_id || '',
      category_id: n.category_id || '', status: n.status, pages: n.pages || '',
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) fd.append(k, v); });
      if (file) fd.append('file', file);
      if (editing) await noteApi.update(editing.id, fd);
      else await noteApi.create(fd);
      toast.success(editing ? 'Note updated' : 'Note uploaded');
      setOpen(false); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const toggleStatus = async (n) => {
    try {
      const fd = new FormData();
      fd.append('status', n.status === 'published' ? 'draft' : 'published');
      await noteApi.update(n.id, fd);
      toast.success('Updated'); load();
    } catch (e) { toast.error(e.message); }
  };

  const download = async (n) => {
    try {
      const res = await noteApi.download(n.id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = n.file_name || `${n.title}.${n.file_type}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(e.message); }
  };

  const remove = async (n) => {
    if (!window.confirm(`Delete “${n.title}”?`)) return;
    try { await noteApi.remove(n.id); toast.success('Note deleted'); load(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Study material</span><h2>Notes management</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Upload PDFs, DOC/DOCX, PPT/PPTX, images and ZIP archives and attach them to courses or subjects.</p></div>
        <button className="btn btn-primary" onClick={openCreate}>⬆ Upload notes</button>
      </div>

      <div className="card mb">
        <div className="form-grid">
          <label className="field full">Search
            <input className="input" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))} placeholder="Title, subject…" />
          </label>
          <label className="field">File type
            <select className="select" value={filters.file_type} onChange={(e) => setFilters((f) => ({ ...f, file_type: e.target.value, page: 1 }))}>
              <option value="">All types</option>
              {FILE_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </select>
          </label>
          <label className="field">Status
            <select className="select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}>
              <option value="">All</option>
              {['published', 'draft'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      {!rows && <Loader label="Loading notes…" />}
      {rows && rows.length === 0 && <Empty title="No notes uploaded yet" hint="Upload your first PDF, slide deck or archive." />}

      {rows && rows.length > 0 && (
        <div className="table-wrap scroll-x">
          <table className="table">
            <thead><tr><th><span className="sr-only">Select note</span></th><th>Title</th><th>Subject</th><th>Course</th><th>Type</th><th>Size</th><th>Downloads</th><th>Status</th><th>Uploaded</th><th style={{ width: 210 }}>Actions</th></tr></thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td style={{ fontSize: '1.3rem' }}>{fileIcon(n.file_type)}</td>
                  <td><strong>{n.title}</strong><div className="tiny muted">{(n.description || '').slice(0, 60)}</div></td>
                  <td className="small">{n.subject || '—'}</td>
                  <td className="small">{n.course_title || '—'}</td>
                  <td><span className="tag">{String(n.file_type).toUpperCase()}</span></td>
                  <td className="small">{fmtBytes(n.file_size)}</td>
                  <td>{n.download_count}</td>
                  <td><StatusBadge value={n.status} /></td>
                  <td className="tiny muted">{timeAgo(n.created_at)}</td>
                  <td>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => download(n)}>⬇</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(n)}>✏️</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => toggleStatus(n)}>{n.status === 'published' ? '🙈' : '🚀'}</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(n)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(meta && meta.pages > 1) && (
        <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" disabled={meta.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Prev</button>
          <span className="tiny muted">Page {meta.page} / {meta.pages}</span>
          <button className="btn btn-sm btn-ghost" disabled={meta.page >= meta.pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next →</button>
        </div>
      )}

      <Modal open={open} title={editing ? `Edit note: ${editing.title}` : 'Upload study material'} onClose={() => setOpen(false)} wide>
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field full">Title *
              <input className="input" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Unit 3 — Trees & Graphs (handwritten notes)" />
            </label>
            <label className="field">Subject
              <input className="input" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Data Structures" />
            </label>
            <label className="field">Course
              <select className="select" value={form.course_id} onChange={(e) => setForm((f) => ({ ...f, course_id: e.target.value }))}>
                <option value="">— none —</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label className="field">Category
              <select className="select" value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                <option value="">— none —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field">Pages
              <input className="input" type="number" min="1" value={form.pages} onChange={(e) => setForm((f) => ({ ...f, pages: e.target.value }))} />
            </label>
            <label className="field">Status
              <select className="select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {['published', 'draft'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <FileUploadField name="file" label={editing ? 'Replace file (optional)' : 'File'} required={!editing}
              hint="Allowed: PDF, DOC/DOCX, PPT/PPTX, JPG/PNG, ZIP, TXT, MD — max 25 MB." onChange={(_, f) => setFile(f)} />
            <label className="field full">Description
              <textarea className="textarea" rows="3" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </label>
          </div>
          <p className="tiny muted">🔐 Downloads are login-gated: anonymous visitors see “Please login to download this material.” and are redirected to the login page.</p>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : editing ? 'Save changes' : 'Upload'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
