'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/ui/select';
import type { Agent, Project, McpServerInfo, SkillInfo } from '@/lib/types';
import { SettingsIcon, BotIcon, PlugIcon, FileTextIcon, CheckIcon, FolderSyncIcon, AlertTriangleIcon, Loader2Icon } from 'lucide-react';

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
  const [defaultAgentId, setDefaultAgentId] = useState(project.defaultAgentId || '');
  const [workspaceInProject, setWorkspaceInProject] = useState(project.workspaceInProject || false);
  const [movingWorkspace, setMovingWorkspace] = useState(false);
  const [showWorkspaceConfirm, setShowWorkspaceConfirm] = useState(false);
  const [gitignoreWorkspace, setGitignoreWorkspace] = useState(true);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteUrlOriginal, setRemoteUrlOriginal] = useState('');
  const [remoteUrlSaving, setRemoteUrlSaving] = useState(false);
  const [remoteUrlError, setRemoteUrlError] = useState('');
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
    fetch(`/api/projects/${project.id}/git`)
      .then((res) => res.json())
      .then((data) => {
        const url = data.remoteUrl || '';
        setRemoteUrl(url);
        setRemoteUrlOriginal(url);
        setRemoteUrlError('');
      })
      .catch(() => {});
  }, [isOpen, project.id]);

  const saveRemoteUrl = useCallback(async (url: string) => {
    if (url === remoteUrlOriginal) return;
    setRemoteUrlSaving(true);
    setRemoteUrlError('');
    try {
      const res = await fetch(`/api/projects/${project.id}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-remote', url }),
      });
      if (!res.ok) {
        const data = await res.json();
        setRemoteUrlError(data.error || 'Failed to update remote');
      } else {
        setRemoteUrlOriginal(url);
      }
    } catch {
      setRemoteUrlError('Failed to update remote');
    }
    setRemoteUrlSaving(false);
  }, [project.id, remoteUrlOriginal]);

  // Save on close — flush current field values to parent
  const handleClose = useCallback(() => {
    if (!didSaveRef.current) {
      didSaveRef.current = true;
      onSave({
        name,
        defaultBranch,
        serverUrl: serverUrl || undefined,
        defaultAgentId: defaultAgentId || undefined,
      });
      // Save remote URL if changed
      if (remoteUrl.trim() && remoteUrl !== remoteUrlOriginal) {
        saveRemoteUrl(remoteUrl.trim());
      }
    }
    onClose();
  }, [name, defaultBranch, serverUrl, defaultAgentId, remoteUrl, remoteUrlOriginal, saveRemoteUrl, onSave, onClose]);

  const handleMoveToProject = async () => {
    setMovingWorkspace(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceInProject: true, gitignoreWorkspace }),
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
                <label className="block text-sm font-medium text-text-secondary mb-1">Path</label>
                <div className={`${inputClass} text-text-tertiary truncate`}>
                  {project.path}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Git Remote URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={remoteUrl}
                    onChange={(e) => { setRemoteUrl(e.target.value); setRemoteUrlError(''); }}
                    onBlur={() => { if (remoteUrl.trim() && remoteUrl !== remoteUrlOriginal) saveRemoteUrl(remoteUrl.trim()); }}
                    placeholder="https://github.com/user/repo.git"
                    className={`${inputClass} ${remoteUrlError ? 'border-red-400' : ''}`}
                  />
                  {remoteUrlSaving && <Loader2Icon className="w-4 h-4 text-text-tertiary animate-spin flex-shrink-0" />}
                </div>
                {remoteUrlError && (
                  <p className="text-xs text-red-400 mt-1">{remoteUrlError}</p>
                )}
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
            </div>
          </section>

          {/* Agent */}
          {agents && agents.length > 0 && (
            <section>
              <SectionHeading icon={<BotIcon className="w-4 h-4" />} label="Agent" />
              <div className="rounded-lg border border-border-default bg-surface-secondary p-5 space-y-4">
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
              </div>
            </section>
          )}

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
          <div className="flex items-start gap-3 mb-3">
            <AlertTriangleIcon className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Save workspace to project?</h3>
              <p className="text-xs text-text-tertiary leading-relaxed">
                Moves task data into <span className="font-mono">.proq/</span> in your project directory.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <div
              onClick={() => setGitignoreWorkspace(v => !v)}
              className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                gitignoreWorkspace
                  ? 'bg-blue-500 border-blue-500'
                  : 'border-border-strong'
              }`}
            >
              {gitignoreWorkspace && (
                <CheckIcon className="w-2.5 h-2.5 text-white" />
              )}
            </div>
            <div>
              <span className="text-xs text-text-primary">Add <span className="font-mono">.proq/workspace</span> to .gitignore</span>
              <p className="text-[11px] text-text-tertiary">Recommended for team projects</p>
            </div>
          </label>

          <div className="bg-surface-inset rounded-lg p-3 mb-4">
            <p className="text-[11px] text-text-secondary leading-relaxed">
              The <span className="font-mono">workspace/</span> directory contains your task history. Useful to track for small projects, but commonly gitignored for team projects.
            </p>
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
