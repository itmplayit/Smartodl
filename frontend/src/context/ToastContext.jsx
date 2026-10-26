import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const remove = useCallback((id) => setToasts((list) => list.filter((item) => item.id !== id)), []);

  const push = useCallback((message, type = 'info', ms) => {
    const id = Math.random().toString(36).slice(2);
    const duration = ms ?? (type === 'error' ? 7000 : 4800);
    setToasts((list) => [...list, { id, message, type }]);
    window.setTimeout(() => remove(id), duration);
  }, [remove]);

  const toast = useMemo(() => ({
    success: (message, ms) => push(message, 'success', ms),
    error: (message, ms) => push(message, 'error', ms),
    info: (message, ms) => push(message, 'info', ms),
  }), [push]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-wrap" aria-live="polite" aria-relevant="additions">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.type}`} role={item.type === 'error' ? 'alert' : 'status'} aria-atomic="true">
            <span>{item.message}</span>
            <button type="button" className="toast-close" onClick={() => remove(item.id)} aria-label="Dismiss notification">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext) || { success: () => {}, error: () => {}, info: () => {} };
