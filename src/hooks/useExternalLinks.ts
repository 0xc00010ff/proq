'use client';

import { useEffect } from 'react';

type ProqDesktopAPI = { openExternal?: (url: string) => Promise<unknown> };

/**
 * Route clicks on <a target="_blank"> links to the OS default browser.
 *
 * Electron's setWindowOpenHandler does not reliably fire for every target=_blank
 * click in the renderer, leaving external links silently inert. We intercept
 * the click at document level and hand the URL to the Electron shell via
 * preload IPC (falling back to window.open for the web build).
 */
export function useExternalLinks() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;
      if (anchor.target !== '_blank') return;

      const href = anchor.getAttribute('href');
      if (!href || !/^https?:\/\//i.test(href)) return;

      e.preventDefault();
      const desktop = (window as unknown as { proqDesktop?: ProqDesktopAPI }).proqDesktop;
      if (desktop?.openExternal) {
        void desktop.openExternal(href);
      } else {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    };

    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);
}
