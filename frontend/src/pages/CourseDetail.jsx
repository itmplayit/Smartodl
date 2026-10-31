import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { courseApi, certApi, upiApi, billingApi } from '../services/api';
import CourseInsights from '../components/CourseInsights';
import CourseQuizzes from '../components/CourseQuizzes';
import VideoPlayer from '../components/VideoPlayer';
import PdfViewer from '../components/PdfViewer';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, DiffBadge, Empty, ErrorBox, Loader, Modal } from '../components/ui';
import UpiPayment from '../components/UpiPayment';
import { postToPaytm, openRazorpay } from './Pricing';
import Reviews from '../components/Reviews';
import Discussions from '../components/Discussions';
import { safeExternalHref } from '../utils/safeUrl';

const ATTEMPT_LABEL = {
  in_progress: 'in progress',
  submitted: 'submitted',
  evaluated: 'evaluated',
  abandoned: 'abandoned (time over)',
};

export default function CourseDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [error, setError] = useState('');
  const [openLesson, setOpenLesson] = useState(null);
  const [lessonContent, setLessonContent] = useState(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonMedia, setLessonMedia] = useState(null);
  const [watchState, setWatchState] = useState(null);
  const [collapsedModules, setCollapsedModules] = useState({});
  const lessonRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [cert, setCert] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [upiPayment, setUpiPayment] = useState(null);
  const [upiEnabled, setUpiEnabled] = useState(false);
  const [billing, setBilling] = useState({ demoMode: false, paymentsConfigured: false });

  const load = async () => {
    try { const { data } = await courseApi.get(id); setCourse(data.data); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Whether UPI is enabled, and therefore whether to show it in the payment chooser.
  useEffect(() => {
    upiApi.config().then(({ data }) => setUpiEnabled(!!data.data?.enabled)).catch(() => {});
    billingApi.plans().then(({ data }) => setBilling(data.data?.billing || { demoMode: false, paymentsConfigured: false })).catch(() => {});
  }, []);

  // When the course has loaded and we're enrolled+completed, fetch our certificate
  useEffect(() => {
    if (!user || !course) return;
    let alive = true;
    certApi.mine().then(({ data }) => {
      if (!alive) return;
      const found = (data.data || []).find((x) => x.course_id === course.id);
      setCert(found || null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [course?.id, course?.enrollment?.status, user]);

  const enroll = async () => {
    if (!user) return navigate('/login', { state: { from: `/courses/${id}` } });
    setBusy(true);
    try {
      await courseApi.enroll(id);
      toast.success('Enrolled successfully 🎉');
      await load();
    } catch (e) {
      // Paid course: the backend returns 402 PAYMENT_REQUIRED, so open the payment chooser.
      if (e.response?.status === 402) { setPayOpen(true); } else { toast.error(e.message); }
    } finally { setBusy(false); }
  };

  /** Paid course kharido — Razorpay modal, Paytm redirect, ya demo instant enroll. */
  const buy = async (gateway) => {
    if (!user) return navigate('/login', { state: { from: `/courses/${id}` } });
    setBusy(true);
    try {
      const { data: d } = await courseApi.purchase(id, gateway);
      if (d.data.activated) { toast.success('You are already enrolled 🎉'); setPayOpen(false); return load(); }

      if (d.data.mode === 'demo') {
        const { data: v } = await courseApi.purchaseVerify(id, { order_db_id: d.data.order.id });
        if (v.data.activated) {
          toast.success(`You are now enrolled in ${course.title} (DEMO payment) 🎉`);
          setPayOpen(false); return load();
        }
      }
      if (d.data.mode === 'razorpay') {
        await openRazorpay({
          rzp: d.data.razorpay,
          title: course.title,
          description: `Course purchase — ₹${course.price}`,
          user,
          verify: async (sig) => {
            try {
              const { data: v } = await courseApi.purchaseVerify(id, { order_db_id: d.data.order.id, ...sig });
              if (v.data.pending) toast.info(v.data.message || 'Payment capture is pending — check the status again shortly.');
              return v.data.activated ? v : null;
            } catch (err) { toast.error(err.response?.data?.error || err.message); return null; }
          },
          onSuccess: () => {
            toast.success(`You are now enrolled in ${course.title} 🎉`);
            setPayOpen(false); load();
          },
          onDismiss: () => toast.info('Payment was cancelled — the order is still pending, and you can try again'),
        });
        return undefined;
      }
      if (d.data.mode === 'paytm') {
        toast.info('Taking you to Paytm…');
        return postToPaytm(d.data.paytm);
      }
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
    return undefined;
  };

  /** Buy a paid course through UPI — enrolment follows administrator approval of the QR payment and UTR. */
  const buyWithUpi = async () => {
    if (!user) return navigate('/login', { state: { from: `/courses/${id}` } });
    setBusy(true);
    try {
      const { data: d } = await upiApi.checkoutCourse(Number(id));
      setUpiPayment(d.data.payment);
      if (d.data.reused) toast.info('Your previous UPI order is still open, so it is being shown again.');
    } catch (e) { toast.error(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const completeLesson = async (lessonId) => {
    if (!course.enrollment) return;
    try {
      const { data } = await courseApi.progress(course.enrollment.id, lessonId);
      toast.success(`Progress updated — ${data.data.progress_percent}% complete`);
      if (data.data.certificate) {
        toast.success('🎓 Course completed! Certificate issued.', { duration: 6000 });
      }
      await load();
    } catch (e) { toast.error(e.message); }
  };

  const openLessonContent = async (lesson) => {
    if (lesson.locked) { toast.info('Enrol in this course to unlock this lesson'); return; }
    const requestId = ++lessonRequest.current;
    setOpenLesson(lesson.id);
    setLessonContent(null);
    setLessonMedia(null);
    setWatchState(null);
    setLessonLoading(true);
    try {
      const { data } = await courseApi.lesson(lesson.id);
      if (lessonRequest.current === requestId) setLessonContent(data.data);
      // Tickets for <video>/<iframe> are minted only after the lesson open was
      // authorised; a failure here must not hide the text content.
      if (data.data?.video_upload || data.data?.pdf_upload) {
        try {
          const media = await courseApi.lessonMedia(lesson.id);
          if (lessonRequest.current === requestId) setLessonMedia(media.data.data);
        } catch { /* text content still shows */ }
      }
      // Watch coverage drives whether "Mark complete" is allowed.
      if (course?.completion_policy && course.completion_policy !== 'click' && user?.role === 'student') {
        try {
          const status = await courseApi.watchStatus(lesson.id);
          if (lessonRequest.current === requestId) setWatchState(status.data.data);
        } catch { /* gate stays server-side */ }
      }
    } catch (e) {
      if (lessonRequest.current === requestId) {
        toast.error(e.message);
        setOpenLesson(null);
      }
    } finally {
      if (lessonRequest.current === requestId) setLessonLoading(false);
    }
  };

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!course) return <Loader label="Opening course…" />;

  const progress = course.enrollment ? Number(course.enrollment.progress_percent) : 0;

  const manageCourse = !!(user && (user.role === 'owner' || user.role === 'admin'
    || (user.role === 'developer' && Number(course.instructor_id) === Number(user.id))));
  const enrolled = !!course.enrollment;
  const totalLessons = course.modules.reduce((sum, m) => sum + m.lessons.length, 0);
  const totalMinutes = course.modules.reduce(
    (sum, m) => sum + m.lessons.reduce((inner, l) => inner + (Number(l.duration_minutes) || 0), 0), 0,
  );
  // Count quizzes, not modules: a module may legally carry more than one.
  const moduleQuizCount = course.modules.reduce(
    (n, m) => n + (Array.isArray(m.quizzes) ? m.quizzes.length : (m.quiz ? 1 : 0)), 0,
  );
  const coverage = watchState?.coverage_percent ?? 0;
  const coverageTarget = watchState?.target_percent ?? 90;

  return (
    <div className="container section course-page">

      {/* ------------------------------- hero ------------------------------- */}
      <header className="course-hero">
        <div className="course-hero-body">
          <div className="chips">
            <DiffBadge value={course.difficulty} />
            {course.category_name && <span className="tag">{course.category_name}</span>}
            {course.language && <span className="tag">🌐 {course.language}</span>}
            {Number(course.price) === 0 && !course.premium_lock && <span className="tag tag-green">Free</span>}
            {course.status !== 'published' && <Badge tone="amber">{course.status}</Badge>}
          </div>
          <h1 className="course-hero-title">{course.title}</h1>
          <p className="course-hero-summary">{course.summary || 'Course description is being written.'}</p>
          <div className="chips chips-muted">
            <span>👨‍🏫 {course.instructor_name || 'SmartODL'}</span>
            <span>⭐ {Number(course.rating || 0).toFixed(1)}</span>
            <span>🎓 {course.total_students} learners</span>
            <span>⏱ {course.duration_hours} hours</span>
            <span>📚 {course.lessons_count} lessons</span>
            {moduleQuizCount > 0 && <span>🧠 {moduleQuizCount} module quizzes</span>}
          </div>
        </div>
        <div className="course-hero-art">
          {course.thumbnail
            ? <img src={course.thumbnail} alt="" />
            : <span aria-hidden="true">📘</span>}
        </div>
      </header>

      {/* --------------------------- progress strip --------------------------- */}
      {enrolled && (
        <section className="course-progress">
          <div className="between wrap" style={{ gap: 10 }}>
            <div>
              <span className="eyebrow">Your progress</span>
              <strong style={{ display: 'block', fontSize: '1.1rem' }}>
                {progress}% complete
                <span className="muted" style={{ fontWeight: 400, fontSize: '.85rem' }}>
                  {' '}· {course.enrollment.completed_lessons || 0} / {totalLessons} lessons
                </span>
              </strong>
            </div>
            {course.enrollment.status === 'completed' ? (
              <Badge tone="green">🎓 Completed</Badge>
            ) : (
              <span className="small muted">Next: {course.modules.flatMap((m) => m.lessons).find((l) => !l.locked && !openLesson)?.title || 'open any lesson'}</span>
            )}
          </div>
          <div className="progress mt-s"><i style={{ width: `${progress}%` }} /></div>
        </section>
      )}

      <div className="course-layout">
        {/* ------------------------------ content ------------------------------ */}
        <div className="course-main">
          <section className="card">
            <div className="between wrap mb-s">
              <div>
                <h2 style={{ marginBottom: 2 }}>Course content</h2>
                <p className="tiny muted" style={{ margin: 0 }}>
                  {course.modules.length} modules · {totalLessons} lessons · about {Math.round(totalMinutes / 60)}h {totalMinutes % 60}m
                  {moduleQuizCount > 0 && ` · ${moduleQuizCount} module quiz${moduleQuizCount === 1 ? '' : 'zes'}`}
                </p>
              </div>
              {enrolled && (
                <span className="tag">{course.enrollment.completed_lessons || 0} / {totalLessons} done</span>
              )}
            </div>

            {course.modules.length === 0 && (
              <Empty title="No modules yet" hint="The instructor is still building this course." />
            )}

            <div className="stack" style={{ gap: 12 }}>
              {course.modules.map((m) => {
                const moduleMinutes = m.lessons.reduce((sum, l) => sum + (Number(l.duration_minutes) || 0), 0);
                const isOpen = !collapsedModules[m.id];
                return (
                  <article className={'module-card' + (isOpen ? ' is-open' : '')} key={m.id}>
                    <button
                      type="button"
                      className="module-head"
                      onClick={() => setCollapsedModules((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                      aria-expanded={isOpen}
                    >
                      <span className="module-index">{m.position}</span>
                      <span className="module-head-text">
                        <strong>{m.title}</strong>
                        <span className="tiny muted">
                          {m.lessons.length} lessons · {moduleMinutes} min
                          {(() => {
                            const n = Array.isArray(m.quizzes) ? m.quizzes.length : (m.quiz ? 1 : 0);
                            return n ? ` · 📚 ${n} module quiz${n === 1 ? '' : 'zes'}` : '';
                          })()}
                        </span>
                      </span>
                      <span className="module-chevron">{isOpen ? '▾' : '▸'}</span>
                    </button>

                    {isOpen && (
                      <div className="module-body">
                        {m.description && <p className="tiny muted">{m.description}</p>}
                        <div className="lesson-list">
                          {m.lessons.map((l) => (
                            <div className={'lesson-row' + (openLesson === l.id ? ' is-active' : '')} key={l.id}>
                              <button type="button" className="lesson-open" onClick={() => openLessonContent(l)}>
                                <span className="lesson-icon">
                                  {l.locked ? '🔒' : l.is_preview ? '▶' : '📗'}
                                </span>
                                <span className="lesson-title">
                                  {l.title}
                                  {l.is_preview && <span className="tag">preview</span>}
                                </span>
                                <span className="tiny muted">{l.duration_minutes} min</span>
                              </button>
                              {course.enrollment && !l.locked && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => completeLesson(l.id)}
                                >
                                  Mark complete
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* ------------------------- module quiz ------------------------- */}
                        {/* A module can carry more than one quiz — list them all so a
                            second quiz never becomes invisible on the course page. */}
                        {(m.quizzes || (m.quiz ? [m.quiz] : [])).map((quiz) => (
                          <div className={'module-quiz' + (quiz.passed ? ' is-passed' : '')} key={quiz.id}>
                            <div className="module-quiz-main">
                              <strong>📚 Module quiz</strong>
                              {quiz.visible === false && (
                                <span className="tag" title="Students can't see or attempt a draft quiz — publish it to open it up">
                                  draft · students can't see it
                                </span>
                              )}
                              <span className="tiny muted">
                                {quiz.title} · {quiz.question_count} questions · {quiz.total_marks} marks ·
                                {' '}pass {quiz.passing_score}% · {quiz.time_limit_minutes} min
                              </span>
                              <div className="chips chips-mini">
                                <span title="Tab switch detect hota hai">👁 Tab guard</span>
                                <span title="Quiz fullscreen me chalta hai">🔒 Fullscreen</span>
                                <span title="Copy-paste band">📋 Copy block</span>
                                <span className="chips-none">🚫 No camera</span>
                                <span className="chips-none">🚫 No screen share</span>
                              </div>
                              {quiz.attempt_id && (
                                <span className="tiny muted">
                                  Last attempt: <b>{ATTEMPT_LABEL[quiz.attempt_status] || quiz.attempt_status}</b>
                                  {quiz.attempt_total_marks
                                    ? ` · ${Number(quiz.attempt_score) || 0}/${quiz.attempt_total_marks}`
                                    : ''}
                                  {quiz.passed ? ' · ✅ passed' : ''}
                                </span>
                              )}
                            </div>
                            {quiz.visible === false ? (
                              <Link className="btn btn-sm btn-ghost" to={`/quizzes/${quiz.id}`}>Open in admin</Link>
                            ) : (
                              <Link className="btn btn-sm btn-primary" to={`/quizzes/${quiz.id}`}>
                                {quiz.passed ? 'Review quiz' : quiz.attempt_id ? 'Try again' : 'Start quiz'}
                              </Link>
                            )}
                          </div>
                        ))}
                        {manageCourse && (m.quizzes || []).length === 0 && (
                          <div className="module-quiz is-empty">
                            <div className="module-quiz-main">
                              <strong>📚 No module quiz yet</strong>
                              <span className="tiny muted">
                                Har module ka apna quiz ho sakta hai — anti-cheat ke saath, camera ke bina.
                              </span>
                            </div>
                            <Link
                              className="btn btn-sm btn-ghost"
                              to={`${user && user.role === 'developer' ? '/developer' : '/admin'}/quizzes?course=${course.id}&module=${m.id}`}
                            >
                              ➕ Add quiz
                            </Link>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {/* --------------------------- lesson viewer --------------------------- */}
          {openLesson && (lessonLoading || lessonContent) && (
            <section className="card lesson-panel">
              <div className="lesson-panel-head">
                <div>
                  <span className="eyebrow">Lesson</span>
                  <h3 style={{ margin: 0 }}>{lessonContent?.title || 'Loading lesson…'}</h3>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close lesson"
                  onClick={() => { lessonRequest.current += 1; setOpenLesson(null); setLessonContent(null); setLessonMedia(null); setWatchState(null); setLessonLoading(false); }}
                >
                  ✕
                </button>
              </div>

              {lessonLoading ? <Loader label="Opening lesson…" /> : (
                <>
                  <VideoPlayer
                    media={lessonMedia?.video}
                    externalUrl={lessonContent.video_url}
                    title={lessonContent.title}
                    lessonId={lessonContent.id}
                    resumeAt={watchState?.last_position || 0}
                    onWatchUpdate={setWatchState}
                  />

                  {course.completion_policy && course.completion_policy !== 'click' && lessonMedia?.video && (
                    <div className="watch-box">
                      <div className="between tiny">
                        <span>🎬 Video coverage <b>{coverage}%</b> / {coverageTarget}% chahiye</span>
                        <span className="muted">
                          {(watchState?.watched_seconds || 0) > 0
                            ? `${Math.round((watchState?.watched_seconds || 0) / 60)} min dekha`
                            : 'abhi shuru nahi kiya'}
                        </span>
                      </div>
                      <div className="progress mt-s"><i style={{ width: `${Math.min(100, coverage)}%` }} /></div>
                      <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                        Sirf chalane se count hota hai — pause ya tab band karke chhod dene par coverage nahi badhti.
                        {course.completion_policy.includes('quiz') && ' Is lesson ke liye module quiz pass karna bhi zaroori hai.'}
                      </p>
                    </div>
                  )}

                  <PdfViewer media={lessonMedia?.pdf} title={lessonContent.title} />

                  {safeExternalHref(lessonContent.resource_url) && (
                    <p className="tiny muted">📎 Extra resource: <a className="link" href={safeExternalHref(lessonContent.resource_url)} target="_blank" rel="noreferrer">open link</a></p>
                  )}

                  {lessonContent.content && (
                    <div className="lesson-text">{lessonContent.content}</div>
                  )}

                  {course.enrollment && (
                    <div className="lesson-panel-actions">
                      <button type="button" className="btn btn-primary" onClick={() => completeLesson(lessonContent.id)}>
                        ✓ Mark this lesson complete
                      </button>
                      <span className="tiny muted">
                        {course.completion_policy === 'watch' && coverage < coverageTarget
                          ? `Video ${coverageTarget}% dekhne ke baad hi complete hoga (abhi ${coverage}%).`
                          : course.completion_policy === 'quiz'
                            ? 'Module quiz pass hone par hi complete hoga.'
                            : course.completion_policy === 'watch_and_quiz'
                              ? `Video ${coverageTarget}% + module quiz pass — dono chahiye.`
                              : 'Lesson khula hai — complete kar sakte hain.'}
                      </span>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <CourseQuizzes course={course} canManage={manageCourse} />
          {manageCourse && <CourseInsights course={course} />}

          {course.notes && course.notes.length > 0 && (
            <section className="card mt">
              <h3 className="mb-s">📄 Course notes</h3>
              <div className="list-tight">
                {course.notes.map((n) => (
                  <div key={n.id} className="between">
                    <span className="small">📄 {n.title}</span>
                    <Link className="btn btn-sm btn-ghost" to="/notes">Open library</Link>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ------------------------------- sidebar ------------------------------- */}
        <aside className="course-side">
          <div className="card course-buy">
            {course.thumbnail
              ? <img src={course.thumbnail} alt="" className="course-buy-thumb" />
              : <div className="course-buy-thumb course-buy-art">📘</div>}

            {course.enrollment ? (
              <>
                <div className="between">
                  <Badge tone="green">✓ Enrolled</Badge>
                  <span className="tiny muted">{progress}% done</span>
                </div>
                <div className="progress mt-s"><i style={{ width: `${progress}%` }} /></div>
                {course.enrollment.status === 'completed' ? (
                  <div className="notice success mt" style={{ textAlign: 'left' }}>
                    🎓 <b>Course completed!</b>
                    {cert ? (
                      <>
                        <p className="tiny" style={{ margin: '6px 0 10px', opacity: .85 }}>Certificate #{cert.certificate_no} • Grade {cert.grade}</p>
                        <div className="row" style={{ gap: 8 }}>
                          <a className="btn btn-primary btn-sm" href={certApi.printUrl(cert.public_token)} target="_blank" rel="noreferrer">🏅 View certificate</a>
                          <Link className="btn btn-ghost btn-sm" to={certApi.verifyUrl(cert.public_token)}>Verify link</Link>
                        </div>
                      </>
                    ) : <p className="tiny" style={{ margin: '6px 0 0', opacity: .85 }}>Your certificate is being prepared.</p>}
                  </div>
                ) : (
                  <Link className="btn btn-primary btn-block mt" to={user?.role === 'student' ? '/student/courses' : '/courses'}>
                    Continue learning
                  </Link>
                )}
              </>
            ) : (
              <>
                <div className="between">
                  <div>
                    <div className="tiny muted">Course access</div>
                    <div style={{ fontWeight: 800, fontSize: '1.6rem' }}>
                      {Number(course.price) === 0 ? 'Free' : `₹${course.price}`}
                    </div>
                  </div>
                  <Badge tone="cyan">Lifetime access</Badge>
                </div>
                {course.premium_lock && !course.purchase_required ? (
                  <>
                    <div className="notice mt" style={{ textAlign: 'left' }}>
                      ⭐ <b>Premium course</b> — an active <b>subscription</b> is required to enrol.
                    </div>
                    <Link className="btn btn-primary btn-block mt" to="/pricing">🚀 Get a plan and unlock</Link>
                    {!user && <p className="tiny muted mt-s center">Log in first, then choose a plan.</p>}
                  </>
                ) : course.purchase_required ? (
                  <>
                    <div className="notice mt" style={{ textAlign: 'left' }}>
                      💳 <b>Paid course</b> — pay ₹{course.price} once for lifetime access.
                    </div>
                    <button className="btn btn-primary btn-block mt" disabled={busy || !user} onClick={() => setPayOpen(true)}>
                      {user ? `💳 Buy for ₹${course.price}` : 'Login to buy'}
                    </button>
                    {course.purchased && <p className="tiny muted mt-s center">Payment received — click "Enroll now".</p>}
                  </>
                ) : (
                  <button className="btn btn-primary btn-block mt" disabled={busy || !user} onClick={enroll}>
                    {busy ? 'Enrolling…' : user ? 'Enroll now' : 'Login to enrol'}
                  </button>
                )}
                {!user && !(course.premium_lock && !course.purchase_required) && <p className="tiny muted mt-s center">Login required to enrol and download material.</p>}
              </>
            )}

            <div className="divider" />
            <ul className="course-includes">
              <li>✅ {course.modules.length} modules · {totalLessons} lessons</li>
              <li>✅ Video lessons + PDF notes (in-page reader)</li>
              {moduleQuizCount > 0 && <li>✅ {moduleQuizCount} module quiz{moduleQuizCount === 1 ? '' : 'zes'} (no camera)</li>}
              <li>✅ Downloadable notes</li>
              <li>✅ Certificate of completion</li>
              {course.completion_policy && course.completion_policy !== 'click' && (
                <li>🎯 Completion rule: {
                  course.completion_policy === 'watch' ? 'video 90%'
                    : course.completion_policy === 'quiz' ? 'module quiz pass'
                      : 'video 90% + quiz'
                }</li>
              )}
            </ul>
          </div>
          {!user && <div className="soft small">🔐 Log in to track progress, take quizzes and download notes.</div>}
        </aside>
      </div>

      {/* ------------------------- reviews & discussions ------------------------- */}
      <section className="card mt" style={{ marginTop: 36 }}>
        <h3 className="mb">⭐ Ratings & Reviews</h3>
        <Reviews courseId={Number(id)} />
      </section>
      <section className="card mt">
        <h3 className="mb">💬 Course Discussions</h3>
        <Discussions parentType="course" parentId={Number(id)} />
      </section>

      {/* ---------------------- paid course: payment chooser ---------------------- */}
      <Modal
        open={payOpen}
        onClose={() => { setPayOpen(false); setUpiPayment(null); }}
        title={upiPayment ? 'UPI se payment' : `${course.title} — ₹${course.price}`}
      >
        {upiPayment ? (
          <UpiPayment
            payment={upiPayment}
            onDone={() => {
              setUpiPayment(null); setPayOpen(false); load();
            }}
          />
        ) : (
          <>
            <p className="small muted">
              Pay once and the course is yours for life. As soon as payment is confirmed,
              enrolment will happen automatically.
            </p>
            <div className="stack mt">
              {billing.razorpay?.enabled && (
                <button className="btn btn-primary btn-block" disabled={busy} onClick={() => buy('razorpay')}>
                  {busy ? 'Please wait…' : '💳 Pay with Razorpay (card, UPI, or netbanking)'}
                </button>
              )}
              {billing.paytm?.enabled && (
                <button
                  className={`btn btn-block ${billing.razorpay?.enabled ? 'btn-ghost' : 'btn-primary'}`}
                  disabled={busy} onClick={() => buy('paytm')}
                >
                  {busy ? 'Please wait…' : '🅿️ Pay with Paytm (UPI, card, or netbanking)'}
                </button>
              )}
              {upiEnabled && (
                <button className="btn btn-ghost btn-block" disabled={busy} onClick={buyWithUpi}>
                  📲 Pay with a UPI QR code
                </button>
              )}
              {billing.demoMode && (
                <button className="btn btn-primary btn-block" disabled={busy} onClick={() => buy()}>
                  {busy ? 'Please wait…' : '🧪 Demo payment (no gateway is configured)'}
                </button>
              )}
            </div>
            <p className="tiny muted mt-s">
              Amount: <b>₹{course.price}</b> · one-time payment, with no recurring charge.
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}
