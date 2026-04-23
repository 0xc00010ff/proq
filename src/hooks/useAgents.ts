'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Agent } from '@/lib/types';

/** Fetch and cache the agents list for a project. Agents are returned sorted by name. */
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

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [agents],
  );

  const agentMap = useMemo(() => new Map(sortedAgents.map((a) => [a.id, a])), [sortedAgents]);

  return { agents: sortedAgents, agentMap, setAgents };
}
