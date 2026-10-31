import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LessonMediaFields from '../components/LessonMediaFields';
import { useSettings } from '../context/SettingsContext';
import { courseApi, miscApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Empty, Loader, Modal } from '../components/ui';

/** Modules & lessons overview for the whole catalogue. */
export default function ModulesManager({ scope = 'admin' }) {
  const toast = useToast();
  const [courses, setCourses] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [course, setCourse] = useState(null);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [lessonFor, setLessonFor] = useState(null);
  const [moduleForm, setModuleForm] = useState({ title: '', description: '', position: 1 });
  const [mediaLesson, setMediaLesson] = useState(null);
  const { isOn } = useSettings();
  const moduleQuizzesOn = isOn('module_quizzes_enabled', true);
  const [lessonForm, setLessonForm] = useState({ title: '', description: '', video_url: '', content: '', duration_minutes: 10, position: 1, is_preview: 0 });
  const base = scope === 'admin' ? '/admin' : '/developer';

  useEffect(() => {
    courseApi.list({ limit: 100 }).then(({ data }) => {
      setCourses(data.data);
      if (data.data[0]) setCourseId(data.data[0].id);
    }).catch((e) => { toast.error(e.message); setCourses([]); });
  }, []);

  const loadCourse = async () => {
    if (!courseId) return;
    try { const { data } = await courseApi.get(courseId); setCourse(data.data); }
    catch (e) { toast.error(e.message); }
  };
  useEffect(() => { setCourse(null); loadCourse(); /* eslint-disable-next-line */ }, [courseId]);

  const addModule = async (e) => {
    e.preventDefault();
    try {
      await courseApi.createModule({ ...moduleForm, course_id: Number(courseId), position: Number(moduleForm.position) });
      toast.success('Module added'); setModuleOpen(false); loadCourse();
    } catch (err) { toast.error(err.message); }
  };

  const removeModule = async (m) => {
    if (!window.confirm(`Delete module “${m.title}” and its lessons?`)) return;
    try { await courseApi.removeModule(m.id); toast.success('Module deleted'); loadCourse(); } catch (e) { toast.error(e.message); }
  };

  const addLesson = async (e) => {
    e.preventDefault();
    try {
      const { data } = await courseApi.createLesson({ ...lessonForm, module_id: lessonFor.id, course_id: Number(courseId), duration_minutes: Number(lessonForm.duration_minutes), position: Number(lessonForm.position) });
      toast.success('Lesson added');
      setLessonFor(null);
      // The lesson must exist before a file can belong to it, so the uploader
      // opens right after the create instead of inside the create form.
      if (data?.data?.id) setMediaLesson(data.data);
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

  const totalModules = (course?.modules || []).length;
  const totalLessons = (course?.modules || []).reduce((a, m) => a + m.lessons.length, 0);

  return (
    <div className="container section">
      <div className="between wrap mb">
        <div><span className="eyebrow">Curriculum</span><h2>Modules & lessons</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Pick a course and manage its curriculum structure, previews and video links.</p></div>
        <Link className="btn btn-ghost" to={`${base}/courses`}>📘 Course management</Link>
      </div>

      {!courses && <Loader label="Loading courses…" />}
      {courses && courses.length === 0 && <Empty title="No courses yet" hint="Create a course first." />}

      {courses && courses.length > 0 && (
        <>
          <div className="card mb">
            <label className="field" style={{ maxWidth: 460 }}>Course
              <select className="select" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                {courses.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.title} ({c.status})</option>)}
              </select>
            </label>
            {course && (
              <div className="row wrap mt-s" style={{ gap: 10 }}>
                <span className="tag">{totalModules} modules</span>
                <span className="tag">{totalLessons} lessons</span>
                <span className="tag">{course.total_students} students</span>
                <button className="btn btn-sm btn-primary" onClick={() => { setModuleForm({ title: '', description: '', position: totalModules + 1 }); setModuleOpen(true); }}>➕ Add module</button>
                <Link className="btn btn-sm btn-ghost" to={`${base}/courses/${courseId}`}>Open builder</Link>
              </div>
            )}
          </div>

          {!course && <Loader label="Loading curriculum…" />}
          {course && (!course.modules || course.modules.length === 0) && <Empty title="This course has no modules yet" hint="Add the first module to start building." />}

          {(course?.modules || []).map((m) => (
            <div className="panel mb" key={m.id}>
              <div className="between">
                <strong>{m.position}. {m.title}</strong>
                <div className="row" style={{ gap: 6 }}>
                  {moduleQuizzesOn && (
                    <Link
                      className="btn btn-sm btn-ghost"
                      title="Is module ke liye quiz banayein (anti-cheat ke saath, camera ke bina)"
                      to={`${base}/quizzes?course=${courseId}&module=${m.id}`}
                    >
                      🧠 Quiz
                    </Link>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => { setLessonFor(m); setLessonForm({ title: '', description: '', video_url: '', content: '', duration_minutes: 10, position: m.lessons.length + 1, is_preview: 0 }); }}>➕ Lesson</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => removeModule(m)}>🗑</button>
                </div>
              </div>
              <div className="list-tight mt-s">
                {m.lessons.map((l) => (
                  <div className="between" key={l.id}>
                    <div style={{ minWidth: 0 }}>
                      <div className="small">{l.is_preview ? '▶' : '📗'} {l.title}</div>
                      <div className="tiny muted">{l.duration_minutes} min {l.video_url ? `• ${l.video_url.slice(0, 48)}` : ''}</div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-sm btn-ghost" title="Upload video / PDF" onClick={() => setMediaLesson(l)}>🎬 Media</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => togglePreview(l)}>{l.is_preview ? '🔒' : '🔓'}</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => removeLesson(l)}>🗑</button>
                    </div>
                  </div>
                ))}
                {m.lessons.length === 0 && <span className="tiny muted">No lessons yet.</span>}
              </div>
            </div>
          ))}
        </>
      )}

      <Modal
        open={!!mediaLesson}
        title={`Video & PDF — ${mediaLesson ? mediaLesson.title : ''}`}
        onClose={() => setMediaLesson(null)}
        wide
      >
        {mediaLesson && (
          <LessonMediaFields
            lessonId={mediaLesson.id}
            video={mediaLesson.video_upload || null}
            pdf={mediaLesson.pdf_upload || null}
            onChanged={() => loadCourse()}
          />
        )}
      </Modal>

      <Modal open={moduleOpen} title="Add module" onClose={() => setModuleOpen(false)}>
        <form onSubmit={addModule}>
          <label className="field">Title *
            <input className="input" required value={moduleForm.title} onChange={(e) => setModuleForm((f) => ({ ...f, title: e.target.value }))} />
          </label>
          <label className="field mt-s">Description
            <input className="input" value={moduleForm.description} onChange={(e) => setModuleForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="field mt-s">Position
            <input className="input" type="number" min="1" value={moduleForm.position} onChange={(e) => setModuleForm((f) => ({ ...f, position: e.target.value }))} />
          </label>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setModuleOpen(false)}>Cancel</button>
            <button className="btn btn-primary">Add module</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!lessonFor} title={`Add lesson — ${lessonFor ? lessonFor.title : ''}`} onClose={() => setLessonFor(null)} wide>
        <form onSubmit={addLesson}>
          <div className="form-grid">
            <label className="field full">Lesson title *
              <input className="input" required value={lessonForm.title} onChange={(e) => setLessonForm((f) => ({ ...f, title: e.target.value }))} />
            </label>
            <label className="field">Video URL
              <input className="input" value={lessonForm.video_url} onChange={(e) => setLessonForm((f) => ({ ...f, video_url: e.target.value }))} />
            </label>
            <label className="field">Duration (minutes)
              <input className="input" type="number" min="1" value={lessonForm.duration_minutes} onChange={(e) => setLessonForm((f) => ({ ...f, duration_minutes: e.target.value }))} />
            </label>
            <label className="field">Position
              <input className="input" type="number" min="1" value={lessonForm.position} onChange={(e) => setLessonForm((f) => ({ ...f, position: e.target.value }))} />
            </label>
            <label className="field row" style={{ gap: 8, alignItems: 'center', marginTop: 20 }}>
              <input type="checkbox" checked={Number(lessonForm.is_preview) === 1} onChange={(e) => setLessonForm((f) => ({ ...f, is_preview: e.target.checked ? 1 : 0 }))} />
              Free preview
            </label>
            <label className="field full">Lesson notes
              <textarea className="textarea" rows="5" value={lessonForm.content} onChange={(e) => setLessonForm((f) => ({ ...f, content: e.target.value }))} />
            </label>
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setLessonFor(null)}>Cancel</button>
            <button className="btn btn-primary">Add lesson</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
