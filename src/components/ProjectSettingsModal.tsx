'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/Modal';
import type { Project, ViewType, McpServerInfo, SkillInfo } from '@/lib/types';
import { ChevronDownIcon, PlugIcon, FileTextIcon } from 'lucide-react';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  project: Project;
  branches?: string[];
  onClose: () => void;
  onSave: (data: Partial<Project>) => void;
}

export function ProjectSettingsModal({ isOpen, project, branches, onClose, onSave }: ProjectSettingsModalProps) {
  const [name, setName] = useState(project.name);
  const [viewType, setViewType] = useState<ViewType>(project.viewType || 'kanban');
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch || 'main');
  const [serverUrl, setServerUrl] = useState(project.serverUrl || '');
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt || '');
  const [mcpData, setMcpData] = useState<{
    globalServers: McpServerInfo[];
    projectServers: McpServerInfo[];
    configuredServers: McpServerInfo[];
    skills: SkillInfo[];
  } | null>(null);

  useEffect(() => {
    setName(project.name);
    setViewType(project.viewType || 'kanban');
    setDefaultBranch(project.defaultBranch || 'main');
    setServerUrl(project.serverUrl || '');
    setSystemPrompt(project.systemPrompt || '');
  }, [project]);

  useEffect(() => {
    if (!isOpen) return;
    fetch(`/api/projects/${project.id}/mcp-and-skills`)
      .then((res) => res.json())
      .then(setMcpData)
      .catch(console.error);
  }, [isOpen, project.id]);

  const handleSave = () => {
    onSave({
      name,
      viewType,
      defaultBranch,
      serverUrl: serverUrl || undefined,
      systemPrompt: systemPrompt || undefined,
    });
    onClose();
  };

  // Filter out proq/* branches from the selector — they're task branches, not base branches
  const selectableBranches = branches?.filter(b => !b.startsWith('proq/')) || [];

  const hasAnyMcpOrSkills = mcpData && (
    mcpData.projectServers.length > 0 ||
    mcpData.configuredServers.length > 0 ||
    mcpData.globalServers.length > 0 ||
    mcpData.skills.length > 0
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} className={`w-full ${hasAnyMcpOrSkills ? 'max-w-lg' : 'max-w-md'}`}>
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
              className="w-full px-3 py-2 text-sm bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong"
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
              <button
                onClick={() => setViewType('grid')}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border ${
                  viewType === 'grid'
                    ? 'border-border-strong bg-surface-hover text-text-primary'
                    : 'border-border-default text-text-tertiary hover:border-border-strong'
                }`}
              >
                Grid
              </button>
            </div>
          </div>

          {/* Default Branch */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Default Branch
            </label>
            {selectableBranches.length > 0 ? (
              <div className="relative">
                <select
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong appearance-none cursor-pointer"
                >
                  {selectableBranches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                  {!selectableBranches.includes(defaultBranch) && (
                    <option value={defaultBranch}>{defaultBranch}</option>
                  )}
                </select>
                <ChevronDownIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
              </div>
            ) : (
              <input
                type="text"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 text-sm font-mono bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong"
              />
            )}
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
              className="w-full px-3 py-2 text-sm font-mono bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              System Prompt
            </label>
            <p className="text-[11px] text-text-tertiary mb-1.5">
              Custom instructions for agents working on this project.
            </p>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g. Use the project's ESLint config. Always run tests before committing..."
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong resize-y min-h-[60px]"
            />
          </div>

          {/* Path (read-only) */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Path
            </label>
            <div className="px-3 py-2 text-sm font-mono text-text-tertiary bg-surface-secondary/50 border border-border-default rounded-md truncate">
              {project.path}
            </div>
          </div>

          {/* MCP Servers */}
          {mcpData && (mcpData.projectServers.length > 0 || mcpData.configuredServers.length > 0 || mcpData.globalServers.length > 0) && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                MCP Servers
              </label>
              <div className="rounded-md border border-border-default bg-surface-secondary/50 px-3 py-2 space-y-2">
                {mcpData.projectServers.length > 0 && (
                  <McpGroup label="Project" servers={mcpData.projectServers} />
                )}
                {mcpData.configuredServers.length > 0 && (
                  <McpGroup label="Configured" servers={mcpData.configuredServers} />
                )}
                {mcpData.globalServers.length > 0 && (
                  <McpGroup label="Global" servers={mcpData.globalServers} dimmed />
                )}
              </div>
            </div>
          )}

          {/* Skills */}
          {mcpData && mcpData.skills.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Skills
              </label>
              <div className="rounded-md border border-border-default bg-surface-secondary/50 px-3 py-2">
                {mcpData.skills.map((skill) => (
                  <div key={skill.filename} className="flex items-center gap-2 py-1">
                    <FileTextIcon className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                    <span className="text-sm font-mono text-text-primary">{skill.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary">Save</button>
        </div>
      </div>
    </Modal>
  );
}

function McpGroup({ label, servers, dimmed }: { label: string; servers: McpServerInfo[]; dimmed?: boolean }) {
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wider font-medium mb-0.5 ${dimmed ? 'text-text-quaternary' : 'text-text-tertiary'}`}>
        {label}
      </p>
      {servers.map((server) => {
        const detail = server.url || [server.command, ...(server.args || [])].join(' ');
        return (
          <div key={server.name} className={`flex items-center gap-2 py-0.5 ${dimmed ? 'opacity-50' : ''}`}>
            <PlugIcon className="w-3 h-3 text-text-tertiary flex-shrink-0" />
            <span className="text-xs text-text-primary font-medium">{server.name}</span>
            <span className="text-[10px] font-mono text-text-tertiary bg-surface-inset px-1 py-px rounded">
              {server.type}
            </span>
            {detail && (
              <span className="text-[10px] text-text-quaternary font-mono truncate ml-auto max-w-[200px]">
                {detail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
