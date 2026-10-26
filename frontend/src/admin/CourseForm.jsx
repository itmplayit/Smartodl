import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { courseApi, miscApi, userApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Empty, Loader, Modal } from '../components/ui';
import { COURSE_DIFFICULTIES } from '../utils/constants';

/** Create / edit a course and build its modules + lessons. */
export default function CourseForm({ scope = 'admin' }) {
  const { id } = useParams();
  const { user, can, hasRole } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const editing = !!id;

  const [form, setForm] = useState({
    title: '', summary: '', description: '', category_id: '', difficulty: 'beginner', duration_hours: 10,
    language: 'English', price: 0, status: 'draft', tags: '', instructor_id: user && user.role === 'developer' ? user.id : '',
  });
  const [course, setCourse] = useState(null);
  const [cats, setCats] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [moduleModal, setModuleModal] = useState(false);
  const [lessonModal, setLessonModal] = useState(null);
  const [moduleForm, setModuleForm] = useState({ title: '', description: '', position: 1 });
  const [lessonForm, setLessonForm] = useState({ title: '', description: '', video_url: '', content: '', duration_minutes: 10, position: 1, is_preview: 0 });

  const base = scope === 'admin' ? '/admin' : '/developer';

  const loadCourse = async () => {
    try {
      const { data } = await courseApi.get(id);
      const c = data.data;
      setCourse(c);
      setForm({
        title: c.title || '', summary: c.summary || '', description: c.description || '', category_id: c.category_id || '',
        difficulty: c.difficulty || 'beginner', duration_hours: c.duration_hours || 0, language: c.language || 'English',
        price: c.price || 0, status: c.status || 'draft', tags: c.tags || '', instructor_id: c.instructor_id || '',
      });
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    miscApi.categories().then(({ data }) => setCats(data.data.filter((c) => ['course', 'all'].includes(c.type)))).catch(() => {});
    // only admins may list user accounts — developers just teach their own courses
    if (hasRole('admin')) userApi.list({ role: 'developer', limit: 50 }).then(({ data }) => setInstructors(data.data)).catch(() => {});
    if (editing) loadCourse();
    /* eslint-disable-next-line */
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) { await courseApi.update(id, form); toast.success('Course updated'); loadCourse(); }
      else {
        const { data } = await courseApi.create(form);
        toast.success('Course created — now add modules and lessons');
        navigate(`${base}/courses/${data.data.id}`, { replace: true });
      }
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const addModule = async (e) => {
    e.preventDefault();
    try {
      await courseApi.createModule({ ...moduleForm, course_id: Number(id) });
      toast.success('Module added');
      setModuleModal(false);
      setModuleForm({ title: '', description: '', position: (course?.modules?.length || 0) + 2 });
      loadCourse();
    } catch (err) { toast.error(err.message); }
  };

  const removeModule = async (m) => {
    if (!window.confirm(`Delete module “${m.title}” and its lessons?`)) return;
    try { await courseApi.removeModule(m.id); toast.success('Module deleted'); loadCourse(); } catch (e) { toast.error(e.message); }
  };

  const addLesson = async (e) => {
    e.preventDefault();
    try {
      await courseApi.createLesson({ ...lessonForm, module_id: lessonModal.id, course_id: Number(id) });
      toast.success('Lesson added');
      setLessonModal(null);
      setLessonForm({ title: '', description: '', video_url: '', content: '', duration_minutes: 10, position: 1, is_preview: 0 });
      loadCourse();
    } catch (err) { toast.error(err.message); }
  };

  const removeLesson = async (l) => {
    if (!window.confirm(`Delete lesson “${l.title}”?`)) return;
    try { await courseApi.removeLesson(l.id); toast.success('Lesson deleted'); loadCourse(); } catch (e) { toast.error(e.message); }
  };

  const togglePreview = async (l) => {
    try { await courseApi.updateLesson(l.id, { is_preview: l.is_preview ? 0 : 1 }); loadCourse(); } catch (e) { toast.error(e.message); }
  };

  const uploadThumb = async (file) => {
    try { await courseApi.uploadThumbnail(id, file); toast.success('Thumbnail uploaded'); loadCourse(); } catch (e) { toast.error(e.message); }
  };

  const publish = async (status) => {
    try { await courseApi.update(id, { status }); toast.success(`Course ${status}`); loadCourse(); } catch (e) { toast.error(e.message); }
  };

  if (loading) return <Loader label="Loading course…" />;

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          <Link className="link small" to={`${base}/courses`}>← All courses</Link>
          <h1 style={{ marginBottom: 2 }}>{editing ? `Edit: ${form.title || `Course #${id}`}` : 'Create a new course'}</h1>
          <p className="muted small" style={{ marginBottom: 0 }}>Fill the details, save, then build the curriculum with modules and lessons.</p>
        </div>
        {editing && (
          <div className="row wrap" style={{ gap: 8 }}>
            <Link className="btn btn-ghost" to={`/courses/${id}`}>👁 Preview</Link>
            {form.status === 'published'
              ? <button className="btn btn-ghost" onClick={() => publish('draft')}>🙈 Unpublish</button>
              : <button className="btn btn-primary" onClick={() => publish('published')}>🚀 Publish</button>}
          </div>
        )}
      </div>

      <div className="split" style={{ gridTemplateColumns: '1fr 320px' }}>
        <form className="card" onSubmit={save}>
          <h3>Course details</h3>
          <div className="form-grid">
            <label className="field full">Title *
              <input className="input" required value={form.title} onChange={set('title')} placeholder="Complete Python Programming" />
            </label>
            <label className="field full">Summary
              <input className="input" value={form.summary} onChange={set('summary')} placeholder="One-line description shown on cards" />
            </label>
            <label className="field full">Full description
              <textarea className="textarea" rows="5" value={form.description} onChange={set('description')} placeholder="What will students learn? Prerequisites? Tools used?" />
            </label>
            <label className="field">Category
              <select className="select" value={form.category_id} onChange={set('category_id')}>
                <option value="">— none —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field">Difficulty
              <select className="select" value={form.difficulty} onChange={set('difficulty')}>
                {COURSE_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="field">Duration (hours)
              <input className="input" type="number" min="0" step="0.5" value={form.duration_hours} onChange={set('duration_hours')} />
            </label>
            <label className="field">Language
              <input className="input" value={form.language} onChange={set('language')} placeholder="English / Hindi" />
            </label>
            <label className="field">Price (0 = free)
              <input className="input" type="number" min="0" value={form.price} onChange={set('price')} />
            </label>
            <label className="field">Status
              <select className="select" value={form.status} onChange={set('status')}>
                {['draft', 'published', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">Instructor
              <select className="select" value={form.instructor_id} onChange={set('instructor_id')}>
                <option value="">— me —</option>
                {instructors.map((i) => <option key={i.id} value={i.id}>{i.full_name} (#{i.id})</option>)}
              </select>
            </label>
            <label className="field">Tags (comma separated)
              <input className="input" value={form.tags} onChange={set('tags')} placeholder="python, backend, interview" />
            </label>
          </div>
          <button className="btn btn-primary mt" disabled={busy}>{busy ? 'Saving…' : editing ? '💾 Save changes' : '➕ Create course'}</button>
        </form>

        <div className="stack">
          <div className="card">
            <h3 style={{ fontSize: '1rem' }}>Thumbnail</h3>
            {course && course.thumbnail
              ? <img src={course.thumbnail} alt="" style={{ width: '100%', borderRadius: 10 }} />
              : <div style={{ height: 130, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(79,70,229,.18)', fontSize: '2rem' }}>📘</div>}
            {editing ? (
              <label className="btn btn-ghost btn-block mt" style={{ cursor: 'pointer' }}>
                ⬆ Upload image
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && uploadThumb(e.target.files[0])} />
              </label>
            ) : <p className="tiny muted mt-s">Save the course first to upload a thumbnail.</p>}
            {course && <div className="tiny muted mt-s">{course.total_students} students • {course.lessons_count} lessons • {course.modules?.length || 0} modules</div>}
          </div>
          <div className="soft small">🧩 Modules and lessons unlock lessons for enrolled students and drive their progress percentage.</div>
        </div>
      </div>

      {editing && (
        <div className="card mt">
          <div className="between mb-s">
            <h3>🧩 Curriculum builder</h3>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => navigate(`${base}/courses/${id}/enrollments`)}>👥 Students</button>
              <button className="btn btn-sm btn-primary" onClick={() => { setModuleForm({ title: '', description: '', position: (course?.modules?.length || 0) + 1 }); setModuleModal(true); }}>➕ Add module</button>
            </div>
          </div>

          {(!course || !course.modules || course.modules.length === 0) && <Empty title="No modules yet" hint="Add a module, then attach lessons with video links and resources." />}

          {(course?.modules || []).map((m) => (
            <div className="panel mb" key={m.id}>
              <div className="between">
                <div>
                  <strong>{m.position}. {m.title}</strong>
                  <div className="tiny muted">{m.description || 'No description'} • {m.lessons.length} lessons</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => { setLessonModal(m); setLessonForm({ title: '', description: '', video_url: '', content: '', duration_minutes: 10, position: m.lessons.length + 1, is_preview: 0 }); }}>➕ Lesson</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => removeModule(m)}>🗑</button>
                </div>
              </div>
              <div className="list-tight mt-s">
                {m.lessons.map((l) => (
                  <div className="between" key={l.id}>
                    <div style={{ minWidth: 0 }}>
                      <div className="small">{l.is_preview ? '▶' : '📗'} {l.title}</div>
                      <div className="tiny muted">{l.duration_minutes} min {l.video_url ? '• video' : ''}</div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => togglePreview(l)}>{l.is_preview ? '🔒 Lock' : '🔓 Preview'}</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => removeLesson(l)}>🗑</button>
                    </div>
                  </div>
                ))}
                {m.lessons.length === 0 && <span className="tiny muted">No lessons in this module yet.</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={moduleModal} title="Add module" onClose={() => setModuleModal(false)}>
        <form onSubmit={addModule}>
          <label className="field">Module title *
            <input className="input" required value={moduleForm.title} onChange={(e) => setModuleForm((f) => ({ ...f, title: e.target.value }))} placeholder="Getting started" />
          </label>
          <label className="field mt-s">Description
            <input className="input" value={moduleForm.description} onChange={(e) => setModuleForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="field mt-s">Position
            <input className="input" type="number" min="1" value={moduleForm.position} onChange={(e) => setModuleForm((f) => ({ ...f, position: e.target.value }))} />
          </label>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setModuleModal(false)}>Cancel</button>
            <button className="btn btn-primary">Add module</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!lessonModal} title={`Add lesson to ${lessonModal ? lessonModal.title : ''}`} onClose={() => setLessonModal(null)} wide>
        <form onSubmit={addLesson}>
          <div className="form-grid">
            <label className="field full">Lesson title *
              <input className="input" required value={lessonForm.title} onChange={(e) => setLessonForm((f) => ({ ...f, title: e.target.value }))} />
            </label>
            <label className="field">Video URL
              <input className="input" value={lessonForm.video_url} onChange={(e) => setLessonForm((f) => ({ ...f, video_url: e.target.value }))} placeholder="https://youtu.be/…" />
            </label>
            <label className="field">Duration (minutes)
              <input className="input" type="number" min="1" value={lessonForm.duration_minutes} onChange={(e) => setLessonForm((f) => ({ ...f, duration_minutes: e.target.value }))} />
            </label>
            <label className="field">Resource URL
              <input className="input" value={lessonForm.resource_url || ''} onChange={(e) => setLessonForm((f) => ({ ...f, resource_url: e.target.value }))} placeholder="https://…/slides.pdf" />
            </label>
            <label className="field">Position
              <input className="input" type="number" min="1" value={lessonForm.position} onChange={(e) => setLessonForm((f) => ({ ...f, position: e.target.value }))} />
            </label>
            <label className="field full">Lesson notes / transcript
              <textarea className="textarea" rows="6" value={lessonForm.content} onChange={(e) => setLessonForm((f) => ({ ...f, content: e.target.value }))} />
            </label>
            <label className="field full row" style={{ gap: 8 }}>
              <input type="checkbox" checked={Number(lessonForm.is_preview) === 1} onChange={(e) => setLessonForm((f) => ({ ...f, is_preview: e.target.checked ? 1 : 0 }))} />
              Free preview (visible without enrolling)
            </label>
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setLessonModal(null)}>Cancel</button>
            <button className="btn btn-primary">Add lesson</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
