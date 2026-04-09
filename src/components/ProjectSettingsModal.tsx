'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/Modal';
import type { Agent, Project, McpServerInfo, SkillInfo } from '@/lib/types';
import { ChevronDownIcon, PlugIcon, FileTextIcon, CheckIcon, FolderSyncIcon } from 'lucide-react';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  project: Project;
  branches?: string[];
  agents?: Agent[];
  onClose: () => void;
  onSave: (data: Partial<Project>) => void;
}

export function ProjectSettingsModal({ isOpen, project, branches, agents, onClose, onSave }: ProjectSettingsModalProps) {
  const [name, setName] = useState(project.name);
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch || 'main');
  const [serverUrl, setServerUrl] = useState(project.serverUrl || '');
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt || '');
  const [defaultAgentId, setDefaultAgentId] = useState(project.defaultAgentId || '');
  const [workspaceInProject, setWorkspaceInProject] = useState(project.workspaceInProject || false);
  const [movingWorkspace, setMovingWorkspace] = useState(false);
  const [mcpData, setMcpData] = useState<{
    globalServers: McpServerInfo[];
    projectServers: McpServerInfo[];
    configuredServers: McpServerInfo[];
    skills: SkillInfo[];
  } | null>(null);

  useEffect(() => {
    setName(project.name);
    setDefaultBranch(project.defaultBranch || 'main');
    setServerUrl(project.serverUrl || '');
    setSystemPrompt(project.systemPrompt || '');
    setDefaultAgentId(project.defaultAgentId || '');
    setWorkspaceInProject(project.workspaceInProject || false);
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
      defaultBranch,
      serverUrl: serverUrl || undefined,
      systemPrompt: systemPrompt || undefined,
      defaultAgentId: defaultAgentId || undefined,
    });
    onClose();
  };

  const handleMoveToProject = async () => {
    setMovingWorkspace(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceInProject: true }),
      });
      if (res.ok) setWorkspaceInProject(true);
    } catch { /* best effort */ }
    setMovingWorkspace(false);
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
    <Modal isOpen={isOpen} onClose={onClose} className={`w-full ${hasAnyMcpOrSkills ? 'max-w-xl' : 'max-w-lg'} max-h-[80vh] overflow-y-auto`}>
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
                  className="w-full px-3 py-2 text-xs bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong appearance-none cursor-pointer"
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
                className="w-full px-3 py-2 text-xs bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong"
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
              className="w-full px-3 py-2 text-xs bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong"
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

          {/* Default Agent */}
          {agents && agents.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Default Agent
              </label>
              <p className="text-[11px] text-text-tertiary mb-1.5">
                Used when tasks or workbench tabs don&apos;t specify an agent.
              </p>
              <div className="relative">
                <select
                  value={defaultAgentId}
                  onChange={(e) => setDefaultAgentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-secondary border border-border-default rounded-md text-text-primary focus:outline-none focus:border-border-strong appearance-none cursor-pointer"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDownIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
              </div>
            </div>
          )}

          {/* Path (read-only) */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Path
            </label>
            <div className="px-3 py-2 text-xs text-text-tertiary bg-surface-secondary/50 border border-border-default rounded-md truncate">
              {project.path}
            </div>
          </div>

          {/* Save workspace to project */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Workspace
            </label>
            {workspaceInProject ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-text-tertiary bg-surface-secondary/50 border border-border-default rounded-md">
                <CheckIcon className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                <span className="font-mono truncate">{project.path}/.proq/</span>
              </div>
            ) : (
              <div className="rounded-md border border-border-default bg-surface-secondary/50 px-3 py-3">
                <p className="text-[11px] text-text-tertiary mb-1">
                  Save the proq workspace to git. Task data will be stored in a <span className="font-mono">.proq/</span> folder in this project.
                </p>
                <p className="text-[11px] text-text-quaternary mb-2.5">
                  Handy for personal projects or sharing task history with your team.
                </p>
                <button
                  onClick={handleMoveToProject}
                  disabled={movingWorkspace}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <FolderSyncIcon className="w-3.5 h-3.5" />
                  {movingWorkspace ? 'Saving...' : 'Save to Project'}
                </button>
              </div>
            )}
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
                    <span className="text-xs text-text-primary">{skill.name}</span>
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
            <span className="text-[10px] text-text-tertiary bg-surface-inset px-1 py-px rounded">
              {server.type}
            </span>
            {detail && (
              <span className="text-[10px] text-text-quaternary truncate ml-auto max-w-[200px]">
                {detail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
