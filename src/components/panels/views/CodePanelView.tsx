'use client';

import React from 'react';
import { CodeTab } from '@/components/CodeTab';
import { PanelChrome } from '@/components/panels/PanelChrome';
import type { PanelKind, Project } from '@/lib/types';

interface CodePanelViewProps {
  project: Project;
  onChangePanelKind: (kind: PanelKind) => void;
}

/**
 * Code editor view. CodeTab keeps its existing breadcrumb / file-tabs strip
 * inside; the panel sub-nav stays empty besides the type switcher.
 */
export function CodePanelView({ project, onChangePanelKind }: CodePanelViewProps) {
  return (
    <PanelChrome currentKind="code" onChangeKind={onChangePanelKind}>
      <div className="absolute inset-0">
        <CodeTab project={project} />
      </div>
    </PanelChrome>
  );
}
