import { useEffect, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';

/**
 * 📸 Global PrintScreen guard — active on EVERY page of the site while the
 * admin switch "Screenshot block" is ON (Feature Control → Anti-cheat).
 * Intercepts the PrintScreen key, swallows it and overwrites the clipboard
 * so the captured image can't be pasted anywhere useful.
 */
export default function PrintScreenGuard() {
  const { isOn } = useSettings();
  const toast = useToast();
  const lastWarn = useRef(0);
  const enabled = isOn('screenshot_block_enabled', true);

  useEffect(() => {
    if (!enabled) return undefined;
    const onShot = (e) => {
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        e.stopPropagation();
        // 1) blank the whole screen instantly — any capture that lands a moment
        //    late only gets a white page, not the exam content
        try {
          const cover = document.createElement('div');
          cover.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2147483647;pointer-events:none;';
          document.body.appendChild(cover);
          setTimeout(() => cover.remove(), 300);
        } catch (_) { /* ignore */ }
        // 2) overwrite the clipboard so the captured image can't be pasted
        try { if (navigator.clipboard) navigator.clipboard.writeText('Screenshot blocked by SmartODL').catch(() => {}); } catch (_) { /* ignore */ }
        const now = Date.now();
        if (now - lastWarn.current > 3000) {
          lastWarn.current = now;
          toast.error('📸 Screenshot blocked by administrator');
        }
      }
    };
    document.addEventListener('keydown', onShot, true);
    document.addEventListener('keyup', onShot, true);
    return () => {
      document.removeEventListener('keydown', onShot, true);
      document.removeEventListener('keyup', onShot, true);
    };
  }, [enabled, toast]);

  return null;
}
