import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';

const STATUS_LABEL = {
  in_progress: 'In progress',
  active: 'In progress',
  submitted: 'Submitted',
  evaluated: 'Evaluated',
  expired: 'Expired',
  abandoned: 'Abandoned (time over)',
};

function scoreText(quiz) {
  if (!quiz.attempt_id) return null;
  const total = Number(quiz.attempt_total_marks || quiz.total_marks || 0);
  const score = Number(quiz.attempt_score || 0);
  if (!total) return `${score} marks`;
  return `${score}/${total} · ${Math.round((score / total) * 100)}%`;
}

/**
 * Assessments for this course, shown on the course page itself.
 *
 * The link only opens the normal quiz flow — enrolment, premium and privacy
 * checks stay exactly where they were in the quiz controller.
 */
export default function CourseQuizzes({ course, canManage = false }) {
  // Module quizzes live INSIDE their module, so they are deliberately absent
  // from course.quizzes. Say so instead of claiming nothing is linked.
  const moduleQuizCount = (course.modules || []).reduce(
    (n, m) => n + (Array.isArray(m.quizzes) ? m.quizzes.length : (m.quiz ? 1 : 0)), 0,
  );
  const quizzes = course.quizzes || [];
  if (!quizzes.length) {
    return canManage ? (
      <section className="card mt">
        <div className="between wrap">
          <div>
            <h3 style={{ marginBottom: 4 }}>🧠 Course assessments</h3>
            <p className="tiny muted" style={{ margin: 0 }}>
              {moduleQuizCount > 0
                ? `${moduleQuizCount} module quiz${moduleQuizCount === 1 ? '' : 'zes'} is attached to the modules above — module quizzes gate that module's lessons, so they are not repeated here. `
                : 'No quiz is linked to this course yet. Link one from '}
              {moduleQuizCount > 0 ? '' : <Link className="link" to="/admin/quizzes">Admin → Quizzes → Edit quiz → “Linked course”</Link>}
              {moduleQuizCount > 0 ? 'A course-level quiz is optional.' : '.'}
            </p>
          </div>
        </div>
      </section>
    ) : null;
  }

  return (
    <section className="card mt" aria-label="Course assessments">
      <div className="between wrap mb-s">
        <div>
          <h3 style={{ marginBottom: 4 }}>🧠 Course assessments</h3>
          <p className="tiny muted" style={{ margin: 0 }}>
            Quizzes linked to this course. Passing marks and attempts work exactly as configured by the instructor.
          </p>
        </div>
        <span className="tag">{quizzes.length} quiz{quizzes.length === 1 ? '' : 'zes'}</span>
      </div>

      {quizzes.length === 0 ? <Empty title="No assessments" /> : (
        <div className="stack" style={{ gap: 10 }}>
          {quizzes.map((quiz) => {
            const attempted = !!quiz.attempt_id;
            return (
              <div className="panel between wrap" key={quiz.id} style={{ gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 7 }}>
                    <strong>{quiz.title}</strong>
                    <span className="tag">{quiz.quiz_type}</span>
                    {Number(quiz.is_premium) === 1 && <span className="tag">premium</span>}
                    {Number(quiz.status) !== 1 && quiz.status !== 'published' && <span className="tag">{quiz.status}</span>}
                  </div>
                  {quiz.description && <p className="tiny muted" style={{ margin: '4px 0 0' }}>{quiz.description}</p>}
                  <div className="tiny muted" style={{ marginTop: 4 }}>
                    {quiz.question_count} questions · {quiz.total_marks} marks · pass {quiz.passing_score}% ·
                    {' '}{quiz.time_limit_minutes} min
                    {attempted && <> · your last attempt: <b>{STATUS_LABEL[quiz.attempt_status] || quiz.attempt_status}</b> ({scoreText(quiz)})</>}
                  </div>
                </div>
                <Link className="btn btn-sm btn-ghost" to={`/quizzes/${quiz.id}`}>
                  {attempted ? 'Review / retake' : 'Open quiz'}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
