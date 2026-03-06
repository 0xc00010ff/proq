'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/Modal';
import type { Project, ViewType } from '@/lib/types';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  project: Project;
  onClose: () => void;
  onSave: (data: Partial<Project>) => void;
}

export function ProjectSettingsModal({ isOpen, project, onClose, onSave }: ProjectSettingsModalProps) {
  const [name, setName] = useState(project.name);
  const [viewType, setViewType] = useState<ViewType>(project.viewType || 'kanban');
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch || 'main');
  const [serverUrl, setServerUrl] = useState(project.serverUrl || '');

  useEffect(() => {
    setName(project.name);
    setViewType(project.viewType || 'kanban');
    setDefaultBranch(project.defaultBranch || 'main');
    setServerUrl(project.serverUrl || '');
  }, [project]);

  const handleSave = () => {
    onSave({
      name,
      viewType,
      defaultBranch,
      serverUrl: serverUrl || undefined,
    });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="w-full max-w-md">
      <div className="p-6">
        <h2 className="text-sm font-semibold text-bronze-900 dark:text-text-primary mb-5">Project Settings</h2>

        <div className="space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-xs font-medium text-bronze-700 dark:text-text-secondary mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-bronze-100 dark:bg-surface-base border border-bronze-300 dark:border-border-strong rounded-md text-bronze-900 dark:text-text-primary focus:outline-none focus:border-bronze-500 dark:focus:border-border-strong transition-colors"
            />
          </div>

          {/* View Type */}
          <div>
            <label className="block text-xs font-medium text-bronze-700 dark:text-text-secondary mb-1.5">
              Default View
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setViewType('kanban')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                  viewType === 'kanban'
                    ? 'border-bronze-500 dark:border-border-strong bg-bronze-100 dark:bg-surface-hover text-bronze-900 dark:text-text-primary'
                    : 'border-bronze-300 dark:border-border-strong text-bronze-600 dark:text-text-tertiary hover:border-bronze-400 dark:hover:border-border-strong'
                }`}
              >
                Board
              </button>
              <button
                onClick={() => setViewType('list')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                  viewType === 'list'
                    ? 'border-bronze-500 dark:border-border-strong bg-bronze-100 dark:bg-surface-hover text-bronze-900 dark:text-text-primary'
                    : 'border-bronze-300 dark:border-border-strong text-bronze-600 dark:text-text-tertiary hover:border-bronze-400 dark:hover:border-border-strong'
                }`}
              >
                List
              </button>
            </div>
          </div>

          {/* Default Branch */}
          <div>
            <label className="block text-xs font-medium text-bronze-700 dark:text-text-secondary mb-1.5">
              Default Branch
            </label>
            <input
              type="text"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              placeholder="main"
              className="w-full px-3 py-2 text-sm font-mono bg-bronze-100 dark:bg-surface-base border border-bronze-300 dark:border-border-strong rounded-md text-bronze-900 dark:text-text-primary focus:outline-none focus:border-bronze-500 dark:focus:border-border-strong transition-colors"
            />
          </div>

          {/* Dev Server URL */}
          <div>
            <label className="block text-xs font-medium text-bronze-700 dark:text-text-secondary mb-1.5">
              Dev Server URL
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className="w-full px-3 py-2 text-sm font-mono bg-bronze-100 dark:bg-surface-base border border-bronze-300 dark:border-border-strong rounded-md text-bronze-900 dark:text-text-primary focus:outline-none focus:border-bronze-500 dark:focus:border-border-strong transition-colors"
            />
          </div>

          {/* Path (read-only) */}
          <div>
            <label className="block text-xs font-medium text-bronze-700 dark:text-text-secondary mb-1.5">
              Path
            </label>
            <div className="px-3 py-2 text-sm font-mono text-bronze-600 dark:text-text-tertiary bg-bronze-50 dark:bg-surface-base/50 border border-bronze-200 dark:border-border-default rounded-md truncate">
              {project.path}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary">Save</button>
        </div>
      </div>
    </Modal>
  );
}
