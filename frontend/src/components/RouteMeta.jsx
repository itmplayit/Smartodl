import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TITLES = {
  '/': 'Home', '/courses': 'Courses', '/notes': 'Study Notes', '/quizzes': 'Quizzes',
  '/coding': 'Coding Arena', '/contests': 'Contests', '/leaderboard': 'Leaderboard',
  '/interviews': 'Mock Interviews', '/about': 'About', '/contact': 'Contact',
  '/search': 'Search', '/login': 'Sign In', '/register': 'Create Account',
  '/forgot-password': 'Forgot Password', '/reset-password': 'Reset Password',
  '/profile': 'Profile', '/settings': 'Settings', '/verify-certificate': 'Verify Certificate', '/terms': 'Terms of Use', '/privacy': 'Privacy Policy',
  '/student': 'Student Dashboard', '/developer': 'Instructor Dashboard', '/admin': 'Administration Centre',
  '/admin/ai': 'AI Content Generator',
};

const formatSegment = (value) => value.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const exact = TITLES[pathname];
    const root = pathname.startsWith('/admin') ? 'Administration'
      : pathname.startsWith('/developer') ? 'Instructor Workspace'
        : pathname.startsWith('/student') ? 'Student Workspace' : null;
    const last = pathname.split('/').filter(Boolean).at(-1);
    const title = exact || (last && !/^\d+$/.test(last) ? `${formatSegment(last)}${root ? ` · ${root}` : ''}` : root) || 'SmartODL';
    document.title = `${title} — SmartODL`;
  }, [pathname]);
  return null;
}
