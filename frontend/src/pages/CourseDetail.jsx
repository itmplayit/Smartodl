import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { courseApi, certApi, upiApi, billingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, DiffBadge, Empty, ErrorBox, Loader, Modal } from '../components/ui';
import UpiPayment from '../components/UpiPayment';
import { postToPaytm, openRazorpay } from './Pricing';
import Reviews from '../components/Reviews';
import Discussions from '../components/Discussions';
import { safeExternalHref } from '../utils/safeUrl';

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
    setLessonLoading(true);
    try {
      const { data } = await courseApi.lesson(lesson.id);
      if (lessonRequest.current === requestId) setLessonContent(data.data);
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

  return (
    <div className="container section">
      <div className="split">
        <div>
          <div className="row wrap mb-s" style={{ gap: 8 }}>
            <DiffBadge value={course.difficulty} />
            {course.category_name && <span className="tag">{course.category_name}</span>}
            {course.language && <span className="tag">{course.language}</span>}
            {course.status !== 'published' && <Badge tone="amber">{course.status}</Badge>}
          </div>
          <h1 style={{ fontSize: '2rem' }}>{course.title}</h1>
          <p className="muted">{course.summary}</p>
          <div className="row wrap mt-s" style={{ gap: 14 }}>
            <span className="small">👨‍🏫 {course.instructor_name || 'SmartODL'}</span>
            <span className="small">⭐ {Number(course.rating).toFixed(1)}</span>
            <span className="small">🎓 {course.total_students} students</span>
            <span className="small">⏱ {course.duration_hours} hours</span>
            <span className="small">📚 {course.lessons_count} lessons</span>
          </div>
          <div className="divider" />
          <h3>About this course</h3>
          <p style={{ whiteSpace: 'pre-wrap' }} className="muted">{course.description}</p>

          <h3 className="mt">Course content</h3>
          <div className="stack" style={{ gap: 10 }}>
            {course.modules.map((m) => (
              <div className="panel" key={m.id}>
                <div className="between">
                  <strong>{m.position}. {m.title}</strong>
                  <span className="tiny muted">{m.lessons.length} lessons</span>
                </div>
                {m.description && <p className="tiny muted">{m.description}</p>}
                <div className="list-tight mt-s">
                  {m.lessons.map((l) => (
                    <div key={l.id} className="between">
                      <button className="btn btn-sm btn-ghost" style={{ textAlign: 'left' }} onClick={() => openLessonContent(l)}>
                        {l.locked ? '🔒' : l.is_preview ? '▶' : '📗'} {l.title}
                        {l.is_preview && <span className="tag">preview</span>}
                      </button>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="tiny muted">{l.duration_minutes} min</span>
                        {course.enrollment && (
                          <button className="btn btn-sm btn-ghost" onClick={() => completeLesson(l.id)}>Mark complete</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {openLesson && (lessonLoading || lessonContent) && (
            <div className="card mt">
              <div className="between">
                <h3>{lessonContent?.title || 'Loading lesson…'}</h3>
                <button className="icon-btn" onClick={() => { lessonRequest.current += 1; setOpenLesson(null); setLessonContent(null); setLessonLoading(false); }}>✕</button>
              </div>
              {lessonLoading ? <Loader label="Opening lesson…" /> : (
                <>
                  {safeExternalHref(lessonContent.video_url) && (
                    <div className="soft mb-s tiny">🎬 Video: <a className="link" href={safeExternalHref(lessonContent.video_url)} target="_blank" rel="noreferrer">{lessonContent.video_url}</a></div>
                  )}
                  {safeExternalHref(lessonContent.resource_url) && (
                    <div className="soft mb-s tiny">📎 Resource: <a className="link" href={safeExternalHref(lessonContent.resource_url)} target="_blank" rel="noreferrer">{lessonContent.resource_url}</a></div>
                  )}
                  <div style={{ whiteSpace: 'pre-wrap' }} className="muted">{lessonContent.content || 'Lesson content will appear here.'}</div>
                </>
              )}
            </div>
          )}

          {course.notes && course.notes.length > 0 && (
            <>
              <h3 className="mt">Course notes</h3>
              <div className="list-tight card">
                {course.notes.map((n) => (
                  <div key={n.id} className="between">
                    <span className="small">📄 {n.title}</span>
                    <Link className="btn btn-sm btn-ghost" to="/notes">Open library</Link>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="stack" style={{ position: 'sticky', top: 84 }}>
          <div className="card">
            {course.thumbnail
              ? <img src={course.thumbnail} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 12 }} />
              : <div style={{ height: 150, borderRadius: 10, marginBottom: 12, display: 'grid', placeItems: 'center', fontSize: '3rem', background: 'linear-gradient(135deg,#4f46e5,#0f172a)' }}>📘</div>}
            {course.enrollment ? (
              <>
                <Badge tone="green">✓ Enrolled</Badge>
                <div className="mt-s">
                  <div className="between small"><span>Your progress</span><span>{progress}%</span></div>
                  <div className="progress mt-s"><i style={{ width: `${progress}%` }} /></div>
                </div>
                {course.enrollment.status === 'completed' ? (
                  <div className="notice success mt" style={{textAlign:'left'}}>
                    🎓 <b>Course completed!</b>
                    {cert ? (
                      <>
                        <p className="tiny" style={{margin:'6px 0 10px',opacity:.85}}>Certificate #{cert.certificate_no} • Grade {cert.grade}</p>
                        <div className="row" style={{gap:8}}>
                          <a className="btn btn-primary btn-sm" href={certApi.printUrl(cert.public_token)} target="_blank" rel="noreferrer">🏅 View certificate</a>
                          <Link className="btn btn-ghost btn-sm" to={certApi.verifyUrl(cert.public_token)}>Verify link</Link>
                        </div>
                      </>
                    ) : <p className="tiny" style={{margin:'6px 0 0',opacity:.85}}>Your certificate is being prepared.</p>}
                  </div>
                ) : (
                  <Link className="btn btn-primary btn-block mt" to={user?.role === 'student' ? '/student/courses' : '/courses'}>Continue learning</Link>
                )}
              </>
            ) : (
              <>
                <div className="between">
                  <div><div className="tiny muted">Course access</div><div style={{ fontWeight: 800, fontSize: '1.4rem' }}>{Number(course.price) === 0 ? 'Free' : `₹${course.price}`}</div></div>
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
            <div className="stack" style={{ gap: 8 }}>
              <span className="small">✅ {course.modules.length} modules</span>
              <span className="small">✅ {course.lessons_count} video lessons</span>
              <span className="small">✅ Downloadable notes</span>
              <span className="small">✅ Quizzes & coding practice</span>
              <span className="small">✅ Certificate of completion</span>
            </div>
          </div>
          {!user && <div className="soft small">🔐 Log in to track progress, take quizzes and download notes.</div>}
        </div>
      </div>
      {course.modules.length === 0 && <Empty title="No modules yet" hint="The instructor is still building this course." />}

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
