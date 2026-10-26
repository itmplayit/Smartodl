import { useEffect, useRef } from 'react';

const focusableSelector = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Accessible focus containment for modal drawers and dialogs. */
export default function useFocusTrap({ active, containerRef, triggerRef, onClose, backdropRef }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    container.inert = !active;
    if (!active) return undefined;

    const previous = document.activeElement;
    const inerted = new Map();
    let branch = container;
    let parent = container.parentElement;
    let activeBranches = new Set([container, backdropRef?.current].filter((node) => node?.parentElement === parent));
    while (parent && parent !== document.documentElement) {
      [...parent.children].forEach((node) => {
        if (!activeBranches.has(node) && !inerted.has(node)) {
          inerted.set(node, node.inert);
          node.inert = true;
        }
      });
      branch = parent;
      parent = parent.parentElement;
      activeBranches = new Set([branch]);
    }
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () => [...container.querySelectorAll(focusableSelector)]
      .filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true' && node.offsetParent !== null);
    requestAnimationFrame(() => (container.querySelector('[data-focus-first]') || focusables()[0] || container).focus());

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); container.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      inerted.forEach((wasInert, node) => { node.inert = wasInert; });
      document.body.style.overflow = oldOverflow;
      container.inert = true;
      requestAnimationFrame(() => {
        const target = triggerRef?.current || previous;
        if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
      });
    };
  }, [active, backdropRef, containerRef, triggerRef]);
}
