'use client';

import { useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ProjectTab } from '@/lib/types';

const VALID_TABS = new Set<ProjectTab>(['project', 'live', 'code']);

/**
 * Syncs active tab and open task with URL search params.
 *
 * URL scheme:
 *   /projects/[id]              → project tab (default)
 *   /projects/[id]?tab=live     → live tab
 *   /projects/[id]?tab=code     → code tab
 *   /projects/[id]?task=xyz     → task modal open
 */
export function useRouteState(projectId: string, fallbackTab: ProjectTab = 'project') {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Track whether the current task was opened via navigation (click)
  // vs direct URL load, so closeTask can use router.back() appropriately
  const openedViaClickRef = useRef(false);

  const tabParam = searchParams.get('tab') as ProjectTab | null;
  const activeTab: ProjectTab = tabParam && VALID_TABS.has(tabParam) ? tabParam : fallbackTab;
  const openTaskId: string | null = searchParams.get('task');

  const buildUrl = useCallback((params: { tab?: ProjectTab; task?: string | null }) => {
    const sp = new URLSearchParams();
    const tab = params.tab ?? activeTab;
    if (tab && tab !== 'project') sp.set('tab', tab);
    const task = params.task !== undefined ? params.task : openTaskId;
    if (task) sp.set('task', task);
    const qs = sp.toString();
    return `/projects/${projectId}${qs ? `?${qs}` : ''}`;
  }, [projectId, activeTab, openTaskId]);

  const setTab = useCallback((tab: ProjectTab) => {
    // Clear task when switching tabs
    const sp = new URLSearchParams();
    if (tab !== 'project') sp.set('tab', tab);
    const qs = sp.toString();
    router.push(`/projects/${projectId}${qs ? `?${qs}` : ''}`);
  }, [projectId, router]);

  const openTask = useCallback((taskId: string) => {
    openedViaClickRef.current = true;
    router.push(buildUrl({ task: taskId }));
  }, [router, buildUrl]);

  const closeTask = useCallback(() => {
    if (openedViaClickRef.current) {
      openedViaClickRef.current = false;
      router.back();
    } else {
      // Direct URL navigation — push without the task param
      router.push(buildUrl({ task: null }));
    }
  }, [router, buildUrl]);

  return { activeTab, openTaskId, setTab, openTask, closeTask };
}
