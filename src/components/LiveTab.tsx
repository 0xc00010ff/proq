'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GlobeIcon, MonitorIcon, TabletSmartphoneIcon, SmartphoneIcon, RotateCwIcon, TerminalIcon, SquareChevronUpIcon, XIcon } from 'lucide-react';
import type { Project } from '@/lib/types';
import { useProjects } from '@/components/ProjectsProvider';
import WorkbenchPanel, { type WorkbenchPanelHandle } from '@/components/WorkbenchPanel';

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

const PRESETS: Record<Exclude<ViewportSize, 'desktop'>, { w: number; h: number }> = {
  tablet: { w: 768, h: 1024 },
  mobile: { w: 375, h: 812 },
};

interface LiveTabProps {
  project: Project;
  workbenchCollapsed: boolean;
  workbenchHeight: number;
  isDragging: boolean;
  onToggleCollapsed: () => void;
  onExpand: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function LiveTab({ project, workbenchCollapsed, workbenchHeight, isDragging, onToggleCollapsed, onExpand, onResizeStart }: LiveTabProps) {
  const [urlInput, setUrlInput] = useState('http://localhost:3000');
  const [barValue, setBarValue] = useState(project.serverUrl ?? '');
  const initialVp = project.liveViewport ?? 'desktop';
  const [viewport, setViewport] = useState<ViewportSize>(initialVp);
  const [size, setSize] = useState(initialVp !== 'desktop' ? PRESETS[initialVp] : { w: 768, h: 1024 });
  const [iframeKey, setIframeKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const workbenchRef = useRef<WorkbenchPanelHandle>(null);
  const { refreshProjects } = useProjects();
  const prevServerUrl = useRef(project.serverUrl);

  // Auto-refresh iframe when serverUrl changes (e.g. agent sets it)
  useEffect(() => {
    if (project.serverUrl && project.serverUrl !== prevServerUrl.current) {
      setBarValue(project.serverUrl);
      setIframeKey(k => k + 1);
    }
    prevServerUrl.current = project.serverUrl;
  }, [project.serverUrl]);

  const handleRefresh = () => setIframeKey(k => k + 1);

  const pickViewport = async (v: ViewportSize) => {
    setViewport(v);
    if (v !== 'desktop') setSize(PRESETS[v]);
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liveViewport: v }),
    });
  };

  const handleConnect = async () => {
    const url = urlInput.trim();
    if (!url) return;
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl: url }),
    });
    await refreshProjects();
  };

  const handleDisconnect = async () => {
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl: '' }),
    });
    await refreshProjects();
  };

  const handleResizeStartViewport = useCallback((axis: 'x' | 'y' | 'xy', e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.w;
    const startH = size.h;

    const onMove = (ev: MouseEvent) => {
      setSize(prev => ({
        w: axis !== 'y' ? Math.max(280, startW + (ev.clientX - startX) * 2) : prev.w,
        h: axis !== 'x' ? Math.max(300, startH + (ev.clientY - startY)) : prev.h,
      }));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
    };

    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [size.w, size.h]);

  const activateTab = useCallback((type: 'agent' | 'shell') => {
    if (type === 'agent') {
      workbenchRef.current?.addAgentTab('Start the dev environment');
    } else {
      workbenchRef.current?.addShellTab();
    }
    onExpand();
  }, [onExpand]);

  const isDevice = viewport !== 'desktop';

  return (
    <>
      <div
        className="flex-1 min-h-0 overflow-hidden flex flex-col bg-surface-deep"
        style={workbenchCollapsed ? undefined : { flexBasis: `${100 - workbenchHeight}%` }}
      >
        {!project.serverUrl ? (
          /* ── Empty State ── */
          <div className="flex-1 flex flex-col items-center justify-center text-text-secondary p-8">
            <div className="w-16 h-16 rounded-2xl bg-surface-base flex items-center justify-center mb-6 border border-border-default">
              <MonitorIcon className="w-8 h-8 text-text-placeholder" />
            </div>
            <h3 className="text-lg font-medium text-text-primary mb-2">
              Live Preview
            </h3>
            <p className="text-sm text-text-tertiary max-w-md text-center mb-8">
              Connect to a running dev server or start one below.
            </p>

            {/* URL input */}
            <div className="flex w-full max-w-sm items-center space-x-2 mb-8">
              <input
                type="text"
                placeholder="http://localhost:3000"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                className="flex-1 bg-surface-base border border-border-default rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-placeholder focus:outline-none focus:ring-1 focus:ring-lazuli/50"
              />
              <button
                onClick={handleConnect}
                className="bg-bronze-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-bronze-800 dark:hover:bg-zinc-200"
              >
                Connect
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center w-full max-w-sm mb-8">
              <div className="flex-1 h-px bg-border-default" />
              <span className="px-3 text-xs text-text-placeholder">or start the server</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>

            {/* Big buttons */}
            <div className="flex gap-4 w-full max-w-sm">
              <button
                onClick={() => activateTab('agent')}
                className="flex-1 flex flex-col items-center gap-3 p-6 rounded-xl border border-border-default bg-surface-base hover:bg-surface-hover hover:border-border-strong transition-colors group"
              >
                <div className="w-12 h-12 rounded-xl bg-surface-deep flex items-center justify-center border border-border-default group-hover:border-bronze-500/40 transition-colors">
                  <SquareChevronUpIcon className="w-6 h-6 text-text-tertiary group-hover:text-bronze-400 transition-colors" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-text-primary mb-0.5">Agent</div>
                  <div className="text-xs text-text-tertiary">Let AI start it</div>
                </div>
              </button>

              <button
                onClick={() => activateTab('shell')}
                className="flex-1 flex flex-col items-center gap-3 p-6 rounded-xl border border-border-default bg-surface-base hover:bg-surface-hover hover:border-border-strong transition-colors group"
              >
                <div className="w-12 h-12 rounded-xl bg-surface-deep flex items-center justify-center border border-border-default group-hover:border-emerald/40 transition-colors">
                  <TerminalIcon className="w-6 h-6 text-text-tertiary group-hover:text-emerald transition-colors" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-text-primary mb-0.5">Terminal</div>
                  <div className="text-xs text-text-tertiary">Run it yourself</div>
                </div>
              </button>
            </div>
          </div>
        ) : (
          /* ── Preview ── */
          <>
            <div className="h-10 bg-surface-base border-b border-border-default flex items-center px-4 space-x-4 shrink-0">
              <div className="flex space-x-1.5">
                <button
                  onClick={handleDisconnect}
                  title="Disconnect"
                  className="w-3 h-3 rounded-full bg-crimson/20 border border-crimson/50 hover:bg-crimson/60 flex items-center justify-center group/dot transition-colors"
                >
                  <XIcon className="w-1.5 h-1.5 text-transparent group-hover/dot:text-white transition-colors" />
                </button>
                <div className="w-3 h-3 rounded-full bg-gold/20 border border-gold/50" />
                <div className="w-3 h-3 rounded-full bg-emerald/20 border border-emerald/50" />
              </div>
              <div className="flex-1 flex items-center justify-center space-x-2">
                <button
                  onClick={handleRefresh}
                  title="Refresh"
                  className="p-1.5 rounded text-text-placeholder hover:text-text-secondary hover:bg-surface-hover"
                >
                  <RotateCwIcon className="w-3.5 h-3.5" />
                </button>
                <div className="bg-surface-deep border border-border-default rounded px-3 py-1 text-xs text-text-secondary flex items-center space-x-2 min-w-[300px]">
                  <GlobeIcon className="w-3 h-3 shrink-0" />
                  <input
                    type="text"
                    value={barValue}
                    onChange={(e) => setBarValue(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        const url = barValue.trim();
                        if (!url || url === project.serverUrl) return;
                        await fetch(`/api/projects/${project.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ serverUrl: url }),
                        });
                        await refreshProjects();
                      }
                    }}
                    className="flex-1 bg-transparent text-xs text-text-secondary focus:text-text-primary outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center space-x-1">
                {([
                  { key: 'desktop' as ViewportSize, icon: MonitorIcon, label: 'Desktop' },
                  { key: 'tablet' as ViewportSize, icon: TabletSmartphoneIcon, label: 'Tablet' },
                  { key: 'mobile' as ViewportSize, icon: SmartphoneIcon, label: 'Mobile / Responsive' },
                ]).map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    onClick={() => pickViewport(key)}
                    title={label}
                    className={`p-1.5 rounded ${
                      viewport === key
                        ? 'bg-surface-hover text-text-primary'
                        : 'text-text-placeholder hover:text-text-secondary'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>

            {isDevice ? (
              <div
                ref={containerRef}
                className="flex-1 flex items-start justify-center overflow-auto p-6"
                style={{
                  backgroundColor: 'var(--surface-base)',
                  backgroundImage: 'radial-gradient(circle, var(--live-dot-color) 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              >
                <div className="relative inline-flex flex-col" style={{ maxWidth: '100%' }}>
                  <div
                    className="rounded-xl overflow-hidden"
                    style={{
                      border: '8px solid #2a2a2e',
                      boxShadow: '0 0 0 1px #3f3f46, 0 8px 32px rgba(0,0,0,0.4)',
                      width: `${size.w}px`,
                      height: `${size.h}px`,
                      maxWidth: '100%',
                    }}
                  >
                    <iframe key={iframeKey} src={project.serverUrl} className="w-full h-full border-0" />
                  </div>

                  {/* Right resize handle */}
                  <div
                    onMouseDown={(e) => handleResizeStartViewport('x', e)}
                    className="absolute top-0 -right-4 w-4 h-full cursor-ew-resize flex items-center justify-center group"
                  >
                    <div className="w-1 h-8 rounded-full bg-border-default group-hover:bg-text-secondary" />
                  </div>

                  {/* Bottom resize handle */}
                  <div
                    onMouseDown={(e) => handleResizeStartViewport('y', e)}
                    className="absolute -bottom-4 left-0 w-full h-4 cursor-ns-resize flex items-center justify-center group"
                  >
                    <div className="h-1 w-8 rounded-full bg-border-default group-hover:bg-text-secondary" />
                  </div>

                  {/* Corner resize handle */}
                  <div
                    onMouseDown={(e) => handleResizeStartViewport('xy', e)}
                    className="absolute -bottom-4 -right-4 w-4 h-4 cursor-nwse-resize flex items-center justify-center group"
                  >
                    <div className="w-2 h-2 rounded-full bg-border-default group-hover:bg-text-secondary" />
                  </div>

                  <div className="mt-3 text-center text-[10px] text-text-tertiary font-mono select-none">
                    {size.w} × {size.h}
                  </div>
                </div>
              </div>
            ) : (
              <iframe key={iframeKey} src={project.serverUrl} className="flex-1 w-full border-0" />
            )}
          </>
        )}
      </div>

      <WorkbenchPanel
        ref={workbenchRef}
        projectId={project.id}
        projectPath={project.path}
        scope="live"
        agentContext="live"
        style={{ flexBasis: `${workbenchHeight}%` }}
        collapsed={workbenchCollapsed}
        onToggleCollapsed={onToggleCollapsed}
        onExpand={onExpand}
        onResizeStart={onResizeStart}
        isDragging={isDragging}
      />
    </>
  );
}
