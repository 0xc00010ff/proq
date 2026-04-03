'use client';

import { useEffect } from 'react';

/**
 * Suppresses electron-drag regions while any Radix popover/dropdown/dialog is open,
 * so clicks in drag zones can dismiss them instead of being eaten by the compositor.
 *
 * Watches for Radix popper wrappers and focus guards as portal presence signals,
 * then directly sets -webkit-app-region: no-drag on all .electron-drag elements.
 */
export function useElectronDragSuppression() {
  useEffect(() => {
    const update = () => {
      const hasPortal =
        document.querySelector('[data-radix-popper-content-wrapper]') !== null ||
        document.querySelector('[data-radix-focus-guard]') !== null ||
        document.querySelector('[data-radix-menu-content]') !== null;

      const dragEls = document.querySelectorAll('.electron-drag');
      dragEls.forEach((el) => {
        (el as HTMLElement).style.setProperty(
          '-webkit-app-region',
          hasPortal ? 'no-drag' : 'drag'
        );
      });
    };

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    update();

    return () => {
      observer.disconnect();
      // Restore drag on cleanup
      document.querySelectorAll('.electron-drag').forEach((el) => {
        (el as HTMLElement).style.removeProperty('-webkit-app-region');
      });
    };
  }, []);
}
