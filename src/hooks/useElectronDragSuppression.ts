'use client';

import { useEffect } from 'react';

/**
 * Suppresses electron-drag regions while any Radix portal is open,
 * so clicks in drag zones can dismiss dropdowns/modals/popovers.
 */
export function useElectronDragSuppression() {
  useEffect(() => {
    const update = () => {
      const hasPortal = document.querySelector('[data-radix-portal]') !== null;
      document.body.classList.toggle('modal-open', hasPortal);
    };

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    update();

    return () => observer.disconnect();
  }, []);
}
