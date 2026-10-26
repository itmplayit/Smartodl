import { useEffect, useState } from 'react';
import { userApi } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Avatar, Empty, Loader, StatusBadge } from '../components/ui';
import { fmtNum, timeAgo } from '../utils/format';

const UNSET_LABEL = '(College not set)';
const ROLE_TABS = [['', '📂 All'], ['student', '👨‍🎓 Students'], ['developer', '👨‍💻 Developers']];

/** Administrator-only Colleges section — students and developers grouped by college name. */
export default function Colleges() {
  const toast = useToast();
  const [summary, setSummary] = useState(null); // { colleges: [...], unset: {...} }
  const [search, setSearch] = useState('');

  // members-view state
  const [selected, setSelected] = useState(null); // { college: string } or { unset: true }
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [stats, setStats] = useState(null);
  const [role, setRole] = useState('');
  const [mSearch, setMSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 12;

  const loadSummary = async () => {
    try {
      const params = search ? { search } : {};
      const { data } = await userApi.colleges(params);
      setSummary(data.data);
    } catch (err) { toast.error(err.message); }
  };
  useEffect(() => { loadSummary(); /* eslint-disable-next-line */ }, [search]);

  const loadMembers = async () => {
    if (!selected) return;
    setRows(null);
    const params = { page, limit };
    if (selected.unset) params.unset = 1;
    else params.college = selected.college;
    if (role) params.role = role;
    if (mSearch) params.search = mSearch;
    try {
      const { data } = await userApi.collegeMembers(params);
      setRows(data.data);
      setMeta(data.meta);
      setStats(data.meta.summary);
    } catch (err) { toast.error(err.message); setRows([]); }
  };
  useEffect(() => { loadMembers(); /* eslint-disable-next-line */ }, [selected, role, mSearch, page]);

  const openCollege = (entry) => {
    setSelected(entry);
    setRole(''); setMSearch(''); setPage(1);
    setRows(null); setMeta(null); setStats(null);
  };
  const goBack = () => { setSelected(null); loadSummary(); };

  // ---------------- Grid view (all colleges) ----------------
  if (!selected) {
    const colleges = summary ? summary.colleges : [];
    const unset = summary ? summary.unset : null;
    return (
      <div className="container section">
        <div className="between wrap mb">
          <div><span className="eyebrow">People</span><h2>Colleges</h2>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Every college with a registered student or developer appears here as a card.
              Click a card to view all students and developers from that college together.
            </p>
          </div>
          <label className="field" style={{ minWidth: 260, marginBottom: 0 }}>College search
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="MIT, IIT, …" />
          </label>
        </div>

        {!summary ? (
          <Loader label="Loading colleges…" />
        ) : colleges.length === 0 && (!unset || unset.total === 0) ? (
          <Empty title="No college data yet" hint={search ? 'No college matches this search.' : 'When students and developers add a college to their profiles, they will appear here in groups.'} />
        ) : (
          <div className="row wrap" style={{ gap: 14, alignItems: 'stretch' }}>
            {colleges.map((c) => (
              <button key={c.college} type="button" className="card" onClick={() => openCollege({ college: c.college })}
                style={{ flex: '1 1 260px', maxWidth: 360, textAlign: 'left', cursor: 'pointer', border: '1px solid var(--line, #e5e7eb)' }}>
                <div style={{ fontSize: 26 }} aria-hidden="true">🏫</div>
                <h3 style={{ margin: '6px 0 4px' }}>{c.college}</h3>
                <div className="small muted">Total members: <b>{fmtNum(c.total)}</b></div>
                <div className="row wrap small" style={{ gap: 8, marginTop: 6 }}>
                  <span className="tag">👨‍🎓 {fmtNum(c.students)} students</span>
                  <span className="tag">👨‍💻 {fmtNum(c.developers)} developers</span>
                </div>
              </button>
            ))}
            {unset && unset.total > 0 && !search && (
              <button type="button" className="card" onClick={() => openCollege({ unset: true })}
                style={{ flex: '1 1 260px', maxWidth: 360, textAlign: 'left', cursor: 'pointer', opacity: 0.85, borderStyle: 'dashed', borderWidth: 1, borderColor: '#9ca3af' }}>
                <div style={{ fontSize: 26 }} aria-hidden="true">📭</div>
                <h3 style={{ margin: '6px 0 4px' }}>{UNSET_LABEL}</h3>
                <div className="small muted">These users have not added a college yet — total {fmtNum(unset.total)}</div>
                <div className="row wrap small" style={{ gap: 8, marginTop: 6 }}>
                  <span className="tag">👨‍🎓 {fmtNum(unset.students)} students</span>
                  <span className="tag">👨‍💻 {fmtNum(unset.developers)} developers</span>
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---------------- Members view (students and developers from one college) ----------------
  const title = selected.unset ? UNSET_LABEL : selected.college;
  const pages = meta ? Math.max(1, Math.ceil(meta.total / limit)) : 1;
  return (
    <div className="container section">
      <div className="between wrap mb">
        <div>
          <span className="eyebrow">Colleges</span>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            🏫 {title}
          </h2>
          <p className="muted small" style={{ marginBottom: 0 }}>
            {stats
              ? <>👨‍🎓 {fmtNum(stats.students)} students · 👨‍💻 {fmtNum(stats.developers)} developers · Total {fmtNum(stats.total)}</>
               : 'Loading members…'}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={goBack}>← All colleges</button>
      </div>

      <div className="tabs">
        {ROLE_TABS.map(([k, label]) => (
          <button key={k || 'all'} className={`tab ${role === k ? 'active' : ''}`}
            onClick={() => { setRole(k); setPage(1); }}>{label}</button>
        ))}
      </div>

      <div className="card mb mt">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1, minWidth: 240 }}>Search this college (name or email)
            <input className="input" value={mSearch} onChange={(e) => { setMSearch(e.target.value); setPage(1); }} placeholder="riya@…" />
          </label>
          <button className="btn btn-ghost" onClick={loadMembers}>🔄 Refresh</button>
        </div>
      </div>

      {!rows ? (
        <Loader label="Loading members…" />
      ) : rows.length === 0 ? (
        <Empty title="No member found" hint="Try changing the role filter or search." />
      ) : (
        <div className="table-wrap scroll-x">
          <table className="table">
            <thead>
              <tr><th>Member</th><th>Role</th><th>Status</th><th>Points</th><th>Solved</th><th>Joined</th></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <Avatar user={u} size={34} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{u.full_name}</div>
                        <div className="tiny muted">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="tag">{u.role === 'developer' ? '👨‍💻 Developer' : '👨‍🎓 Student'}</span></td>
                  <td><StatusBadge value={u.status} /></td>
                  <td>{fmtNum(u.points)}</td>
                  <td>{u.problems_solved}</td>
                  <td className="tiny muted">{timeAgo(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.total > limit && (
        <div className="row mt" style={{ justifyContent: 'center', gap: 10 }}>
          <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
          <span className="small muted">Page {meta.page} / {pages}</span>
          <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
