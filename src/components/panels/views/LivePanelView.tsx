'use client';

import React from 'react';
import { LiveTab } from '@/components/LiveTab';
import { PanelChrome } from '@/components/panels/PanelChrome';
import type { PanelKind, Project } from '@/lib/types';

interface LivePanelViewProps {
  project: Project;
  onActivateWorkbenchTab: (type: 'agent' | 'shell') => void;
  onChangePanelKind: (kind: PanelKind) => void;
}

/**
 * Live preview view. The URL bar / viewport controls live inside LiveTab; the
 * panel sub-nav stays empty besides the type switcher.
 */
export function LivePanelView({ project, onActivateWorkbenchTab, onChangePanelKind }: LivePanelViewProps) {
  return (
    <PanelChrome currentKind="live" onChangeKind={onChangePanelKind}>
      <div className="absolute inset-0">
        <LiveTab project={project} onActivateWorkbenchTab={onActivateWorkbenchTab} />
      </div>
    </PanelChrome>
  );
}
