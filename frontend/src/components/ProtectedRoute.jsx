import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader } from './ui';

/** Route guard: requires login, optionally a role and/or a developer permission. */
export default function ProtectedRoute({ roles, permission, children }) {
  const { user, loading, isAuthenticated, hasRole, can } = useAuth();
  const location = useLocation();

  if (loading) return <Loader label="Checking your session…" />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !hasRole(...roles)) {
    return <Navigate to="/403" state={{ needed_role: roles.join(' or '), from: location.pathname }} replace />;
  }
  if (permission && !can(permission)) {
    return <Navigate to="/403" state={{ needed_permission: permission, from: location.pathname }} replace />;
  }
  return children || <Outlet />;
}
