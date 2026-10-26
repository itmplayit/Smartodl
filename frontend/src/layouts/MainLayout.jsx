import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { Avatar } from '../components/ui';
import { gamificationApi, pagesApi } from '../services/api';
import { useLang } from '../context/LangContext';
import GlobalSearch from '../components/GlobalSearch';
import NotificationBell from '../components/NotificationBell';
import ThemeToggle from '../components/ThemeToggle';
import { BrandLogo } from '../components/Brand';
import Icon from '../components/Icon';
import useFocusTrap from '../hooks/useFocusTrap';

const LINKS = [
  ['/courses', 'Courses'],
  ['/notes', 'Notes'],
  ['/quizzes', 'Quizzes'],
  ['/coding', 'Coding Arena'],
  ['/contests', 'Contests'],
  ['/leaderboard', 'Leaderboard'],
];

const LINK_SETTING = {
  '/quizzes': 'quiz_system_enabled',
  '/coding': 'coding_system_enabled',
  '/contests': 'contests_enabled',
  '/leaderboard': 'leaderboard_enabled',
};

const SECONDARY_LINKS = [['/about', 'About'], ['/contact', 'Contact']];
const FONT_SCALE_KEY = 'smartodl-font-scale';
const FONT_SCALES = { small: 0.9, normal: 1, large: 1.15 };
const readFontScale = () => {
  try {
    const saved = localStorage.getItem(FONT_SCALE_KEY);
    return Object.hasOwn(FONT_SCALES, saved) ? saved : 'normal';
  } catch (_) { return 'normal'; }
};

export default function MainLayout() {
  const { user, isAuthenticated, logout } = useAuth();
  const { settings, isOn } = useSettings();
  const [infoPages, setInfoPages] = useState([]);
  useEffect(() => {
    let alive = true;
    pagesApi.list()
      .then(({ data }) => { if (alive) setInfoPages(data.data || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const footerPages = (group) => infoPages.filter((x) => x.footer_group === group);
  const { lang, setLang, t } = useLang();
  const [menu, setMenu] = useState(false);
  const [acct, setAcct] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [fontScale, setFontScale] = useState(readFontScale);
  const [lv, setLv] = useState(null);
  const navigate = useNavigate();
  const acctRef = useRef(null);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const backdropRef = useRef(null);

  const visibleLinks = LINKS.filter(([to]) => !LINK_SETTING[to] || isOn(LINK_SETTING[to], false));
  const searchOn = isOn('enable_global_search', false);
  const dashboardPath = user ? ({ owner: '/admin', admin: '/admin', developer: '/developer', student: '/student' }[user.role] || '/student') : '/login';

  useEffect(() => {
    setLv(null);
    if (!user) return;
    gamificationApi.me().then(({ data }) => setLv(data.data)).catch(() => {});
  }, [user?.id, user?.points]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!acct) return undefined;
    const onClick = (event) => { if (acctRef.current && !acctRef.current.contains(event.target)) setAcct(false); };
    const onKey = (event) => { if (event.key === 'Escape') setAcct(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [acct]);

  useEffect(() => {
    const scale = FONT_SCALES[fontScale] || 1;
    document.documentElement.style.setProperty('--user-font-scale', String(scale));
    document.documentElement.setAttribute('data-font-scale', fontScale);
    try { localStorage.setItem(FONT_SCALE_KEY, fontScale); } catch (_) { /* storage can be blocked in previews */ }
  }, [fontScale]);

  const closeMenu = useCallback(() => setMenu(false), []);
  useFocusTrap({ active: menu, containerRef: drawerRef, triggerRef: menuButtonRef, backdropRef, onClose: closeMenu });
  const navLabel = (label) => t(`nav.${label.toLowerCase().replace(/\s+/g, '.')}`, label);

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <header className="public-header">
        <div className="public-utility">
          <div className="container public-utility-inner">
            <nav className="utility-links" aria-label="Utility navigation">
              <a href="#main-content">Skip to content</a>
              <Link to="/courses">Student Services</Link>
              <Link to="/contact">Help Desk</Link>
            </nav>
            <div className="accessibility-tools" aria-label="Accessibility controls">
              {['small', 'normal', 'large'].map((size, index) => {
                const labels = ['Decrease text size', 'Reset text size', 'Increase text size'];
                return <button key={size} type="button" aria-pressed={fontScale === size} onClick={() => setFontScale(size)} aria-label={labels[index]} title={`${labels[index]} (${Math.round(FONT_SCALES[size] * 100)}%)`}>
                  {index === 0 ? 'A−' : index === 1 ? 'A' : 'A+'}
                </button>;
              })}
              <button type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')} aria-label="Switch language">
                <Icon name="globe" size={14} /> {lang === 'hi' ? 'English' : 'हिन्दी'}
              </button>
            </div>
          </div>
        </div>

        <div className="institution-header">
          <div className="container institution-header-inner">
            <Link to="/" className="institution-brand" onClick={closeMenu} aria-label="SmartODL home">
              <BrandLogo height={62} />
            </Link>
            <div className="institution-actions">
              <div className="trust-mark" aria-label="Trusted learning platform">
                <span className="trust-mark-icon"><Icon name="award" size={21} /></span>
                <span><strong>Trusted Learning Platform</strong><small>Learn • Practice • Compete</small></span>
              </div>
              <ThemeToggle className="institution-theme-toggle" />
              {isAuthenticated && <NotificationBell />}
            </div>
          </div>
        </div>

        <div className={`institution-nav ${scrolled ? 'is-scrolled' : ''}`}>
          <div className="container institution-nav-inner">
            <button ref={menuButtonRef} className="nav-toggle institution-menu-button" type="button" onClick={() => setMenu(true)} aria-label="Open navigation" aria-controls="public-navigation-drawer" aria-expanded={menu}>
              <Icon name="menu" size={22} />
            </button>
            <nav className="institution-links" aria-label="Primary navigation">
              <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>Home</NavLink>
              {visibleLinks.map(([to, label]) => (
                <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>{navLabel(label)}</NavLink>
              ))}
              {SECONDARY_LINKS.map(([to, label]) => (
                <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>{navLabel(label)}</NavLink>
              ))}
            </nav>
            <div className="institution-nav-actions">
              {searchOn && <GlobalSearch compact />}
              {isAuthenticated ? (
                <div className="acct-wrap" ref={acctRef}>
                  <button className="acct-btn institutional-account" type="button" onClick={() => setAcct((value) => !value)} aria-haspopup="menu" aria-expanded={acct}>
                    <Avatar user={user} size={31} />
                    <span className="acct-meta"><span className="acct-name">{user.full_name.split(' ')[0]}</span><span className="acct-role">{user.role}</span></span>
                    <Icon name="chevronDown" size={13} />
                  </button>
                  {acct && (
                    <div className="acct-menu" role="menu">
                      <div className="acct-head"><Avatar user={user} size={42} /><div><div className="acct-head-name">{user.full_name}</div><div className="acct-head-email">{user.email}</div></div></div>
                      <div className="acct-stats">
                        <div><b>{lv?.points ?? user.points ?? 0}</b><span>Points</span></div>
                        <div><b>{user.quizzes_completed || 0}</b><span>Quizzes</span></div>
                        <div><b>{user.problems_solved || 0}</b><span>Problems</span></div>
                      </div>
                      <div className="acct-divider" />
                      <Link to={dashboardPath} className="acct-item" role="menuitem" onClick={() => setAcct(false)}><Icon name="home" size={17} />Dashboard</Link>
                      <Link to="/profile" className="acct-item" role="menuitem" onClick={() => setAcct(false)}><Icon name="user" size={17} />Profile</Link>
                      <Link to="/settings" className="acct-item" role="menuitem" onClick={() => setAcct(false)}><Icon name="settings" size={17} />Settings</Link>
                      <div className="acct-divider" />
                      <button className="acct-item acct-logout" type="button" role="menuitem" onClick={async () => { setAcct(false); await logout(); navigate('/'); }}><Icon name="logout" size={17} />Log out</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="public-auth-actions">
                  <Link className="nav-signin" to="/login">Sign in</Link>
                  <Link className="nav-register" to="/register">Create account <Icon name="arrow" size={15} /></Link>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="institution-notice" role="region" aria-label="Important announcement">
          <div className="container institution-notice-inner">
            <strong><Icon name="bell" size={15} /> Important</strong>
            <span>New coding contest registration is open • Live quiz schedule released • Explore the latest programmes</span>
            <Link to="/contests">View all <Icon name="arrow" size={14} /></Link>
          </div>
        </div>
      </header>

      <div ref={backdropRef} className={`drawer-backdrop ${menu ? 'open' : ''}`} onClick={closeMenu} />
      <aside ref={drawerRef} id="public-navigation-drawer" className={`drawer institution-drawer ${menu ? 'open' : ''}`} role="dialog" aria-modal={menu || undefined} aria-label="Site navigation" aria-hidden={!menu} tabIndex={-1}>
        <div className="drawer-head">
          <Link to="/" onClick={closeMenu}><BrandLogo height={46} compact /></Link>
          <button className="icon-btn" type="button" data-focus-first onClick={closeMenu} aria-label="Close navigation"><Icon name="close" size={21} /></button>
        </div>
        <div className="drawer-search">{searchOn && <GlobalSearch />}</div>
        <div className="drawer-links">
          <NavLink to="/" end className={({ isActive }) => `drawer-link ${isActive ? 'active' : ''}`} onClick={closeMenu}>Home <Icon name="chevronRight" size={16} /></NavLink>
          {[...visibleLinks, ...SECONDARY_LINKS].map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => `drawer-link ${isActive ? 'active' : ''}`} onClick={closeMenu}>
              {navLabel(label)} <Icon name="chevronRight" size={16} />
            </NavLink>
          ))}
        </div>
        <div className="drawer-foot">
          {isAuthenticated ? (
            <><Link to={dashboardPath} className="btn btn-primary btn-block" onClick={closeMenu}>Open dashboard</Link><button className="btn btn-ghost btn-block" type="button" onClick={async () => { closeMenu(); await logout(); navigate('/'); }}>Log out</button></>
          ) : (
            <><Link className="btn btn-primary btn-block" to="/register" onClick={closeMenu}>Create account</Link><Link className="btn btn-ghost btn-block" to="/login" onClick={closeMenu}>Sign in</Link></>
          )}
        </div>
      </aside>

      {isOn('maintenance_mode', false) && !isAuthenticated && (
        <div className="container mt"><div className="soft maintenance-banner"><Icon name="alert" size={18} />{settings.maintenance_message || 'SmartODL is under maintenance.'}</div></div>
      )}

      <main id="main-content"><Outlet /></main>

      <footer className="institution-footer">
        <div className="container institution-footer-grid">
          <div>
            <BrandLogo height={48} compact className="footer-logo" />
            <p>{settings.site_tagline || 'Learn. Code. Compete. Grow.'}</p>
            <p className="institution-footer-summary">A unified college-level platform for structured learning, assessments, coding practice and competitive programming.</p>
          </div>
          <div><h2>Learning</h2><Link to="/courses">Courses</Link><Link to="/notes">Study notes</Link>{isOn('quiz_system_enabled', false) && <Link to="/quizzes">Quizzes</Link>}<Link to="/interviews">Mock interviews</Link></div>
          <div><h2>Practice &amp; compete</h2>{isOn('coding_system_enabled', false) && <Link to="/coding">Coding arena</Link>}{isOn('contests_enabled', false) && <Link to="/contests">Contests</Link>}{isOn('leaderboard_enabled', false) && <Link to="/leaderboard">Leaderboard</Link>}<Link to="/verify-certificate">Verify certificate</Link></div>
          <div><h2>Support</h2><Link to="/faq">Help centre</Link><Link to="/contact">Contact us</Link><Link to="/verify-certificate">Verify a certificate</Link>{footerPages('support').filter((x) => x.slug !== 'faq').map((x) => <Link key={x.slug} to={`/${x.slug}`}>{x.title}</Link>)}</div>
          <div><h2>Legal</h2>{footerPages('legal').map((x) => <Link key={x.slug} to={`/${x.slug}`}>{x.title}</Link>)}</div>
          <div><h2>Contact</h2><span><Icon name="mail" size={15} />{settings.contact_email || 'Contact administrator'}</span><span><Icon name="globe" size={15} />{settings.contact_address || 'Madhya Pradesh, India'}</span></div>
        </div>
        <div className="container institution-footer-bottom"><span>© {new Date().getFullYear()} {settings.site_name || 'SmartODL'}. All rights reserved.</span><span className="institution-footer-policies"><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/refund">Refunds</Link><Link to="/cookies">Cookies</Link><Link to="/accessibility">Accessibility</Link></span></div>
      </footer>
    </>
  );
}
