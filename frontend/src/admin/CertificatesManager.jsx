import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import CertificateTemplates from './CertificateTemplates';

const TYPE_META = {
  course:    { icon: '🎓', label: 'Course Completion', badge: 'COURSE',    ring: '#eab308', grad: 'linear-gradient(135deg,#fde68a,#f59e0b,#b45309)' },
  quiz:      { icon: '📝', label: 'Quiz Excellence',    badge: 'QUIZ',      ring: '#3b82f6', grad: 'linear-gradient(135deg,#bfdbfe,#3b82f6,#1e3a8a)' },
  contest:   { icon: '🏆', label: 'Contest Champion',  badge: 'CONTEST',   ring: '#ef4444', grad: 'linear-gradient(135deg,#fecaca,#ef4444,#7f1d1d)' },
  milestone: { icon: '💻', label: 'Coding Milestone',  badge: 'MILESTONE', ring: '#10b981', grad: 'linear-gradient(135deg,#a7f3d0,#10b981,#064e3b)' },
  path:      { icon: '🛤️', label: 'Programme completion (legacy)', badge: 'PATH', ring: '#8b5cf6', grad: 'linear-gradient(135deg,#ddd6fe,#8b5cf6,#4c1d95)' },
};

function fd(d) { return d ? new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'; }

export default function CertificatesManager() {
  const [data, setData] = useState({ rows: [], total: 0, pages: 1 });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('all');     // all | active | revoked
  const [from, setFrom] = useState('');            // issued-on or after
  const [to, setTo] = useState('');                // issued-on or before
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState('issued');

  async function load() {
    setLoading(true);
    try {
      const { data: s } = await api.get('/admin/certificates/stats');
      setStats(s.data);
      const { data } = await api.get('/admin/certificates', {
        params: { page, type, search, status, from, to, limit: 15 },
      });
      setData(data.data);
    } catch (e) { setToast(e.response?.data?.message || e.message); }
    setLoading(false);
  }
  useEffect(() => { if (tab === 'issued') load(); /* eslint-disable-next-line */ }, [page, type, status, tab]);

  async function searchSubmit(e) { e.preventDefault(); setPage(1); await load(); }

  // A revocation is a tombstone: the row stays, the public link 410s. It used
  // to be silent and reasonless, and impossible to undo from the UI.
  async function revoke(c) {
    const reason = window.prompt(
      `Revoke ${c.certificate_no}?\n\nReason (shown in the admin list and the CSV export):`,
      '',
    );
    if (reason === null) return;                       // cancelled
    try {
      await api.delete('/admin/certificates/' + c.id, { data: { reason: reason.trim() } });
      setToast(reason.trim() ? 'Certificate revoked with reason' : 'Certificate revoked');
      load();
    } catch (e) { setToast(e.response?.data?.error || e.message); }
  }

  async function restore(c) {
    if (!window.confirm(`Restore ${c.certificate_no}?\nThe same certificate number and public link become valid again.`)) return;
    try {
      await api.post('/admin/certificates/' + c.id + '/restore');
      setToast('Certificate restored');
      load();
    } catch (e) { setToast(e.response?.data?.error || e.message); }
  }

  /** CSV of the current filter — the server applies the same filters as the list. */
  function exportCsv() {
    const params = new URLSearchParams({ type, search, status, from, to });
    const token = localStorage.getItem('token') || localStorage.getItem('access_token') || '';
    // The export needs the auth header, so fetch + blob instead of a bare <a href>.
    api.get('/admin/certificates/export.csv', { params: Object.fromEntries(params), responseType: 'blob' })
      .then((res) => {
        const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `certificates-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        setToast('CSV exported');
      })
      .catch((e) => setToast(e.response?.data?.error || e.message || 'Export failed'));
    void token;
  }
  async function reissue(id) {
    await api.post('/admin/certificates/' + id + '/reissue');
    setToast('Public link regenerated');
    load();
  }

  const typeCount = {};
  stats?.byType?.forEach((t) => (typeCount[t.cert_type] = t.n));

  return (
    <div className="page-wrap" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">ADMIN • CREDENTIALS</div>
          <h1 className="theme-heading" style={{ margin: '8px 0', fontSize: 28 }}>Certificate Manager</h1>
          <p className="theme-muted" style={{ margin: 0 }}>View, verify, revoke and re-issue course and legacy programme certificates — and design their print templates.</p>
        </div>

      </div>

      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
        {[['issued', '📜 Issued certificates'], ['templates', '🎨 Design templates']].map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              padding: '9px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
              background: 'none', border: 0, borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`,
              color: tab === k ? 'var(--heading)' : 'var(--muted)', marginBottom: -1,
            }}
          >{lbl}
          </button>
        ))}
      </div>

      {tab === 'templates' ? <CertificateTemplates /> : (
      <>
      {toast && <div className="notice success" style={{ marginBottom: 12 }}>{toast}</div>}

      {/* stats strip */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <StatCard label="TOTAL" value={stats.total} color="#6366f1" />
          {Object.entries(TYPE_META).map(([t, m]) => (
            <StatCard key={t} label={m.badge} value={typeCount[t] || 0} color={m.ring} icon={m.icon} />
          ))}
        </div>
      )}

      {/* filters */}
      <div className="panel" style={{ marginBottom: 16, padding: 14 }}>
        <form onSubmit={searchSubmit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input className="input" placeholder="Search by name / email / cert no / title…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: '1 1 280px' }} />
          <select className="select" aria-label="Filter by certificate type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} style={{ width: 180 }}>
            <option value="">All types</option>
            <option value="course">🎓 Course</option>
            <option value="quiz">📝 Quiz</option>
            <option value="contest">🏆 Contest</option>
            <option value="milestone">💻 Milestone</option>
            <option value="path">🛤️ Programme (legacy)</option>
          </select>
          <select className="select" aria-label="Filter by status" value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 150 }}>
            <option value="all">All statuses</option>
            <option value="active">✅ Active only</option>
            <option value="revoked">🚫 Revoked only</option>
          </select>
          <label className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            From <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          </label>
          <label className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            To <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </label>
          <button className="btn btn-primary" type="submit">Search</button>
          <button className="btn" type="button" onClick={exportCsv} title="Download the current filter as CSV">⬇️ CSV</button>
          {(type || search || status !== 'all' || from || to) && (
            <button className="btn btn-ghost" type="button"
              onClick={() => { setType(''); setSearch(''); setStatus('all'); setFrom(''); setTo(''); setPage(1); load(); }}>
              Clear
            </button>
          )}
        </form>
      </div>

      {loading ? <div className="panel"><div className="spinner" /></div> :
        data.rows.length === 0 ? (
          <div className="panel" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 56 }}>🎓</div>
            <h2 className="theme-heading">No certificates yet</h2>
            <p className="theme-muted">Certificates appear here after learners complete eligible courses, meet quiz/contest criteria, or unlock coding milestones.</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 12 }}>
              {data.rows.map((c) => {
                const meta = TYPE_META[c.cert_type] || TYPE_META.course;
                return (
                  <div key={c.id} className="panel" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 12, background: meta.grad, display: 'grid', placeItems: 'center', fontSize: 24, flex: 'none' }}>{meta.icon}</div>
                    <div style={{ flex: '1 1 300px', minWidth: 200 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="badge" style={{ background: `${meta.ring}20`, color: meta.ring, borderColor: `${meta.ring}55` }}>{meta.icon} {meta.badge}</span>
                        <span className="tiny theme-muted">{c.certificate_no}</span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--heading)', marginTop: 4 }}>{c.display_title || '—'}</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                        👤 <b>{c.student_name}</b> <span className="tiny">({c.student_email})</span>
                        {c.student_college && <span> • {c.student_college}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                      <Stat label="Grade / Tier" value={c.grade || '—'} sub={c.tier} />
                      <Stat label="Score" value={`${c.score_percent || 0}%`} />
                      <Stat label="Issued" value={fd(c.issued_at)} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {c.revoked_at ? (
                        <>
                          <span className="badge" style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red)', borderColor: 'rgba(239,68,68,.3)' }}
                            title={c.revoke_reason || ''}>
                            REVOKED {fd(c.revoked_at)}
                          </span>
                          {c.revoke_reason && <span className="tiny muted" style={{ flexBasis: '100%' }}>Reason: {c.revoke_reason}</span>}
                          <button className="btn btn-sm btn-ghost" onClick={() => restore(c)} title="Undo the revocation">↩️ Restore</button>
                        </>
                      ) : (
                        <>
                          <Link to={`/cert/${encodeURIComponent(c.public_token)}`} target="_blank" className="btn btn-sm btn-ghost">🔗 View</Link>
                          <a href={`/api/cert/${encodeURIComponent(c.public_token)}/pdf`} className="btn btn-sm btn-primary">⬇️ PDF</a>
                          <a href={`/api/cert/${encodeURIComponent(c.public_token)}/print`} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">🖨️</a>
                          <button className="btn btn-sm btn-ghost" onClick={() => reissue(c.id)} title="Regenerate public link">🔄</button>
                          <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red)', border: '1px solid rgba(239,68,68,.3)' }} onClick={() => revoke(c)}>🗑 Revoke</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {data.pages > 1 && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
                <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
                <span className="theme-muted" style={{ alignSelf: 'center' }}>Page {page} of {data.pages} • {data.total} total</span>
                <button className="btn btn-ghost btn-sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next →</button>
              </div>
            )}
          </>
        )
      }
      </>
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <div className="panel" style={{ padding: '14px 18px', flex: '1 1 130px', borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1 }}>{icon || ''} {label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--heading)' }}>{value}</div>
    </div>
  );
}
function Stat({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontWeight: 700, color: 'var(--heading)', fontSize: 15 }}>{value}</div>
      {sub && <div className="tiny theme-muted">{sub}</div>}
    </div>
  );
}
