import { useEffect, useState } from 'react';
import { communityApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar, Loader } from './ui';
import { timeAgo } from '../utils/format';

/** Q&A discussion board attached to a problem or a course. */
export default function Discussions({ parentType, parentId }) {
  const { user } = useAuth();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  // open thread state
  const [open, setOpen] = useState(null); // { discussion, replies }
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const load = () => {
    setLoading(true);
    communityApi.discussions(parentType, parentId)
      .then(({ data }) => setList(data.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [parentType, parentId]);

  const openThread = async (d) => {
    setOpen({ discussion: d, replies: null });
    try {
      const { data } = await communityApi.replies(d.id);
      setOpen(data.data);
    } catch (e) { toast.error(e.message); setOpen(null); }
  };

  const postThread = async () => {
    if (!title.trim() || !body.trim()) { toast.error('Both a title and details are required'); return; }
    setPosting(true);
    try {
      await communityApi.createDiscussion({ parent_type: parentType, parent_id: parentId, title, body });
      setTitle(''); setBody('');
      toast.success('Discussion posted');
      load();
    } catch (e) { toast.error(e.message); } finally { setPosting(false); }
  };

  const postReply = async () => {
    if (!replyText.trim() || !open) return;
    setReplying(true);
    try {
      await communityApi.addReply(open.discussion.id, replyText);
      setReplyText('');
      await openThread(open.discussion);
      toast.success('Reply posted');
    } catch (e) { toast.error(e.message); } finally { setReplying(false); }
  };

  /* ------------------------------ thread view ------------------------------ */
  if (open) {
    const d = open.discussion;
    return (
      <div>
        <button className="btn btn-sm btn-ghost mb" onClick={() => setOpen(null)}>← All discussions</button>
        <div className="panel">
          <div className="row" style={{ gap: 10, marginBottom: 8 }}>
            <Avatar user={d} size={32} />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{d.title}</h3>
              <div className="tiny muted">{d.full_name} • {timeAgo(d.created_at)}</div>
            </div>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{d.body}</p>
        </div>

        <h4 className="mt">{(open.replies || []).length} repl{(open.replies || []).length === 1 ? 'y' : 'ies'}</h4>
        {open.replies === null && <Loader label="Loading replies…" />}
        {open.replies && open.replies.length === 0 && <div className="empty">Be the first to reply 🙌</div>}
        <div className="stack mt-s" style={{ gap: 8 }}>
          {(open.replies || []).map((r) => (
            <div className="panel" key={r.id}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <Avatar user={r} size={26} />
                <strong className="small">{r.full_name}</strong>
                <span className="tiny muted">{timeAgo(r.created_at)}</span>
              </div>
              <p className="small" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{r.body}</p>
            </div>
          ))}
        </div>

        {user ? (
          <div className="mt">
            <textarea className="textarea" aria-label="Write a reply" rows="3" placeholder="Write a helpful reply…" value={replyText} onChange={(e) => setReplyText(e.target.value)} />
            <div className="row mt-s" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-sm btn-primary" disabled={replying || !replyText.trim()} onClick={postReply}>
                {replying ? 'Posting…' : 'Post reply'}
              </button>
            </div>
          </div>
        ) : <div className="soft small mt">Log in to reply.</div>}
      </div>
    );
  }

  /* ------------------------------- list view ------------------------------- */
  return (
    <div>
      {user && (
        <div className="panel mb">
          <h4 style={{ marginTop: 0 }}>💬 Start a new discussion</h4>
          <input className="input" aria-label="Discussion title" placeholder="Write a question title…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="textarea mt-s" aria-label="Discussion details" rows="3" placeholder="Details — what is your doubt, and what have you tried?…" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="row mt-s" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-primary" disabled={posting} onClick={postThread}>{posting ? 'Posting…' : 'Post discussion'}</button>
          </div>
        </div>
      )}
      {!user && <div className="soft small mb">You do not need to log in to read discussions, but you must log in to write.</div>}

      {loading && <Loader label="Loading discussions…" />}
      {error && <div className="error-box small">{error}</div>}
      {!loading && !error && list.length === 0 && <div className="empty">No discussions yet — ask the first question!</div>}
      <div className="stack" style={{ gap: 8 }}>
        {list.map((d) => (
          <button type="button" className="panel discussion-card" key={d.id} onClick={() => openThread(d)}>
            <div className="between">
              <strong className="small">{d.title}</strong>
              <span className="tag">💬 {d.reply_count}</span>
            </div>
            <div className="tiny muted mt-s">by {d.full_name} • {d.reply_count > 0 ? `last activity ${timeAgo(d.last_reply_at || d.created_at)}` : timeAgo(d.created_at)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
