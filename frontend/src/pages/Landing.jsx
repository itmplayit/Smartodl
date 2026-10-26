import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { courseApi, noteApi, quizApi, codingApi, contestApi, miscApi, communityApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useLang } from '../context/LangContext';
import { CourseCard, DiffBadge, StatusBadge, Countdown } from '../components/ui';
import Icon from '../components/Icon';
import TechnologyMarquee from '../components/TechnologyMarquee';
import LandingBanner from '../components/LandingBanner';
import { FALLBACK_LANDING_DOCUMENT, cloneLandingValue } from '../config/landingBuilder';
import { timeAgo } from '../utils/format';

function AnimatedNumber({ value }) {
  const number = Number(value) || 0;
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDisplay(number); return undefined; }
    let frame; const start = performance.now();
    const tick = (now) => { const progress = Math.min(1, (now - start) / 900); setDisplay(Math.round(number * (1 - (1 - progress) ** 3))); if (progress < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [number]);
  return display.toLocaleString('en-IN');
}

const EMPTY_DATA = { courses: [], notes: [], quizzes: [], problems: [], contests: [], top: [] };
const dateBadge = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { day: '—', month: 'Quiz' };
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: date.toLocaleString('en', { month: 'short' }),
  };
};
const safeTarget = (value) => {
  const target = String(value || '').trim();
  if (/^\/(?!\/)/.test(target) || /^https?:\/\//i.test(target)) return target;
  return '';
};

function SmartLink({ to, children, ...props }) {
  const target = safeTarget(to);
  if (!target) return null;
  if (/^https?:\/\//i.test(target)) return <a href={target} target="_blank" rel="noreferrer" {...props}>{children}</a>;
  return <Link to={target} {...props}>{children}</Link>;
}

const sectionClass = (block, base = '') => `${base} landing-builder-section landing-builder-bg-${block.style?.background || 'default'} landing-builder-pad-${block.style?.padding || 'normal'} landing-builder-align-${block.style?.alignment || 'left'} landing-layout-${block.style?.layout || 'default'}`.trim();
const sectionVars = (block) => ({ '--landing-columns': Math.max(1, Math.min(6, Number(block.style?.columns || 3))) });

function CodePreview() {
  return (
    <div className="institution-code-preview" aria-label="SmartODL coding workspace preview">
      <div className="code-preview-top"><span className="window-dots"><i /><i /><i /></span><span>solution.py — SmartODL judge</span><span className="code-live">Ready</span></div>
      <div className="code-preview-body"><div className="code-preview-sidebar" aria-hidden="true"><strong>Practice</strong><i className="active" /><i /><i /><i /><i /></div><div className="code-preview-main">
        <div className="code-preview-title"><div><strong>Second Largest Element</strong><span>Algorithms • 20 points</span></div><span className="code-language">Python 3</span></div>
        <pre tabIndex={0} aria-label="Python solution example"><span className="code-comment"># return the second largest distinct value</span>{'\n'}<span className="code-keyword">def</span> <span className="code-function">second_largest</span>(values):{'\n'}{'    '}unique = <span className="code-function">sorted</span>(<span className="code-function">set</span>(values)){'\n'}{'    '}<span className="code-keyword">if</span> <span className="code-function">len</span>(unique) &lt; <span className="code-number">2</span>:{'\n'}{'        '}<span className="code-keyword">return</span> <span className="code-number">-1</span>{'\n'}{'    '}<span className="code-keyword">return</span> unique[<span className="code-number">-2</span>]</pre>
        <div className="code-result"><span><Icon name="check" size={16} />Accepted</span><span>8 / 8 tests • 0.42s</span></div>
      </div></div>
    </div>
  );
}

export default function Landing({ preview = false }) {
  const { user } = useAuth();
  const { isOn } = useSettings();
  const { t } = useLang();
  const navigate = useNavigate();
  const [data, setData] = useState(EMPTY_DATA);
  const [stats, setStats] = useState(null);
  const [potd, setPotd] = useState(null);
  const [loading, setLoading] = useState(true);
  const [programmeQuery, setProgrammeQuery] = useState('');
  const [pageConfig, setPageConfig] = useState(() => cloneLandingValue(FALLBACK_LANDING_DOCUMENT));

  useEffect(() => {
    let live = true;
    const request = preview ? miscApi.landingBuilder() : miscApi.publicLandingPage();
    request.then(({ data: response }) => {
      if (!live) return;
      const next = preview ? response.data?.draft : response.data?.document;
      if (next?.sections) setPageConfig(next);
    }).catch(() => {});
    return () => { live = false; };
  }, [preview]);

  useEffect(() => {
    if (!preview) return undefined;
    const receive = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'smartodl:landing-preview') return;
      if (event.data.document?.sections) setPageConfig(event.data.document);
    };
    window.addEventListener('message', receive);
    window.parent?.postMessage({ type: 'smartodl:landing-preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', receive);
  }, [preview]);

  useEffect(() => {
    let live = true;
    (async () => {
      communityApi.problemOfDay().then(({ data: response }) => { if (live) setPotd(response.data); }).catch(() => {});
      const results = await Promise.allSettled([
        courseApi.list({ limit: 6, sort: 'total_students' }), noteApi.list({ limit: 4, sort: 'created_at' }), quizApi.list({ limit: 4 }),
        codingApi.problems({ limit: 6, sort: 'total_submissions' }), contestApi.list(), miscApi.leaderboard({ scope: 'global', limit: 5 }), miscApi.publicStats(),
      ]);
      if (!live) return;
      const value = (index, fallback) => results[index].status === 'fulfilled' ? results[index].value.data.data : fallback;
      setData({ courses: value(0, []), notes: value(1, []), quizzes: value(2, []), problems: value(3, []), contests: value(4, []), top: value(5, []) });
      setStats(value(6, null)); setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const sections = [...document.querySelectorAll('.edu-landing .landing-section, .edu-landing .landing-stats, .edu-landing .landing-final-cta, .edu-landing .landing-generic-section')];
    if (!sections.length) return undefined;
    sections.forEach((section) => { section.classList.remove('motion-reveal', 'is-visible'); if (pageConfig.theme?.motion !== false) section.classList.add('motion-reveal'); });
    if (pageConfig.theme?.motion === false || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) { sections.forEach((section) => section.classList.add('is-visible')); return undefined; }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    sections.forEach((section) => observer.observe(section)); return () => observer.disconnect();
  }, [loading, pageConfig]);

  const liveContests = useMemo(() => data.contests.filter((contest) => contest.status === 'live'), [data.contests]);
  const upcoming = useMemo(() => data.contests.filter((contest) => ['published', 'scheduled'].includes(contest.status)), [data.contests]);
  const findProgramme = (event) => { event.preventDefault(); navigate(programmeQuery.trim() ? `/courses?search=${encodeURIComponent(programmeQuery.trim())}` : '/courses'); };
  const dashboardPath = user ? ({ owner: '/admin', admin: '/admin', developer: '/developer', student: '/student' }[user.role] || '/student') : '/register';

  const renderSection = (block) => {
    const c = block.content || {};
    switch (block.type) {
      case 'banner': return <LandingBanner key={block.id} block={block} enabled />;
      case 'hero': return (
        <section key={block.id} className={sectionClass(block, 'institution-hero')} style={sectionVars(block)}><div className="container institution-hero-grid">
          <div className="institution-hero-copy">{c.eyebrow && <span className="landing-kicker">{c.eyebrow}</span>}<h1>{c.title} {c.accentTitle && <span>{c.accentTitle}</span>}</h1>{c.description && <p>{c.description}</p>}
            <div className="institution-hero-actions"><SmartLink className="landing-button landing-button-primary" to={c.primaryButton?.link}>{c.primaryButton?.label}<Icon name="arrow" size={17} /></SmartLink><SmartLink className="landing-button landing-button-secondary" to={c.secondaryButton?.link}>{c.secondaryButton?.label}</SmartLink></div>
            {c.trustPoints?.length > 0 && <div className="institution-hero-trust">{c.trustPoints.map((point, index) => <span key={`${point}-${index}`}><Icon name="check" size={16} />{point}</span>)}</div>}
          </div>{c.showCodePreview !== false && <CodePreview />}
        </div></section>
      );
      case 'technology': return <TechnologyMarquee key={block.id} block={block} />;
      case 'quick_services': return (
        <section key={block.id} className={sectionClass(block, 'landing-quick-services')} style={sectionVars(block)} aria-label="Quick access"><div className="container landing-service-grid landing-builder-grid">
          {(c.items || []).map((item, index) => <article className="landing-service-card" key={`${item.title}-${index}`}><span className="landing-service-icon"><Icon name={item.icon || 'book'} size={25} /></span><h2>{item.title}</h2><div>{(item.links || []).map((entry, linkIndex) => <SmartLink key={`${entry.label}-${linkIndex}`} to={entry.link}>{entry.label}<Icon name="arrow" size={14} /></SmartLink>)}</div></article>)}
        </div></section>
      );
      case 'programmes': {
        const courses = data.courses.slice(0, Math.max(1, Number(c.itemLimit || 6)));
        return <section key={block.id} className={sectionClass(block, 'landing-section landing-programme-finder')} style={sectionVars(block)}><div className="container">
          <div className="programme-finder-panel"><div>{c.eyebrow && <span className="landing-kicker">{c.eyebrow}</span>}<h2>{c.title}</h2><p>{c.description}</p></div><form onSubmit={findProgramme}><label htmlFor={`programme-search-${block.id}`}>{c.searchLabel}</label><div><Icon name="search" size={18} /><input id={`programme-search-${block.id}`} value={programmeQuery} onChange={(event) => setProgrammeQuery(event.target.value)} placeholder={c.searchPlaceholder} /><button type="submit">{c.searchButton}</button></div></form></div>
          <div className="landing-section-head"><div><span className="landing-kicker">{c.listEyebrow}</span><h2>{c.listTitle}</h2></div><SmartLink to={c.listLink}>{c.listLinkLabel}<Icon name="arrow" size={16} /></SmartLink></div>
          {loading ? <div className="landing-skeleton-grid">{[1,2,3].map((item) => <div key={item} className="landing-skeleton" />)}</div> : courses.length ? <div className="grid g3 landing-course-grid">{courses.map((course) => <CourseCard key={course.id} course={course} />)}</div> : <div className="landing-empty"><Icon name="book" size={28} /><strong>Course catalogue is being prepared</strong><SmartLink to="/courses">Open course catalogue</SmartLink></div>}
        </div></section>;
      }
      case 'updates': return (
        <section key={block.id} className={sectionClass(block, 'landing-section landing-updates')} style={sectionVars(block)}><div className="container"><div className="landing-section-head"><div><span className="landing-kicker">{c.eyebrow}</span><h2>{c.title}</h2><p>{c.description}</p></div></div><div className="landing-updates-grid">
          <article className="landing-panel"><div className="landing-panel-head"><h3>{c.panelTitle}</h3><SmartLink to={c.panelLink}>{c.panelLinkLabel}<Icon name="arrow" size={15} /></SmartLink></div><div className="landing-news-list">
            {data.quizzes.slice(0,3).map((quiz) => { const badge = dateBadge(quiz.start_at || quiz.live_started_at || quiz.created_at); return <div className="landing-news-item" key={quiz.id}><span className="landing-date"><b>{badge.day}</b><small>{badge.month}</small></span><div><Link to={quiz.status === 'live' ? `/quizzes/${quiz.id}/live` : `/quizzes/${quiz.id}`}>{quiz.title}</Link><span>{quiz.quiz_type} • {quiz.time_limit_minutes} min • {quiz.total_marks} marks</span></div><StatusBadge value={quiz.status} /></div>; })}
            {data.notes.slice(0,Math.max(1,4-data.quizzes.length)).map((note) => <div className="landing-news-item" key={`note-${note.id}`}><span className="landing-date"><b>{new Date(note.created_at).getDate() || 1}</b><small>{new Date(note.created_at).toLocaleString('en',{month:'short'})}</small></span><div><Link to="/notes">{note.title}</Link><span>{note.subject || 'Study material'} • {timeAgo(note.created_at)}</span></div><span className="landing-new-badge">NEW</span></div>)}
            {!loading && !data.quizzes.length && !data.notes.length && <div className="landing-news-placeholder">New announcements will appear here.</div>}
          </div></article>
          <article className="landing-welcome-card"><div className="landing-illustration" aria-hidden="true"><div className="illustration-screen"><span /><span /><span /><b>&lt;/&gt;</b></div><div className="illustration-person one" /><div className="illustration-person two" /></div><div><span className="landing-kicker">{c.welcomeEyebrow}</span><h2>{c.welcomeTitle}</h2><p>{c.welcomeDescription}</p><SmartLink to={c.welcomeLink}>{c.welcomeLinkLabel}<Icon name="arrow" size={15} /></SmartLink></div></article>
        </div></div></section>
      );
      case 'stats': return <section key={block.id} className={sectionClass(block, 'landing-stats')} style={sectionVars(block)} aria-label="Platform statistics"><div className="container landing-stats-grid landing-builder-grid">{(c.items || []).map((item,index) => <div key={`${item.label}-${index}`}><Icon name={item.icon || 'chart'} size={22} /><strong><AnimatedNumber value={stats?.[item.source]} /></strong><span>{item.label}</span></div>)}</div></section>;
      case 'schools': return <section key={block.id} className={sectionClass(block, 'landing-section landing-schools')} style={sectionVars(block)}><div className="container"><div className="landing-section-head"><div><span className="landing-kicker">{c.eyebrow}</span><h2>{c.title}</h2><p>{c.description}</p></div></div><div className="landing-school-grid landing-builder-grid">{(c.items || []).map((item,index) => <SmartLink className={`landing-school-card school-${(index%4)+1}`} key={`${item.title}-${index}`} to={item.link}><span className="landing-school-visual"><Icon name={item.icon || 'book'} size={31} /></span><div><h3>{item.title}</h3><p>{item.description}</p><span>{c.itemLinkLabel || 'View programmes'}<Icon name="arrow" size={15} /></span></div></SmartLink>)}</div></div></section>;
      case 'competition': {
        if (!isOn('contests_enabled', false)) return null;
        return <section key={block.id} className={sectionClass(block, 'landing-section landing-competition')} style={sectionVars(block)}><div className="container"><div className="landing-section-head"><div><span className="landing-kicker">{c.eyebrow}</span><h2>{c.title}</h2></div><SmartLink to={c.listLink}>{c.listLinkLabel}<Icon name="arrow" size={16} /></SmartLink></div><div className="landing-competition-grid">
          <article className="landing-panel landing-contests-panel"><div className="landing-panel-head"><h3>{c.listTitle}</h3><Icon name="calendar" size={19} /></div><div className="landing-contest-list">{[...liveContests,...upcoming].slice(0,3).map((contest) => <Link to={`/contests/${contest.id}`} key={contest.id}><span className="contest-icon"><Icon name="trophy" size={19} /></span><span><strong>{contest.title}</strong><small>{contest.problem_count} problems</small></span><span>{contest.status === 'live' ? <StatusBadge value="live" /> : <Countdown target={contest.start_at} compact />}</span></Link>)}{!loading && liveContests.length + upcoming.length === 0 && <div className="landing-news-placeholder">No contests are scheduled right now.</div>}</div></article>
          <article className="landing-potd-card"><span className="landing-kicker">{c.problemEyebrow}</span>{potd ? <><h3>{potd.title}</h3><p>{c.problemDescription}</p><div><DiffBadge value={potd.difficulty} /><span>{potd.points} points</span>{potd.solved && <span className="solved"><Icon name="check" size={14} />Solved</span>}</div><Link to={`/coding/${potd.id}`}>{c.problemButton}<Icon name="arrow" size={16} /></Link></> : <><h3>{c.emptyTitle}</h3><p>{c.emptyDescription}</p><Link to="/coding">{c.emptyButton}<Icon name="arrow" size={16} /></Link></>}</article>
        </div></div></section>;
      }
      case 'problems': {
        const problems = data.problems.slice(0, Math.max(1, Number(c.itemLimit || 6))); if (!problems.length) return null;
        return <section key={block.id} className={sectionClass(block, 'landing-section landing-problems')} style={sectionVars(block)}><div className="container"><div className="landing-section-head"><div><span className="landing-kicker">{c.eyebrow}</span><h2>{c.title}</h2></div><SmartLink to={c.link}>{c.linkLabel}<Icon name="arrow" size={16} /></SmartLink></div><div className="table-wrap" tabIndex={0}><table className="table"><thead><tr><th>Problem</th><th>Difficulty</th><th>Points</th><th>Accuracy</th><th>Submissions</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{problems.map((problem) => <tr key={problem.id}><td><Link className="link" to={`/coding/${problem.id}`}>{problem.title}</Link><div className="tiny muted">{problem.category_name}</div></td><td><DiffBadge value={problem.difficulty} /></td><td>{problem.points}</td><td>{Number(problem.acceptance_rate).toFixed(1)}%</td><td>{problem.total_submissions}</td><td><Link className="btn btn-sm btn-primary" to={`/coding/${problem.id}`}>Solve</Link></td></tr>)}</tbody></table></div></div></section>;
      }
      case 'student_services': return <section key={block.id} className={sectionClass(block, 'landing-section landing-services')} style={sectionVars(block)}><div className="container"><div className="landing-section-head"><div><span className="landing-kicker">{c.eyebrow}</span><h2>{c.title}</h2><p>{c.description}</p></div></div><div className="landing-student-services landing-builder-grid">{(c.items || []).map((item,index) => <SmartLink key={`${item.label}-${index}`} to={item.link}><span><Icon name={item.icon || 'book'} size={22} /></span>{item.label}</SmartLink>)}</div></div></section>;
      case 'cta': {
        const registrationOpen = isOn('registration_enabled', false) && isOn('student_registration', false);
        const target = user ? dashboardPath : (registrationOpen ? c.guestLink : '/login');
        const label = user ? (c.userButton || t('landing.go_dashboard')) : (registrationOpen ? (c.guestButton || t('landing.create_account')) : 'Sign in');
        const description = !user && !registrationOpen ? 'Sign in to access your learning dashboard.' : c.description;
        return <section key={block.id} className={sectionClass(block, 'landing-final-cta')} style={sectionVars(block)}><div className="container"><div><h2>{c.title}</h2><p>{description}</p></div><SmartLink to={target}>{label}<Icon name="arrow" size={17} /></SmartLink></div></section>;
      }
      case 'content': return <section key={block.id} className={sectionClass(block, 'landing-section landing-generic-section landing-content-block')} style={sectionVars(block)}><div className="container"><div className="landing-generic-copy">{c.eyebrow && <span className="landing-kicker">{c.eyebrow}</span>}<h2>{c.title}</h2><p>{c.description}</p><div className="landing-generic-actions"><SmartLink className="landing-button landing-button-primary" to={c.primaryButton?.link}>{c.primaryButton?.label}</SmartLink><SmartLink className="landing-button landing-button-secondary" to={c.secondaryButton?.link}>{c.secondaryButton?.label}</SmartLink></div></div></div></section>;
      case 'feature_grid': return <section key={block.id} className={sectionClass(block, 'landing-section landing-generic-section landing-feature-block')} style={sectionVars(block)}><div className="container"><div className="landing-section-head"><div><span className="landing-kicker">{c.eyebrow}</span><h2>{c.title}</h2><p>{c.description}</p></div></div><div className="landing-builder-feature-grid landing-builder-grid">{(c.items || []).map((item,index) => <SmartLink className="landing-builder-feature-card" key={`${item.title}-${index}`} to={item.link}><span><Icon name={item.icon || 'book'} size={26} /></span><h3>{item.title}</h3><p>{item.description}</p></SmartLink>)}</div></div></section>;
      case 'image_text': return <section key={block.id} className={sectionClass(block, `landing-section landing-generic-section landing-image-text ${block.style?.imagePosition === 'left' ? 'image-left' : 'image-right'}`)} style={sectionVars(block)}><div className="container landing-image-text-grid"><div className="landing-image-text-copy"><span className="landing-kicker">{c.eyebrow}</span><h2>{c.title}</h2><p>{c.description}</p><SmartLink className="landing-button landing-button-primary" to={c.primaryButton?.link}>{c.primaryButton?.label}</SmartLink></div>{c.image && <img src={c.image} alt={c.imageAlt || ''} />}</div></section>;
      default: return null;
    }
  };

  const theme = pageConfig.theme || {};
  return (
    <div className={`edu-landing landing-builder-page${preview ? ' is-builder-preview' : ''}`} style={{ '--brand': theme.primaryColor || '#01507c', '--accent': theme.accentColor || '#f5a800', '--landing-page-bg-light': theme.pageBackground || '#f5f8fa', '--landing-page-bg-dark': theme.pageBackgroundDark || '#071722', '--landing-max-width': `${Math.max(960, Math.min(1600, Number(theme.maxWidth || 1280)))}px`, '--landing-radius': `${Math.max(0, Math.min(32, Number(theme.cornerRadius || 8)))}px` }}>
      {(pageConfig.sections || []).filter((block) => block.enabled !== false).map(renderSection)}
    </div>
  );
}
