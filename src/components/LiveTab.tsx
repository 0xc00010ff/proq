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
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-bronze-100 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 p-8">
        <div className="w-16 h-16 rounded-2xl bg-bronze-200 dark:bg-zinc-900 flex items-center justify-center mb-6 border border-bronze-300 dark:border-zinc-800">
          <MonitorIcon className="w-8 h-8 text-zinc-400 dark:text-zinc-600" />
        </div>
        <h3 className="text-lg font-medium text-bronze-800 dark:text-zinc-200 mb-2">
          No preview configured
        </h3>
        <p className="text-sm text-zinc-500 max-w-md text-center mb-8">
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
            className="flex-1 bg-bronze-200 dark:bg-zinc-900 border border-bronze-300 dark:border-zinc-800 rounded-md px-3 py-2 text-sm text-bronze-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-steel/50"
          />
          <button
            onClick={handleConnect}
            className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200"
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  const isDevice = viewport !== 'desktop';

  return (
    <div className="flex-1 h-full flex flex-col bg-bronze-100 dark:bg-zinc-950">
      <div className="h-10 bg-bronze-200 dark:bg-zinc-900 border-b border-bronze-300 dark:border-zinc-800 flex items-center px-4 space-x-4">
        <div className="flex space-x-1.5">
          <div className="w-3 h-3 rounded-full bg-crimson/20 border border-crimson/50" />
          <div className="w-3 h-3 rounded-full bg-gold/20 border border-gold/50" />
          <div className="w-3 h-3 rounded-full bg-patina/20 border border-patina/50" />
        </div>
        <div className="flex-1 flex items-center justify-center space-x-2">
          <button
            onClick={handleRefresh}
            title="Refresh"
            className="p-1.5 rounded text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-bronze-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <RotateCwIcon className="w-3.5 h-3.5" />
          </button>
          <div className="bg-bronze-50 dark:bg-zinc-950 border border-bronze-300 dark:border-zinc-800 rounded px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400 flex items-center space-x-2 min-w-[300px]">
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
              className="flex-1 bg-transparent text-xs text-zinc-500 dark:text-zinc-400 focus:text-zinc-800 dark:focus:text-zinc-200 outline-none"
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
              className={`p-1.5 rounded transition-colors ${
                viewport === key
                  ? 'bg-bronze-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                  : 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'
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
              <div className="w-1 h-8 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
            </div>

            {/* Bottom resize handle */}
            <div
              onMouseDown={(e) => handleResizeStart('y', e)}
              className="absolute -bottom-4 left-0 w-full h-4 cursor-ns-resize flex items-center justify-center group"
            >
              <div className="h-1 w-8 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
            </div>

            {/* Corner resize handle */}
            <div
              onMouseDown={(e) => handleResizeStart('xy', e)}
              className="absolute -bottom-4 -right-4 w-4 h-4 cursor-nwse-resize flex items-center justify-center group"
            >
              <div className="w-2 h-2 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
            </div>

            <div className="mt-3 text-center text-[10px] text-zinc-500 font-mono select-none">
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
