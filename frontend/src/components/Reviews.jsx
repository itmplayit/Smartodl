import { useEffect, useState } from 'react';
import { communityApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar, Loader } from './ui';
import { timeAgo } from '../utils/format';

const Stars = ({ value, size = '1rem' }) => (
  <span style={{ fontSize: size, color: '#fbbf24', letterSpacing: 2 }}>
    {[1, 2, 3, 4, 5].map((i) => (i <= Math.round(Number(value)) ? '★' : '☆')).join('')}
  </span>
);

/** Ratings & reviews for a course. */
export default function Reviews({ courseId }) {
  const { user } = useAuth();
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    communityApi.reviews(courseId)
      .then(({ data }) => {
        setInfo(data.data);
        if (data.data.mine) {
          setRating(data.data.mine.rating);
          setComment(data.data.mine.comment || '');
        }
      })
      .catch((e) => setError(e.message));
  };
  useEffect(load, [courseId]);

  const save = async () => {
    if (!rating) { toast.error('Select a star rating first'); return; }
    setSaving(true);
    try {
      await communityApi.saveReview(courseId, { rating, comment });
      toast.success(info?.mine ? 'Review updated' : 'Thanks for your review ⭐');
      load();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!info?.mine || !window.confirm('Delete your review?')) return;
    try {
      await communityApi.deleteReview(info.mine.id);
      setRating(0); setComment('');
      toast.success('Review deleted');
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (error) return <div className="error-box small">{error}</div>;
  if (!info) return <Loader label="Loading reviews…" />;

  return (
    <div>
      <div className="between wrap mb" style={{ gap: 12 }}>
        <div>
          <span style={{ fontSize: '2rem', fontWeight: 800 }}>{info.count ? info.average.toFixed(1) : '—'}</span>
          <span className="small muted"> / 5 • {info.count} review{info.count === 1 ? '' : 's'}</span>
          <div><Stars value={info.average || 0} /></div>
        </div>
        {user && (
          <div className="panel" style={{ minWidth: 260 }}>
            <div className="tiny muted mb-s">{info.mine ? 'Your review' : 'Rate this course'}</div>
            <div className="row" style={{ gap: 4 }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} type="button" aria-label={`Rate ${i} out of 5`} aria-pressed={rating === i} onClick={() => setRating(i)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', padding: 2, color: i <= rating ? '#fbbf24' : 'var(--muted)' }}>
                  ★
                </button>
              ))}
            </div>
            <textarea className="textarea mt-s" aria-label="Review comment" rows="2" placeholder="Describe your experience (optional)…" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="row mt-s" style={{ gap: 8, justifyContent: 'flex-end' }}>
              {info.mine && <button className="btn btn-sm btn-ghost" onClick={remove}>Delete</button>}
              <button className="btn btn-sm btn-primary" disabled={saving || !rating} onClick={save}>
                {saving ? 'Saving…' : info.mine ? 'Update review' : 'Submit review'}
              </button>
            </div>
          </div>
        )}
      </div>

      {info.reviews.length === 0 && <div className="empty">No reviews yet — yours could be the first!</div>}
      <div className="stack" style={{ gap: 8 }}>
        {info.reviews.map((r) => (
          <div className="panel" key={r.id}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <Avatar user={r} size={28} />
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <strong className="small">{r.full_name}</strong>
                  <Stars value={r.rating} size=".8rem" />
                </div>
                <div className="tiny muted">{timeAgo(r.created_at)}</div>
              </div>
            </div>
            {r.comment && <p className="small" style={{ marginBottom: 0 }}>{r.comment}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
