import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { certApi } from '../services/api';
import { certificateTierLabel, contestPlacementLabel, contestRankLabel } from '../utils/certificateLabels';

const TYPE_META = {
  course:    { icon: '🎓', label: 'Course Completion',    check: 'This credential verifies successful course completion.',               ring: '#eab308', grad: 'linear-gradient(135deg,#fde68a 0%,#f59e0b 55%,#b45309 100%)' },
  quiz:      { icon: '📝', label: 'Quiz Excellence',       check: 'This credential verifies outstanding performance in a live quiz.',     ring: '#3b82f6', grad: 'linear-gradient(135deg,#bfdbfe 0%,#3b82f6 55%,#1e3a8a 100%)' },
  contest:   { icon: '🏆', label: 'Contest Champion',     check: 'This credential verifies a top finish in a competitive contest.',      ring: '#ef4444', grad: 'linear-gradient(135deg,#fecaca 0%,#ef4444 55%,#7f1d1d 100%)' },
  milestone: { icon: '💻', label: 'Coding Milestone',     check: 'This credential verifies a significant programming milestone.',        ring: '#10b981', grad: 'linear-gradient(135deg,#a7f3d0 0%,#10b981 55%,#064e3b 100%)' },
  path:      { icon: '🛤️', label: 'Programme Completion', check: 'This credential verifies completion of every required course in a programme.', ring: '#8b5cf6', grad: 'linear-gradient(135deg,#ddd6fe 0%,#8b5cf6 55%,#4c1d95 100%)' },
};

export default function VerifyCert() {
  const { token } = useParams();
  const [cert, setCert] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    certApi.verify(token).then(({ data }) => {
      if (data.success && data.data?.valid !== false) setCert(data.data); else setErr(data.data?.message || data.message || 'Certificate not found.');
      setLoading(false);
    }).catch(() => { setErr('Could not verify certificate. It may have been revoked or the link is invalid.'); setLoading(false); });
  }, [token]);

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: 'var(--heading)' }}>Verifying…</div>;

  if (err || !cert) {
    return (
      <div className="page-wrap" style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <div className="panel" style={{ maxWidth: 600, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 64 }}>❌</div>
          <h2 style={{ color: 'var(--heading)' }}>Certificate not found</h2>
          <p style={{ color: '#94a3b8' }}>{err}</p>
          <Link to="/login" className="btn btn-primary" style={{ marginTop: 12 }}>Back to SmartODL</Link>
        </div>
      </div>
    );
  }

  const certType = cert.cert_type || cert.type || 'course';
  const scorePct = Number(cert.score_percent ?? cert.score_pct ?? 0);
  const meta = TYPE_META[certType] || TYPE_META.course;
  const subjectLine =
    certType === 'quiz' ? `Scored ${scorePct}% on the "${cert.quiz_title || cert.title}" quiz.`
    : certType === 'contest' ? `Finished in ${cert.tier ? contestPlacementLabel(cert.tier) : 'a top position'} in the "${cert.contest_title || cert.title}" contest.`
    : certType === 'milestone' ? `Achieved the ${(cert.tier || 'milestone').replace(/_/g,' ')} milestone.`
    : certType === 'path' ? `Completed every required course in the "${cert.title}" programme.`
    : `Completed the "${cert.course_title || cert.title}" course.`;

  return (
    <div className="page-wrap" style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div className="verify-banner" style={{ borderLeft: `6px solid ${meta.ring}` }}>
        <div className="verify-check" style={{ background: meta.ring }}>{meta.icon}</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{meta.label} Verified</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{meta.check}</div>
        </div>
      </div>

      <div className="cert-card" style={{ position: 'relative', overflow: 'hidden', marginTop: 20 }}>
        <div className="cert-card-bg" style={{ background: meta.grad }} />
        <div style={{ position: 'relative' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.3)', color: '#0f172a', fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>
              SMARTODL • {meta.label.toUpperCase()}
            </span>
            <h1 style={{ fontSize: 32, color: '#0f172a', margin: '16px 0 4px', fontFamily: 'Georgia, serif' }}>Certificate of {meta.label.replace(/(Course|Quiz|Contest|Coding) /,'')}</h1>
            <p style={{ color: 'rgba(15,23,42,0.7)', margin: 0 }}>This certificate is hereby awarded to</p>
          </div>

          <div style={{ textAlign: 'center', padding: '8px 0 12px', borderTop: '2px solid rgba(15,23,42,0.15)', borderBottom: '2px solid rgba(15,23,42,0.15)' }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: '#0f172a', fontFamily: 'Georgia, serif' }}>{cert.student_name}</div>
            <div style={{ color: 'rgba(15,23,42,0.7)', marginTop: 4 }}>{subjectLine}</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 20, flexWrap: 'wrap', gap: 12 }}>
            {certType === 'course' && (
              <>
                <div className="stat-small"><div>Grade</div><strong style={{ color: '#0f172a' }}>{cert.grade || '—'}</strong></div>
                <div className="stat-small"><div>Score</div><strong>{scorePct}%</strong></div>
              </>
            )}
            {certType === 'quiz' && (
              <>
                <div className="stat-small"><div>Score</div><strong>{scorePct}%</strong></div>
                <div className="stat-small"><div>Recognition</div><strong>{certificateTierLabel(cert.tier) || '—'}</strong></div>
              </>
            )}
            {certType === 'contest' && (
              <div className="stat-small"><div>Final Rank</div><strong>{contestRankLabel(cert.tier)}</strong></div>
            )}
            {certType === 'milestone' && (
              <div className="stat-small"><div>Tier</div><strong>{certificateTierLabel(cert.tier) || '—'}</strong></div>
            )}
            {cert.integrity && cert.integrity.shown && (
              <div className="stat-small">
                <div>Integrity review</div>
                <strong style={{ color: cert.integrity.tone === 'green' ? '#16a34a' : cert.integrity.tone === 'red' ? '#dc2626' : cert.integrity.tone === 'yellow' ? '#d97706' : '#64748b' }}>
                  ● {cert.integrity.label}
                  {cert.integrity.available ? ` · ${Number(cert.integrity.score).toFixed(0)}/100` : ''}
                </strong>
              </div>
            )}
            <div className="stat-small"><div>Issued</div><strong>{new Date(cert.issued_at).toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'})}</strong></div>
            <div className="stat-small"><div>Certificate No.</div><strong style={{ fontSize: 11 }}>{cert.certificate_no}</strong></div>
          </div>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ borderTop: '2px solid rgba(15,23,42,0.4)', width: 180, paddingTop: 4, color: '#0f172a', fontSize: 13 }}>
                {cert.issuer_name || cert.instructor_name || 'SmartODL Academy'}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(15,23,42,0.7)' }}>Authorized Signatory</div>
            </div>
            <div className="cert-seal" style={{ background: meta.ring }}>{meta.icon}</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        {cert.public_token && <><a href={certApi.printUrl(cert.public_token)} target="_blank" rel="noreferrer" className="btn btn-primary">🖨️ Print / Save as PDF</a>{' '}</>}
        <Link to="/login" className="btn btn-ghost" style={{ background: 'var(--panel-2)', color: 'var(--heading)' }}>Back to SmartODL</Link>
      </div>

      {cert.integrity && cert.integrity.shown && (
        <p style={{ textAlign: 'center', color: '#64748b', fontSize: 12, marginTop: 12 }}>
          {cert.integrity.note}
        </p>
      )}

      <p style={{ textAlign: 'center', color: '#64748b', fontSize: 12, marginTop: 16 }}>
        Anyone with the verification link or certificate number can confirm this summary. Printing requires the certificate holder's private print link. Certificate ID: <code>{cert.certificate_no}</code>
      </p>
    </div>
  );
}
