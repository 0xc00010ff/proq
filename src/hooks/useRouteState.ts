'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Syncs the open task modal with URL search params.
 * Pushes a new history entry on each open/close so back/forward stack naturally.
 *
 * URL scheme:
 *   /projects/[id]              → no task open
 *   /projects/[id]?task=xyz     → task modal open
 */
export function useRouteState(projectId: string) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const openTaskId: string | null = searchParams.get('task');

  const openTask = useCallback((taskId: string) => {
    const sp = new URLSearchParams();
    sp.set('task', taskId);
    router.push(`/projects/${projectId}?${sp.toString()}`);
  }, [projectId, router]);

  const closeTask = useCallback(() => {
    router.push(`/projects/${projectId}`);
  }, [projectId, router]);

  return { openTaskId, openTask, closeTask };
}
