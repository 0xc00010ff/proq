'use client';

import { useState, useEffect } from 'react';
import type { Agent } from '@/lib/types';

/** Fetch and cache the agents list for a project. */
export function useAgents(projectId: string | null) {
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/agents`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Agent[]) => {
        if (!cancelled) setAgents(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  return { agents, agentMap, setAgents };
}
