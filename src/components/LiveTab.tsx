'use client';

import React, { useState, useCallback, useRef } from 'react';
import { GlobeIcon, MonitorIcon, TabletSmartphoneIcon, SmartphoneIcon, RotateCwIcon } from 'lucide-react';
import type { Project } from '@/lib/types';
import { useProjects } from '@/components/ProjectsProvider';

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

const PRESETS: Record<Exclude<ViewportSize, 'desktop'>, { w: number; h: number }> = {
  tablet: { w: 768, h: 1024 },
  mobile: { w: 375, h: 812 },
};

interface LiveTabProps {
  project: Project;
}

export function LiveTab({ project }: LiveTabProps) {
  const [urlInput, setUrlInput] = useState('http://localhost:3000');
  const [barValue, setBarValue] = useState(project.serverUrl ?? '');
  const initialVp = project.liveViewport ?? 'desktop';
  const [viewport, setViewport] = useState<ViewportSize>(initialVp);
  const [size, setSize] = useState(initialVp !== 'desktop' ? PRESETS[initialVp] : { w: 768, h: 1024 });
  const [iframeKey, setIframeKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const { refreshProjects } = useProjects();

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

  const handleResizeStart = useCallback((axis: 'x' | 'y' | 'xy', e: React.MouseEvent) => {
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

  if (!project.serverUrl) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-surface-deep text-text-secondary p-8">
        <div className="w-16 h-16 rounded-2xl bg-surface-base flex items-center justify-center mb-6 border border-border-default">
          <MonitorIcon className="w-8 h-8 text-text-placeholder" />
        </div>
        <h3 className="text-lg font-medium text-text-primary mb-2">
          No preview configured
        </h3>
        <p className="text-sm text-text-tertiary max-w-md text-center mb-8">
          Connect a development server URL to see a live preview of your
          application directly within proq.
        </p>
        <div className="flex w-full max-w-sm items-center space-x-2">
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
      </div>
    );
  }

  const isDevice = viewport !== 'desktop';

  return (
    <div className="flex-1 h-full flex flex-col bg-surface-deep">
      <div className="h-10 bg-surface-base border-b border-border-default flex items-center px-4 space-x-4">
        <div className="flex space-x-1.5">
          <div className="w-3 h-3 rounded-full bg-crimson/20 border border-crimson/50" />
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
              onMouseDown={(e) => handleResizeStart('x', e)}
              className="absolute top-0 -right-4 w-4 h-full cursor-ew-resize flex items-center justify-center group"
            >
              <div className="w-1 h-8 rounded-full bg-border-default group-hover:bg-text-secondary" />
            </div>

            {/* Bottom resize handle */}
            <div
              onMouseDown={(e) => handleResizeStart('y', e)}
              className="absolute -bottom-4 left-0 w-full h-4 cursor-ns-resize flex items-center justify-center group"
            >
              <div className="h-1 w-8 rounded-full bg-border-default group-hover:bg-text-secondary" />
            </div>

            {/* Corner resize handle */}
            <div
              onMouseDown={(e) => handleResizeStart('xy', e)}
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
    </div>
  );
}
