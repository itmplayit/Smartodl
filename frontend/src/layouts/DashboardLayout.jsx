import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { Avatar } from '../components/ui';
import NotificationBell from '../components/NotificationBell';
import ThemeToggle from '../components/ThemeToggle';
import { BrandLogo } from '../components/Brand';
import Icon from '../components/Icon';
import useFocusTrap from '../hooks/useFocusTrap';

const NAV = {
  student: [
    ['/student', 'Dashboard', 'home', 'Overview'], ['/student/courses', 'My Courses', 'book', 'Learning'], ['/courses', 'Browse Courses', 'search', 'Learning'], ['/notes', 'Study Notes', 'file', 'Learning'], ['/quizzes', 'Quizzes', 'quiz', 'Assessment'], ['/coding', 'Coding Arena', 'code', 'Assessment'], ['/contests', 'Contests', 'trophy', 'Compete'], ['/leaderboard', 'Leaderboard', 'chart', 'Compete'], ['/student/achievements', 'Achievements', 'award', 'Progress'], ['/student/results', 'My Results', 'report', 'Progress'], ['/student/certificates', 'Certificates', 'certificate', 'Progress'], ['/subscription', 'My Plan', 'sparkle', 'Account'], ['/profile', 'Profile', 'user', 'Account'], ['/settings', 'Settings', 'settings', 'Account'],
  ],
  developer: [
    ['/developer', 'Dashboard', 'home', 'Overview'], ['/developer/courses', 'My Courses', 'book', 'Content'], ['/developer/courses/new', 'Create Course', 'plus', 'Content'], ['/developer/notes', 'Upload Notes', 'file', 'Content'], ['/developer/quizzes', 'Create Quiz', 'quiz', 'Assessment'], ['/developer/problems', 'Coding Problems', 'code', 'Coding'], ['/developer/test-cases', 'Test Cases', 'flask', 'Coding'], ['/developer/contests', 'Host Contest', 'trophy', 'Live & Compete'], ['/developer/live', 'Host Live Quiz', 'broadcast', 'Live & Compete'], ['/developer/anti-cheating', 'Anti-Cheating', 'shield', 'Assessment'], ['/developer/participants', 'Participants', 'users', 'Insights'], ['/developer/submissions', 'Submissions', 'mail', 'Insights'], ['/developer/analytics', 'Analytics', 'chart', 'Insights'], ['/subscription', 'My Plan', 'sparkle', 'Account'], ['/profile', 'Profile', 'user', 'Account'], ['/settings', 'Settings', 'settings', 'Account'],
  ],
  admin: [
    ['/admin', 'Dashboard', 'home', 'Overview'], ['/admin/users', 'All Users', 'users', 'People'], ['/admin/students', 'Students', 'user', 'People'], ['/admin/developers', 'Instructors', 'teacher', 'People'], ['/admin/colleges', 'Colleges', 'users', 'People'], ['/admin/plans', 'Plans & Subs', 'sparkle', 'Sales'], ['/admin/upi-payments', 'Payments', 'database', 'Sales'], ['/admin/courses', 'Courses', 'book', 'Learning Content'], ['/admin/categories', 'Course Categories', 'tag', 'Learning Content'], ['/admin/modules', 'Modules & Lessons', 'layers', 'Learning Content'], ['/admin/notes', 'Notes', 'file', 'Learning Content'], ['/admin/quizzes', 'Quiz Management', 'quiz', 'Assessment'], ['/admin/live', 'Live Quiz Hosting', 'broadcast', 'Assessment'], ['/admin/problems', 'Coding Problems', 'code', 'Coding Platform'], ['/admin/test-cases', 'Test Cases', 'flask', 'Coding Platform'], ['/admin/contests', 'Coding Contests', 'trophy', 'Coding Platform'], ['/admin/submissions', 'Submissions', 'mail', 'Coding Platform'], ['/admin/leaderboard', 'Leaderboard', 'chart', 'Engagement'], ['/admin/points', 'Points Management', 'target', 'Engagement'], ['/admin/achievements', 'Achievements', 'award', 'Engagement'], ['/admin/certificates', 'Certificates', 'certificate', 'Engagement'], ['/admin/notifications', 'Notifications', 'bell', 'Operations'], ['/admin/reports', 'Reports', 'report', 'Operations'], ['/admin/ai', 'AI Generator', 'sparkle', 'Operations'], ['/admin/features', 'Feature Control', 'sliders', 'Platform'], ['/admin/integrity-scores', 'Integrity Scores', 'shield', 'Assessment'], ['/admin/proctor-recordings', 'Proctor Recordings', 'video', 'Platform'],  ['/admin/landing-builder', 'Landing Page Builder', 'layers', 'Platform'], ['/admin/pages', 'Site Pages', 'file', 'Platform'], ['/admin/settings', 'Website Settings', 'settings', 'Platform'], ['/admin/profile', 'My Profile', 'user', 'Account'],
  ],
};
// Owner uses the complete administration centre rather than a separate,
// reduced workspace.
NAV.owner = NAV.admin;

const LINK_SETTING = {
  '/quizzes': 'quiz_system_enabled', '/developer/quizzes': 'quiz_system_enabled', '/admin/quizzes': 'quiz_system_enabled',
  '/developer/live': 'live_quiz_enabled', '/admin/live': 'live_quiz_enabled', '/coding': 'coding_system_enabled',
  '/developer/problems': 'coding_system_enabled', '/admin/problems': 'coding_system_enabled', '/developer/test-cases': 'coding_system_enabled',
  '/admin/test-cases': 'coding_system_enabled', '/developer/submissions': 'coding_system_enabled', '/admin/submissions': 'coding_system_enabled',
  '/contests': 'contests_enabled', '/developer/contests': 'contests_enabled', '/admin/contests': 'contests_enabled',
  '/leaderboard': 'leaderboard_enabled', '/admin/leaderboard': 'leaderboard_enabled', '/student/achievements': 'achievements_enabled', '/admin/achievements': 'achievements_enabled',
};

const ROLE_LABEL = { student: 'Student Workspace', developer: 'Instructor Workspace', admin: 'Administration Centre', owner: 'Owner · Administration Centre' };

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const { isOn } = useSettings();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [acct, setAcct] = useState(false);
  const acctRef = useRef(null);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const backdropRef = useRef(null);

  const items = useMemo(() => (NAV[user?.role] || NAV.student).filter(([path]) => !LINK_SETTING[path] || isOn(LINK_SETTING[path], false)), [user?.role, isOn]);
  const grouped = useMemo(() => items.reduce((result, item) => {
    const group = item[3];
    if (!result[group]) result[group] = [];
    result[group].push(item);
    return result;
  }, {}), [items]);

  useEffect(() => {
    if (!acct) return undefined;
    const onClick = (event) => { if (acctRef.current && !acctRef.current.contains(event.target)) setAcct(false); };
    const onKey = (event) => { if (event.key === 'Escape') setAcct(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [acct]);

  const closeNav = useCallback(() => setMobileOpen(false), []);
  useFocusTrap({ active: mobileOpen, containerRef: drawerRef, triggerRef: menuButtonRef, backdropRef, onClose: closeNav });
  const isRoot = (to) => ['/admin', '/developer', '/student'].includes(to);

  const NavGroups = ({ mobile = false }) => Object.entries(grouped).map(([group, links]) => (
    <div className="dashboard-nav-group" key={group}>
      <div className="side-title">{group}</div>
      {links.map(([to, label, icon]) => (
        <NavLink key={to} to={to} end={isRoot(to)} className={({ isActive }) => `${mobile ? 'drawer-link' : 'side-link'} ${isActive ? 'active' : ''}`} onClick={mobile ? closeNav : undefined}>
          <span className="side-link-icon"><Icon name={icon} size={18} /></span><span>{label}</span>{mobile && <Icon name="chevronRight" size={15} className="drawer-chevron" />}
        </NavLink>
      ))}
    </div>
  ));

  return (
    <>
      <a className="skip-link" href="#dashboard-content">Skip to dashboard content</a>
      <header className="dashboard-topbar" aria-label="Workspace header">
        <button ref={menuButtonRef} className="icon-btn dashboard-menu-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Open workspace navigation" aria-controls="workspace-navigation-drawer" aria-expanded={mobileOpen}><Icon name="menu" size={22} /></button>
        <Link to="/" className="dashboard-brand" onClick={closeNav} aria-label="SmartODL home"><BrandLogo height={43} compact /></Link>
        <span className="workspace-label"><Icon name={['owner', 'admin'].includes(user?.role) ? 'shield' : user?.role === 'developer' ? 'teacher' : 'book'} size={15} />{ROLE_LABEL[user?.role] || 'Workspace'}</span>
        <div className="dashboard-topbar-spacer" />
        <Link to="/" className="public-site-link"><Icon name="globe" size={16} />Public site</Link>
        <ThemeToggle />
        <NotificationBell />
        <div className="acct-wrap" ref={acctRef}>
          <button className="acct-btn dashboard-account" type="button" onClick={() => setAcct((value) => !value)} aria-haspopup="menu" aria-expanded={acct}>
            <Avatar user={user} size={33} /><span className="acct-meta"><span className="acct-name">{user?.full_name?.split(' ')[0]}</span><span className="acct-role">{user?.points || 0} points</span></span><Icon name="chevronDown" size={13} />
          </button>
          {acct && (
            <div className="acct-menu" role="menu">
              <div className="acct-head"><Avatar user={user} size={42} /><div><div className="acct-head-name">{user?.full_name}</div><div className="acct-head-email">{user?.email}</div></div></div>
              <div className="acct-stats"><div><b>{user?.points || 0}</b><span>Points</span></div><div><b>{user?.quizzes_completed || 0}</b><span>Quizzes</span></div><div><b>{user?.problems_solved || 0}</b><span>Problems</span></div></div>
              <div className="acct-divider" />
              <Link to="/profile" className="acct-item" role="menuitem" onClick={() => setAcct(false)}><Icon name="user" size={17} />Profile</Link>
              <Link to="/settings" className="acct-item" role="menuitem" onClick={() => setAcct(false)}><Icon name="settings" size={17} />Settings</Link>
              <Link to="/" className="acct-item" role="menuitem" onClick={() => setAcct(false)}><Icon name="globe" size={17} />Public site</Link>
              <div className="acct-divider" />
              <button className="acct-item acct-logout" type="button" role="menuitem" onClick={async () => { setAcct(false); await logout(); navigate('/login'); }}><Icon name="logout" size={17} />Log out</button>
            </div>
          )}
        </div>
      </header>

      <div ref={backdropRef} className={`drawer-backdrop ${mobileOpen ? 'open' : ''}`} onClick={closeNav} />
      <aside ref={drawerRef} id="workspace-navigation-drawer" className={`drawer dash-drawer institution-dashboard-drawer ${mobileOpen ? 'open' : ''}`} role="dialog" aria-modal={mobileOpen || undefined} aria-label="Workspace navigation" aria-hidden={!mobileOpen} tabIndex={-1}>
        <div className="drawer-head"><BrandLogo height={42} compact /><button className="icon-btn" type="button" data-focus-first onClick={closeNav} aria-label="Close navigation"><Icon name="close" size={21} /></button></div>
        <div className="mobile-profile"><Avatar user={user} size={42} /><div><strong>{user?.full_name}</strong><span>{user?.email}</span></div></div>
        <div className="drawer-links dashboard-drawer-links"><NavGroups mobile /></div>
        <div className="drawer-foot"><button className="btn btn-ghost btn-block" type="button" onClick={async () => { closeNav(); await logout(); navigate('/login'); }}><Icon name="logout" size={17} />Log out</button></div>
      </aside>

      <div className="shell institution-shell">
        <aside className="sidebar institution-sidebar" aria-label="Workspace navigation">
          <div className="side-profile"><Avatar user={user} size={46} /><div><div className="side-profile-name">{user?.full_name}</div><div className="side-profile-email">{user?.email}</div><div className="side-points"><Icon name="award" size={13} />{user?.points || 0} points</div></div></div>
          <nav><NavGroups /></nav>
          <div className="sidebar-footer"><button className="side-link" type="button" onClick={async () => { await logout(); navigate('/login'); }}><span className="side-link-icon"><Icon name="logout" size={18} /></span><span>Log out</span></button></div>
        </aside>
        <main className="shell-main institution-main" id="dashboard-content" aria-label="Workspace content"><Outlet /></main>
      </div>
    </>
  );
}
