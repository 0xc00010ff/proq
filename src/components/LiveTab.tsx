'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GlobeIcon, MonitorIcon, TabletSmartphoneIcon, SmartphoneIcon } from 'lucide-react';
import type { Project } from '@/lib/types';
import { useProjects } from '@/components/ProjectsProvider';

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_DEFAULTS: Record<ViewportSize, { w: number; h: number | null; resizeX: boolean; resizeY: boolean }> = {
  desktop: { w: 0, h: null, resizeX: false, resizeY: false },
  tablet:  { w: 768, h: null, resizeX: true, resizeY: false },
  mobile:  { w: 375, h: 812, resizeX: true, resizeY: true },
};

interface LiveTabProps {
  project: Project;
}

export function LiveTab({ project }: LiveTabProps) {
  const [urlInput, setUrlInput] = useState('http://localhost:3000');
  const [barValue, setBarValue] = useState(project.serverUrl ?? '');
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [size, setSize] = useState<{ w: number; h: number | null }>({ w: 0, h: null });
  const containerRef = useRef<HTMLDivElement>(null);
  const { refreshProjects } = useProjects();

  // Reset size when viewport changes
  useEffect(() => {
    const defaults = VIEWPORT_DEFAULTS[viewport];
    setSize({ w: defaults.w, h: defaults.h });
  }, [viewport]);

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
    const startW = size.w || (containerRef.current?.offsetWidth ?? 768);
    const startH = size.h || (containerRef.current?.offsetHeight ?? 600);

    const onMove = (ev: MouseEvent) => {
      setSize(prev => ({
        w: axis !== 'y' ? Math.max(280, startW + (ev.clientX - startX) * 2) : prev.w,
        h: axis !== 'x' ? Math.max(300, startH + (ev.clientY - startY)) : prev.h,
      }));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Re-enable pointer events on iframe
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(f => f.style.pointerEvents = '');
    };

    // Disable pointer events on iframe during drag
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(f => f.style.pointerEvents = 'none');

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [size.w, size.h]);

  if (!project.serverUrl) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-gunmetal-100 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 p-8">
        <div className="w-16 h-16 rounded-2xl bg-gunmetal-200 dark:bg-zinc-900 flex items-center justify-center mb-6 border border-gunmetal-300 dark:border-zinc-800">
          <MonitorIcon className="w-8 h-8 text-zinc-400 dark:text-zinc-600" />
        </div>
        <h3 className="text-lg font-medium text-gunmetal-800 dark:text-zinc-200 mb-2">
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
            className="flex-1 bg-gunmetal-200 dark:bg-zinc-900 border border-gunmetal-300 dark:border-zinc-800 rounded-md px-3 py-2 text-sm text-gunmetal-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-steel/50"
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

  const vp = VIEWPORT_DEFAULTS[viewport];
  const iframeWidth = viewport === 'desktop' ? '100%' : `${size.w}px`;
  const iframeHeight = size.h ? `${size.h}px` : '100%';

  return (
    <div className="flex-1 h-full flex flex-col bg-gunmetal-100 dark:bg-zinc-950">
      <div className="h-10 bg-gunmetal-200 dark:bg-zinc-900 border-b border-gunmetal-300 dark:border-zinc-800 flex items-center px-4 space-x-4">
        <div className="flex space-x-1.5">
          <div className="w-3 h-3 rounded-full bg-crimson/20 border border-crimson/50" />
          <div className="w-3 h-3 rounded-full bg-gold/20 border border-gold/50" />
          <div className="w-3 h-3 rounded-full bg-patina/20 border border-patina/50" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-gunmetal-50 dark:bg-zinc-950 border border-gunmetal-300 dark:border-zinc-800 rounded px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400 flex items-center space-x-2 min-w-[300px]">
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
            { size: 'desktop' as ViewportSize, icon: MonitorIcon, label: 'Desktop' },
            { size: 'tablet' as ViewportSize, icon: TabletSmartphoneIcon, label: 'Tablet' },
            { size: 'mobile' as ViewportSize, icon: SmartphoneIcon, label: 'Mobile / Responsive' },
          ]).map(({ size: s, icon: Icon, label }) => (
            <button
              key={s}
              onClick={() => setViewport(s)}
              title={label}
              className={`p-1.5 rounded transition-colors ${
                viewport === s
                  ? 'bg-gunmetal-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                  : 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* Preview container with dot grid background */}
      <div
        ref={containerRef}
        className="flex-1 flex items-start justify-center overflow-auto p-6"
        style={{
          backgroundColor: 'var(--surface-base)',
          backgroundImage: 'radial-gradient(circle, var(--live-dot-color) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        {viewport === 'desktop' ? (
          <iframe
            src={project.serverUrl}
            className="w-full h-full border-0"
          />
        ) : (
          <div className="relative inline-flex flex-col" style={{ maxWidth: '100%' }}>
            {/* Bezel wrapper */}
            <div
              className="rounded-xl overflow-hidden shadow-lg"
              style={{
                border: '8px solid #2a2a2e',
                boxShadow: '0 0 0 1px #3f3f46, 0 8px 32px rgba(0,0,0,0.4)',
                width: iframeWidth,
                height: iframeHeight,
                maxWidth: '100%',
                transition: 'width 0.15s ease, height 0.15s ease',
              }}
            >
              <iframe
                src={project.serverUrl}
                className="w-full h-full border-0"
              />
            </div>

            {/* Right resize handle (X axis) */}
            {vp.resizeX && (
              <div
                onMouseDown={(e) => handleResizeStart('x', e)}
                className="absolute top-0 -right-4 w-4 h-full cursor-ew-resize flex items-center justify-center group"
              >
                <div className="w-1 h-8 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
              </div>
            )}

            {/* Bottom resize handle (Y axis) */}
            {vp.resizeY && (
              <div
                onMouseDown={(e) => handleResizeStart('y', e)}
                className="absolute -bottom-4 left-0 w-full h-4 cursor-ns-resize flex items-center justify-center group"
              >
                <div className="h-1 w-8 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
              </div>
            )}

            {/* Corner resize handle (XY) */}
            {vp.resizeX && vp.resizeY && (
              <div
                onMouseDown={(e) => handleResizeStart('xy', e)}
                className="absolute -bottom-4 -right-4 w-4 h-4 cursor-nwse-resize flex items-center justify-center group"
              >
                <div className="w-2 h-2 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors" />
              </div>
            )}

            {/* Size label */}
            <div className="mt-3 text-center text-[10px] text-zinc-500 font-mono select-none">
              {size.w}{size.h ? ` × ${size.h}` : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
