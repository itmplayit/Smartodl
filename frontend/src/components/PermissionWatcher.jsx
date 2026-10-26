import { useEffect } from 'react';
import { useToast } from '../context/ToastContext';

/**
 * Tells the signed-in user when an administrator changes their access.
 *
 * AuthContext re-reads /auth/me on focus, every minute and whenever the API
 * answers 403 — this component turns that difference into a toast, so a
 * developer who is already sitting in their dashboard sees the new permission
 * without reloading the page.
 */
export default function PermissionWatcher() {
  const toast = useToast();

  useEffect(() => {
    const onChange = (e) => {
      const { granted = [], revoked = [] } = (e && e.detail) || {};
      const nice = (list) => list.map((c) => c.replace(/_/g, ' ')).join(', ');

      if (granted.length && !revoked.length) {
        toast.success(`Access granted: ${nice(granted)} — the menus and buttons are unlocked now.`);
      } else if (revoked.length && !granted.length) {
        toast.info(`Access removed: ${nice(revoked)}.`);
      } else if (granted.length && revoked.length) {
        toast.info(`Your permissions changed — granted: ${nice(granted)} · removed: ${nice(revoked)}.`);
      }
    };

    window.addEventListener('smartodl:permissions-changed', onChange);
    return () => window.removeEventListener('smartodl:permissions-changed', onChange);
  }, [toast]);

  return null;
}
