import { useEffect } from 'react';

/**
 * Hide the site chrome for full-viewport pages (Coding Arena, live quizzes).
 *
 * Flags <body> with `arena-immersive`, which the arena stylesheet uses to
 * collapse the utility strip, institution header, announcement ribbon, main
 * nav and site footer so the page owns the whole viewport. The flag is removed
 * on unmount — and whenever `active` turns false — so every other page keeps
 * its institutional chrome.
 *
 * @param {boolean} active      opt out at runtime. A quiz hides the chrome
 *                              while it is being taken, then restores it on
 *                              the results screen where the student needs to
 *                              navigate again.
 * @param {object}  options
 * @param {boolean} options.lockScroll
 *        Also stop the page scrolling. Only for pages that are their own
 *        fixed-height app shell and scroll internally (the Coding Arena's
 *        split panes). Quiz pages are ordinary documents that must keep
 *        scrolling, so they leave this off.
 */
export default function useImmersiveChrome(active = true, { lockScroll = false } = {}) {
  useEffect(() => {
    if (!active) return undefined;
    const { body } = document;
    body.classList.add('arena-immersive');
    if (lockScroll) body.classList.add('arena-noscroll');
    return () => {
      body.classList.remove('arena-immersive');
      body.classList.remove('arena-noscroll');
    };
  }, [active, lockScroll]);
}
