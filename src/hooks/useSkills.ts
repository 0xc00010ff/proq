'use client';

import { useState, useEffect } from 'react';
import type { SkillInfo } from '@/lib/types';

/** Fetch and cache the skills list for a project. */
export function useSkills(projectId: string | null) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/mcp-and-skills`)
      .then((res) => (res.ok ? res.json() : { skills: [] }))
      .then((data) => {
        if (!cancelled) setSkills(data.skills || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  return skills;
}
