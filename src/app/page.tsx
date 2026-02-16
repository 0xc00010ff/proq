'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/components/ProjectsProvider';

export default function RootPage() {
  const router = useRouter();
  const { projects, isLoaded } = useProjects();

  useEffect(() => {
    if (!isLoaded) return;
    if (projects.length > 0) {
      router.replace(`/projects/${projects[0].id}`);
    }
  }, [isLoaded, projects, router]);

  if (!isLoaded) return null;

  if (projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-500 text-sm mb-2">No projects yet</p>
          <p className="text-zinc-400 text-xs">Click &quot;Add Project&quot; in the sidebar to get started.</p>
        </div>
      </div>
    );
  }

  return null;
}
