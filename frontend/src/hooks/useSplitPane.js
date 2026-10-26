import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Draggable split-pane sizing, shared by the Coding Arena and the in-quiz
 * compiler so both behave identically.
 *
 * Improvements over the inline handlers this replaces:
 *   - Pointer events, so a trackpad, touch screen or pen all work.
 *   - Listeners and the body cursor are released on unmount. The previous
 *     version attached to `window` inside the handler; navigating away
 *     mid-drag left the listeners bound and the cursor stuck on col-resize.
 *   - `onDoubleClick` resets to the initial ratio.
 *   - Text selection is suppressed while dragging, so the drag no longer
 *     highlights the question text.
 */
function useDragCleanup() {
  const cleanupRef = useRef(null);
  useEffect(() => () => { if (cleanupRef.current) cleanupRef.current(); }, []);
  return cleanupRef;
}

const begin = (cursor) => {
  document.body.style.cursor = cursor;
  document.body.style.userSelect = 'none';
};
const end = () => {
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

/**
 * Horizontal ratio between two columns, as a percentage of the container.
 * @param {object} containerRef ref to the grid element being split
 */
export function useVerticalSplit(containerRef, { initial = 50, min = 25, max = 75 } = {}) {
  const [pct, setPct] = useState(initial);
  const cleanupRef = useDragCleanup();

  const startDrag = useCallback((e) => {
    if (!containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const move = (ev) => {
      const next = ((ev.clientX - rect.left) / rect.width) * 100;
      setPct(Math.min(max, Math.max(min, next)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cleanupRef.current = null;
      end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    cleanupRef.current = up;
    begin('col-resize');
  }, [containerRef, min, max, cleanupRef]);

  const reset = useCallback(() => setPct(initial), [initial]);
  return { pct, startDrag, reset };
}

/**
 * Height of a bottom panel, dragged from its top edge.
 */
export function useHorizontalSplit({ initial = 220, min = 120, max = 480 } = {}) {
  const [size, setSize] = useState(initial);
  const cleanupRef = useDragCleanup();

  const startDrag = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const base = size;
    const move = (ev) => setSize(Math.min(max, Math.max(min, base + (startY - ev.clientY))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cleanupRef.current = null;
      end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    cleanupRef.current = up;
    begin('row-resize');
  }, [size, min, max, cleanupRef]);

  const reset = useCallback(() => setSize(initial), [initial]);
  return { size, startDrag, reset };
}
