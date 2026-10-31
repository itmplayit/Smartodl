import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { certApi } from '../services/api';
import { certificateTierLabel, contestRankLabel } from '../utils/certificateLabels';
import { integrityTone as toneOf, normalizeTone } from '../utils/integrityTone';

const TYPE_META = {
  course:    { icon: '🎓', label: 'Course Completion',    badge: 'COURSE',    ring: '#eab308' },
  quiz:      { icon: '📝', label: 'Quiz Excellence',       badge: 'QUIZ',      ring: '#3b82f6' },
  contest:   { icon: '🏆', label: 'Contest Champion',     badge: 'CONTEST',   ring: '#ef4444' },
  milestone: { icon: '💻', label: 'Coding Milestone',     badge: 'MILESTONE', ring: '#10b981' },
  path:      { icon: '🛤️', label: 'Programme completion (legacy)', badge: 'PATH', ring: '#8b5cf6' },
};
function IntegrityChip({ integrity }) {
  if (!integrity || !integrity.shown) return null;
  // green / yellow / red — 'amber' purane payload ka alias hai
  const t = toneOf(integrity.tone);
  return (
    <div
      className={`integrity-chip tone-${normalizeTone(integrity.tone)}`}
      title={integrity.note || ''}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 10,
        padding: '4px 10px', borderRadius: 999,
        background: t.soft, border: `1px solid ${t.line}`, fontSize: 12, fontWeight: 700,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.ink, display: 'inline-block', boxShadow: `0 0 0 3px ${t.soft}` }} />
      <span style={{ color: t.ink }}>Integrity: {integrity.label}</span>
      <span style={{ fontWeight: 600, color: t.ink, opacity: 0.85 }}>
        {integrity.available ? `${Number(integrity.score).toFixed(0)}/100` : '—'}
      </span>
    </div>
  );
}

const GRAD = { 'A+': '#10b981', A: '#059669', B: '#3b82f6', C: '#f59e0b', D: '#f97316', F: '#ef4444' };
const GRADS = {
  course:    'linear-gradient(135deg,#fde68a 0%,#f59e0b 55%,#b45309 100%)',
  quiz:      'linear-gradient(135deg,#bfdbfe 0%,#3b82f6 55%,#1e3a8a 100%)',
  contest:   'linear-gradient(135deg,#fecaca 0%,#ef4444 55%,#7f1d1d 100%)',
  milestone: 'linear-gradient(135deg,#a7f3d0 0%,#10b981 55%,#064e3b 100%)',
  path:      'linear-gradient(135deg,#ddd6fe 0%,#8b5cf6 55%,#4c1d95 100%)',
};
function fd(d){ return d ? new Date(d).toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'}) : ''; }

export default function Certificates() {
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => {
    setLoading(true);
    certApi.mine()
      .then(({data}) => { setCerts(data.data || []); setErr(''); })
      .catch((e) => setErr(e.response?.data?.message || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);
  const counts = certs.reduce((a,c)=>{const t=c.cert_type||'course';a[t]=(a[t]||0)+1;return a;},{});
  if (loading) return <div style={{padding:24}}><div className="panel" style={{padding:48,textAlign:'center'}}><div className="spinner"/><div className="theme-muted" style={{marginTop:14}}>Loading certificates…</div></div></div>;
  if (err) return <div style={{padding:24}}><div className="notice" style={{borderColor:'rgba(239,68,68,.45)',background:'rgba(239,68,68,.1)',color:'#fca5a5'}}>⚠️ {err}</div></div>;

  return (
    <div style={{padding:24}}>
      <div style={{marginBottom:24}}>
        <div className="eyebrow">ACHIEVEMENTS</div>
        <h1 className="theme-heading" style={{margin:'8px 0',fontSize:28}}>🏅 My Certificates</h1>
        <p className="theme-muted" style={{margin:0}}>Verifiable, tamper-proof credentials earned on SmartODL.</p>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:24}}>
        {Object.entries(TYPE_META).map(([t,m]) => (
          <div key={t} className="panel" style={{padding:'14px 18px',flex:'1 1 140px',borderLeft:`4px solid ${m.ring}`}}>
            <div style={{fontSize:12,color:'var(--muted)',letterSpacing:1}}>{m.icon} {m.badge}</div>
            <div style={{fontSize:24,fontWeight:800,color:'var(--heading)'}}>{counts[t]||0}</div>
          </div>
        ))}
      </div>
      {certs.length===0 ? (
        <div className="panel" style={{padding:48,textAlign:'center'}}>
          <div style={{fontSize:56,marginBottom:12}}>🎓</div>
          <h2 className="theme-heading" style={{margin:0}}>No certificates yet</h2>
          <p className="theme-muted" style={{marginTop:8}}>Integrity review bands are shown for course certificates that have a linked, monitored assessment. They are review indicators, never a finding of misconduct. Complete courses, score high in quizzes, win contests and unlock coding milestones to earn certificates.</p>
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:20}}>
          {certs.map((c) => {
            const t = c.cert_type||'course';
            const meta = TYPE_META[t] || TYPE_META.course;
            const grad = GRADS[t] || GRADS.course;
            const title = c.display_title || c.title || c.course_title || c.quiz_title || c.contest_title || 'Certificate';
            let lbl='Grade', val=c.grade||'—';
            if (t==='quiz'){lbl='Score';val=`${Number(c.score_percent||0)}%`;}
            else if (t==='contest'){lbl='Rank';val=contestRankLabel(c.tier);}
            else if (t==='milestone'){lbl='Milestone';val=certificateTierLabel(c.tier)||'Achieved';}
            else if (t==='path'){lbl='Completion';val='100%';}
            return (
              <div key={c.id} className="cert-card">
                <div className="cert-card-bg" style={{background:grad}}><div className="cert-shine"/></div>
                <div className="cert-card-body">
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                    <div style={{flex:1,minWidth:0}}>
                      <span style={{display:'inline-block',padding:'4px 10px',borderRadius:999,background:'rgba(255,255,255,0.25)',color:'#0f172a',fontSize:11,fontWeight:700,letterSpacing:1}}>{meta.icon} {meta.badge}</span>
                      <div style={{marginTop:10,fontSize:11,color:'rgba(15,23,42,0.7)',letterSpacing:1,wordBreak:'break-all'}}>{c.certificate_no}</div>
                      <h3 style={{margin:'6px 0 2px',fontSize:17,color:'#0f172a'}}>{title}</h3>
                      <div style={{fontSize:13,color:'rgba(15,23,42,0.7)'}}>{meta.label}</div>
                    </div>
                    <div className="cert-seal" style={{position:'static',marginLeft:12,width:72,height:72,fontSize:'1.8rem',transform:'rotate(-8deg)',opacity:1,flex:'none',background:meta.ring,boxShadow:`0 0 0 3px rgba(255,255,255,0.35), 0 8px 20px ${meta.ring}80`}}>{meta.icon}</div>
                  </div>
                  <div style={{marginTop:18}}>
                    <div className="cert-kicker" style={{color:'#0f172a'}}>Awarded to</div>
                    <div style={{fontSize:20,fontWeight:800,color:'#0f172a'}}>{c.student_name}</div>
                  </div>
                  <IntegrityChip integrity={c.integrity} />
                  <div style={{display:'flex',gap:16,marginTop:16,flexWrap:'wrap'}}>
                    <div className="stat-small"><div>{lbl}</div><strong style={{color:t==='course'?(GRAD[c.grade]||'#64748b'):'#0f172a'}}>{val}</strong></div>
                    {t==='course' && <div className="stat-small"><div>Score</div><strong style={{color:'#0f172a'}}>{Number(c.score_percent||0)}%</strong></div>}
                    <div className="stat-small"><div>Issued</div><strong style={{color:'#0f172a'}}>{fd(c.issued_at)}</strong></div>
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:18,flexWrap:'wrap'}}>
                    <a href={certApi.pdfUrl(c.public_token)} download className="btn btn-primary" style={{flex:'1 1 150px',textAlign:'center'}}>⬇️ Download PDF</a>
                    <a href={certApi.printUrl(c.public_token)} target="_blank" rel="noreferrer" className="btn" style={{flex:'1 1 110px',textAlign:'center',background:'rgba(255,255,255,0.6)',color:'#0f172a',border:'1px solid rgba(15,23,42,.15)'}}>🖨️ Print</a>
                    <Link to={certApi.verifyUrl(c.public_token)} className="btn" style={{flex:'1 1 100px',textAlign:'center',background:'rgba(255,255,255,0.6)',color:'#0f172a',border:'1px solid rgba(15,23,42,.15)'}}>🔗 Verify</Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
