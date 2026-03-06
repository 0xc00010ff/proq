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
        <h2 className="text-sm font-semibold text-text-primary mb-5">Project Settings</h2>

        <div className="space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-deep border border-border-strong rounded-md text-text-primary focus:outline-none focus:border-border-strong"
            />
          </div>

          {/* View Type */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Default View
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setViewType('kanban')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border ${
                  viewType === 'kanban'
                    ? 'border-border-strong bg-surface-hover text-text-primary'
                    : 'border-border-default text-text-tertiary hover:border-border-strong'
                }`}
              >
                Board
              </button>
              <button
                onClick={() => setViewType('list')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border ${
                  viewType === 'list'
                    ? 'border-border-strong bg-surface-hover text-text-primary'
                    : 'border-border-default text-text-tertiary hover:border-border-strong'
                }`}
              >
                List
              </button>
            </div>
          </div>

          {/* Default Branch */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Default Branch
            </label>
            <input
              type="text"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              placeholder="main"
              className="w-full px-3 py-2 text-sm font-mono bg-surface-deep border border-border-strong rounded-md text-text-primary focus:outline-none focus:border-border-strong"
            />
          </div>

          {/* Dev Server URL */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Dev Server URL
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className="w-full px-3 py-2 text-sm font-mono bg-surface-deep border border-border-strong rounded-md text-text-primary focus:outline-none focus:border-border-strong"
            />
          </div>

          {/* Path (read-only) */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Path
            </label>
            <div className="px-3 py-2 text-sm font-mono text-text-tertiary bg-surface-deep/50 border border-border-default rounded-md truncate">
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
