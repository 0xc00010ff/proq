'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/ui/select';
import type { Agent, Project, McpServerInfo, SkillInfo } from '@/lib/types';
import { SettingsIcon, BotIcon, PlugIcon, FileTextIcon, CheckIcon, FolderSyncIcon, AlertTriangleIcon } from 'lucide-react';

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
  const [showWorkspaceConfirm, setShowWorkspaceConfirm] = useState(false);
  const [mcpData, setMcpData] = useState<{
    globalServers: McpServerInfo[];
    projectServers: McpServerInfo[];
    configuredServers: McpServerInfo[];
    skills: SkillInfo[];
  } | null>(null);

  // Track whether we've already saved on close to avoid double-saves
  const didSaveRef = useRef(false);

  useEffect(() => {
    setName(project.name);
    setDefaultBranch(project.defaultBranch || 'main');
    setServerUrl(project.serverUrl || '');
    setSystemPrompt(project.systemPrompt || '');
    setDefaultAgentId(project.defaultAgentId || '');
    setWorkspaceInProject(project.workspaceInProject || false);
    didSaveRef.current = false;
  }, [project]);

  useEffect(() => {
    if (!isOpen) return;
    didSaveRef.current = false;
    fetch(`/api/projects/${project.id}/mcp-and-skills`)
      .then((res) => res.json())
      .then(setMcpData)
      .catch(console.error);
  }, [isOpen, project.id]);

  // Save on close — flush current field values to parent
  const handleClose = useCallback(() => {
    if (!didSaveRef.current) {
      didSaveRef.current = true;
      onSave({
        name,
        defaultBranch,
        serverUrl: serverUrl || undefined,
        systemPrompt: systemPrompt || undefined,
        defaultAgentId: defaultAgentId || undefined,
      });
    }
    onClose();
  }, [name, defaultBranch, serverUrl, systemPrompt, defaultAgentId, onSave, onClose]);

  const handleMoveToProject = async () => {
    setMovingWorkspace(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceInProject: true }),
      });
      if (res.ok) {
        setWorkspaceInProject(true);
        onSave({ workspaceInProject: true } as Partial<Project>);
      }
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

  const inputClass = "w-full bg-surface-inset border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-strong placeholder:text-text-placeholder";

  const branchOptions = selectableBranches.map(b => ({ value: b, label: b }));
  if (!selectableBranches.includes(defaultBranch)) {
    branchOptions.push({ value: defaultBranch, label: defaultBranch });
  }

  const agentOptions = (agents || []).map(a => ({ value: a.id, label: a.name }));

  return (
    <Modal isOpen={isOpen} onClose={handleClose} preventAutoFocus className={`w-full ${hasAnyMcpOrSkills ? 'max-w-xl' : 'max-w-lg'} max-h-[80vh] overflow-y-auto`}>
      <div className="p-6">
        <h2 className="text-sm font-semibold text-text-primary mb-5">Project Settings</h2>

        <div className="space-y-6">
          {/* General */}
          <section>
            <SectionHeading icon={<SettingsIcon className="w-4 h-4" />} label="General" />
            <div className="rounded-lg border border-border-default bg-surface-secondary p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Default Branch</label>
                {selectableBranches.length > 0 ? (
                  <Select
                    value={defaultBranch}
                    onChange={setDefaultBranch}
                    options={branchOptions}
                  />
                ) : (
                  <input
                    type="text"
                    value={defaultBranch}
                    onChange={(e) => setDefaultBranch(e.target.value)}
                    placeholder="main"
                    className={inputClass}
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Dev Server URL</label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Path</label>
                <div className={`${inputClass} text-text-tertiary truncate`}>
                  {project.path}
                </div>
              </div>
            </div>
          </section>

          {/* Agent */}
          <section>
            <SectionHeading icon={<BotIcon className="w-4 h-4" />} label="Agent" />
            <div className="rounded-lg border border-border-default bg-surface-secondary p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">System Prompt</label>
                <p className="text-xs text-text-tertiary mb-2">
                  Custom instructions for agents working on this project.
                </p>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="e.g. Use the project's ESLint config. Always run tests before committing..."
                  rows={3}
                  className={`${inputClass} resize-y min-h-[60px]`}
                />
              </div>
              {agents && agents.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Default Agent</label>
                  <p className="text-xs text-text-tertiary mb-2">
                    Used when tasks or workbench tabs don&apos;t specify an agent.
                  </p>
                  <Select
                    value={defaultAgentId}
                    onChange={setDefaultAgentId}
                    options={agentOptions}
                  />
                </div>
              )}
            </div>
          </section>

          {/* MCP Servers & Skills */}
          {hasAnyMcpOrSkills && (
            <section>
              <SectionHeading icon={<PlugIcon className="w-4 h-4" />} label="MCP Servers" />
              <div className="rounded-lg border border-border-default bg-surface-secondary p-5 space-y-4">
                {(mcpData!.projectServers.length > 0 || mcpData!.configuredServers.length > 0 || mcpData!.globalServers.length > 0) && (
                  <div className="space-y-2">
                    {mcpData!.projectServers.length > 0 && (
                      <McpGroup label="Project" servers={mcpData!.projectServers} />
                    )}
                    {mcpData!.configuredServers.length > 0 && (
                      <McpGroup label="Configured" servers={mcpData!.configuredServers} />
                    )}
                    {mcpData!.globalServers.length > 0 && (
                      <McpGroup label="Global" servers={mcpData!.globalServers} dimmed />
                    )}
                  </div>
                )}
                {mcpData!.skills.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">Skills</label>
                    <div className="mt-1">
                      {mcpData!.skills.map((skill) => (
                        <div key={skill.filename} className="flex items-center gap-2 py-1">
                          <FileTextIcon className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                          <span className="text-xs text-text-primary">{skill.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Workspace */}
          <section>
            <SectionHeading icon={<FolderSyncIcon className="w-4 h-4" />} label="Workspace" />
            <div className="rounded-lg border border-border-default bg-surface-secondary p-5">
              {workspaceInProject ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-text-tertiary bg-surface-inset border border-border-default rounded-md">
                  <CheckIcon className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  <span className="font-mono truncate">{project.path}/.proq/</span>
                </div>
              ) : (
                <>
                  <p className="text-xs text-text-tertiary mb-2">
                    Save the proq workspace to git. Task data will be stored in a <span className="font-mono">.proq/</span> folder in this project. Handy for personal projects or sharing task history with your team.
                  </p>
                  <button
                    onClick={() => setShowWorkspaceConfirm(true)}
                    disabled={movingWorkspace}
                    className="btn-secondary text-xs pl-0 flex items-center gap-1.5"
                  >
                    <FolderSyncIcon className="w-3.5 h-3.5" />
                    {movingWorkspace ? 'Saving...' : 'Save to Project'}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>

      </div>

      {/* Workspace confirmation modal */}
      <Modal isOpen={showWorkspaceConfirm} onClose={() => setShowWorkspaceConfirm(false)} className="w-full max-w-sm">
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangleIcon className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">Save workspace to project?</h3>
              <p className="text-xs text-text-tertiary leading-relaxed">
                This will move all task data for this project into a <span className="font-mono">.proq/</span> folder at:
              </p>
              <p className="text-xs font-mono text-text-secondary mt-1.5 break-all">
                {project.path}/.proq/
              </p>
              <p className="text-xs text-text-tertiary mt-1.5 leading-relaxed">
                The folder will be committed to git, making task history visible to anyone with access to the repo. This cannot be undone from the UI.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowWorkspaceConfirm(false)} className="btn-secondary text-xs">Cancel</button>
            <button
              onClick={() => {
                setShowWorkspaceConfirm(false);
                handleMoveToProject();
              }}
              className="btn-primary text-xs"
            >
              Save to Project
            </button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-text-tertiary">{icon}</span>
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{label}</h3>
    </div>
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
