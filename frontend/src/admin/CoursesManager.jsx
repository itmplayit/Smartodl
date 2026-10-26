import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { courseApi, miscApi, userApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { DiffBadge, Empty, Loader, StatusBadge } from '../components/ui';
import { COURSE_DIFFICULTIES } from '../utils/constants';
import { fmtNum } from '../utils/format';

/** Course list with publish/unpublish, thumbnail upload and a link to the builder. */
export default function CoursesManager({ scope = 'admin' }) {
  const { can, hasRole } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [cats, setCats] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', category_id: '', difficulty: '', page: 1, creator_role: '' });

  const load = async () => {
    // Developers see only their own content; administrators see everything, with creator filter chips.
    try { const { data } = await courseApi.list({ ...filters, limit: 10, ...(scope === 'developer' ? { mine: 1 } : {}) }); setRows(data.data); setMeta(data.meta); }
    catch (e) { toast.error(e.message); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable eslint-disable-next-line */ }, [JSON.stringify(filters)]);
  useEffect(() => {
    miscApi.categories().then(({ data }) => setCats(data.data)).catch(() => {});
    // only administrators may enumerate users (developers get a 403 by design)
    if (hasRole('admin')) userApi.list({ role: 'developer', limit: 50 }).then(({ data }) => setInstructors(data.data)).catch(() => {});
  }, []);

  const toggleStatus = async (c) => {
    try {
      await courseApi.update(c.id, { status: c.status === 'published' ? 'draft' : 'published' });
      toast.success(c.status === 'published' ? 'Unpublished' : 'Published');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const togglePremium = async (c) => {
    try {
      await courseApi.update(c.id, { is_premium: Number(c.is_premium) ? 0 : 1 });
      toast.success(Number(c.is_premium) ? '⭐ Premium removed — it is now visible to everyone' : '⭐ Marked as PREMIUM — it will open only for subscribed students');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete “${c.title}”? Modules, lessons and enrollments go with it.`)) return;
    try { await courseApi.remove(c.id); toast.success('Course deleted'); load(); } catch (e) { toast.error(e.message); }
  };

  const uploadThumb = async (c, file) => {
    try { await courseApi.uploadThumbnail(c.id, file); toast.success('Thumbnail updated'); load(); }
    catch (e) { toast.error(e.message); }
  };

  const base = scope === 'admin' ? '/admin' : '/developer';

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Content</span><h2>Course management</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Thumbnails, categories, difficulty, modules, lessons, instructor assignment and publishing.</p></div>
        <Link className="btn btn-primary" to={`${base}/courses/new`}>➕ Create course</Link>
      </div>

      <div className="card mb">
        <div className="form-grid">
          <label className="field full">Search
            <input className="input" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))} placeholder="Course title…" />
          </label>
          <label className="field">Status
            <select className="select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}>
              <option value="">All statuses</option>
              {['draft', 'published', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">Category
            <select className="select" value={filters.category_id} onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value, page: 1 }))}>
              <option value="">All categories</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">Difficulty
            <select className="select" value={filters.difficulty} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value, page: 1 }))}>
              <option value="">Any</option>
              {COURSE_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
      </div>

      {scope === 'admin' && (
        <div className="row wrap mb" style={{ gap: 8, marginTop: -6 }}>
          <span className="tiny muted" style={{ alignSelf: 'center' }}>Creator filter:</span>
          {[['', '📂 All'], ['developer', '👨‍💻 Developers'], ['admin', '🛡 Admins']].map(([v, label]) => (
            <button key={v} className={filters.creator_role === v ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => setFilters((f) => ({ ...f, creator_role: v, page: 1 }))}>{label}</button>
          ))}
        </div>
      )}
      {scope === 'developer' && (
        <div className="tiny muted mb" style={{ marginTop: -6 }}>👤 Only content created by you is shown here — administrator content is not displayed in the developer panel.</div>
      )}
      {!rows && <Loader label="Loading courses…" />}
      {rows && rows.length === 0 && <Empty title="No courses found" hint="Create your first course to get started." />}

      {rows && rows.length > 0 && (
        <div className="table-wrap scroll-x">
          <table className="table">
            <thead><tr><th>Course</th><th>Category</th><th>Level</th><th>Modules / Lessons</th><th>Students</th><th>Instructor</th><th>Status</th><th style={{ width: 260 }}>Actions</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ minWidth: 220 }}>
                    <div className="row" style={{ gap: 10 }}>
                      {c.thumbnail
                        ? <img src={c.thumbnail} alt="" style={{ width: 46, height: 34, objectFit: 'cover', borderRadius: 6 }} />
                        : <span style={{ fontSize: '1.4rem' }}>📘</span>}
                      <div>
                        <Link className="link" style={{ fontWeight: 600 }} to={`/courses/${c.id}`}>{c.title}</Link>
                        <div className="tiny muted">{(c.summary || '').slice(0, 60)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="small">{c.category_name || '—'}</td>
                  <td><DiffBadge value={c.difficulty} /></td>
                  <td className="small">{c.module_count ?? '—'} / {c.lessons_count}</td>
                  <td>{fmtNum(c.total_students)}</td>
                  <td className="small">{scope === 'admin' ? (c.instructor_role === 'developer' ? '👨‍💻 ' : '🛡 ') : ''}{c.instructor_name || '—'}</td>
                  <td><StatusBadge value={c.status} /></td>
                  <td>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <Link className="btn btn-sm btn-ghost" to={`${base}/courses/${c.id}`}>🧩 Build</Link>
                      <button className="btn btn-sm btn-ghost" onClick={() => toggleStatus(c)}>{c.status === 'published' ? '🙈 Unpublish' : '🚀 Publish'}</button>
                      {scope === 'admin' && (
                        <button className="btn btn-sm btn-ghost" title="Premium toggle (administrators only)" onClick={() => togglePremium(c)}>
                          {Number(c.is_premium) ? '⭐ Premium ON' : '☆ Premium'}
                        </button>
                      )}
                      <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
                        🖼<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && uploadThumb(c, e.target.files[0])} />
                      </label>
                      {can('delete_course') && <button className="btn btn-sm btn-ghost" onClick={() => remove(c)}>🗑</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="between mt">
        <span className="tiny muted">{meta ? `${meta.total} course(s)` : ''}</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm btn-ghost" disabled={!meta || meta.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Prev</button>
          <button className="btn btn-sm btn-ghost" disabled={!meta || meta.page >= meta.pages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next →</button>
        </div>
      </div>

      {instructors.length > 0 && (
        <p className="tiny muted mt-s">Available instructors: {instructors.map((i) => `${i.full_name} (#${i.id})`).join(', ')} — assign them while creating a course.</p>
      )}
    </div>
  );
}
