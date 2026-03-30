'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GlobeIcon, MonitorIcon, TabletSmartphoneIcon, SmartphoneIcon, RotateCwIcon, TerminalIcon, SquareChevronUpIcon, XIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from 'lucide-react';
import type { Project } from '@/lib/types';
import { useProjects } from '@/components/ProjectsProvider';

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

const PRESETS: Record<Exclude<ViewportSize, 'desktop'>, { w: number; h: number }> = {
  tablet: { w: 768, h: 1024 },
  mobile: { w: 375, h: 812 },
};

interface LiveTabProps {
  project: Project;
  onActivateWorkbenchTab: (type: 'agent' | 'shell') => void;
}

// Electron exposes window.proqDesktop via preload — when present, we can use <webview>.
const isElectron = typeof window !== 'undefined' && 'proqDesktop' in window;

// Electron's webview element provides navigation methods + events beyond standard HTMLElement.
interface WebviewElement {
  getURL(): string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): void;
  addEventListener(type: string, listener: (event: { url: string; isMainFrame?: boolean }) => void): void;
  removeEventListener(type: string, listener: (event: { url: string; isMainFrame?: boolean }) => void): void;
}

export function LiveTab({ project, onActivateWorkbenchTab }: LiveTabProps) {
  const [urlInput, setUrlInput] = useState(project.serverUrl || 'http://localhost:3000');
  // Use persisted liveUrl if it belongs to the current server, otherwise fall back to serverUrl
  const initialUrl = (() => {
    if (project.liveUrl && project.serverUrl) {
      try {
        const live = new URL(project.liveUrl);
        const server = new URL(project.serverUrl);
        if (live.origin === server.origin) return project.liveUrl;
      } catch {}
    }
    return project.serverUrl ?? '';
  })();
  const [barValue, setBarValue] = useState(initialUrl);
  const [loadUrl, setLoadUrl] = useState(initialUrl);
  const initialVp = project.liveViewport ?? 'desktop';
  const [viewport, setViewport] = useState<ViewportSize>(initialVp);
  const [size, setSize] = useState(initialVp !== 'desktop' ? PRESETS[initialVp] : { w: 768, h: 1024 });
  const [iframeKey, setIframeKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const { refreshProjects } = useProjects();
  const prevServerUrl = useRef(project.serverUrl);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced persist of the current live URL
  const persistLiveUrl = useCallback((url: string) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liveUrl: url }),
      });
    }, 500);
  }, [project.id]);

  // Auto-connect when serverUrl changes (e.g. agent sets it via API)
  useEffect(() => {
    if (project.serverUrl && project.serverUrl !== prevServerUrl.current) {
      setUrlInput(project.serverUrl);
      setBarValue(project.serverUrl);
      setLoadUrl(project.serverUrl);
      setIframeKey(k => k + 1);
    } else if (!project.serverUrl && prevServerUrl.current) {
      setUrlInput('http://localhost:3000');
    }
    prevServerUrl.current = project.serverUrl;
  }, [project.serverUrl]);

  // Clean up persist timer on unmount
  useEffect(() => () => { if (persistTimer.current) clearTimeout(persistTimer.current); }, []);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const webviewRef = useRef<WebviewElement>(null);

  // Electron webview: set allowpopups attribute and listen for navigation events.
  useEffect(() => {
    if (!isElectron || !project.serverUrl) return;
    const wv = webviewRef.current;
    if (!wv) return;
    // Set as a string attribute to avoid React's boolean-to-DOM warning
    (wv as unknown as HTMLElement).setAttribute('allowpopups', 'true');
    const onNav = (e: { url: string }) => { setBarValue(e.url); persistLiveUrl(e.url); };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    return () => {
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
    };
  }, [project.serverUrl, iframeKey, persistLiveUrl]);

  const handleRefresh = () => {
    if (isElectron && webviewRef.current) {
      webviewRef.current.reload();
    } else {
      setIframeKey(k => k + 1);
    }
  };

  const handleBack = () => {
    if (isElectron && webviewRef.current) {
      webviewRef.current.goBack();
    } else {
      try { iframeRef.current?.contentWindow?.history.back(); } catch {}
    }
  };

  const handleForward = () => {
    if (isElectron && webviewRef.current) {
      webviewRef.current.goForward();
    } else {
      try { iframeRef.current?.contentWindow?.history.forward(); } catch {}
    }
  };

  const handleOpenInBrowser = () => {
    if (barValue) window.open(barValue, '_blank');
  };

  const navigateTo = (url: string) => {
    setBarValue(url);
    persistLiveUrl(url);
    if (isElectron && webviewRef.current) {
      webviewRef.current.loadURL(url);
    } else if (iframeRef.current) {
      iframeRef.current.src = url;
    }
  };

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
      document.querySelectorAll('iframe, webview').forEach(f => (f as HTMLElement).style.pointerEvents = '');
    };

    document.querySelectorAll('iframe, webview').forEach(f => (f as HTMLElement).style.pointerEvents = 'none');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [size.w, size.h]);

  const activateTab = useCallback((type: 'agent' | 'shell') => {
    onActivateWorkbenchTab(type);
  }, [onActivateWorkbenchTab]);

  const isDevice = viewport !== 'desktop';

  const embedElement = isElectron ? (
    <webview
      ref={webviewRef as React.Ref<HTMLElement>}
      key={iframeKey}
      src={loadUrl || project.serverUrl}
      className={isDevice ? 'w-full h-full border-0' : 'flex-1 w-full border-0'}
      style={{ display: 'inline-flex' }}
    />
  ) : (
    <iframe
      ref={iframeRef}
      key={iframeKey}
      src={loadUrl || project.serverUrl}
      className={isDevice ? 'w-full h-full border-0' : 'flex-1 w-full border-0'}
    />
  );

  return (
      <div
        className="h-full overflow-hidden flex flex-col bg-surface-deep"
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
              <div className="flex space-x-1.5 group/lights">
                <button
                  onClick={handleDisconnect}
                  title="Disconnect"
                  className="w-3 h-3 rounded-full bg-crimson/20 border border-crimson/50 group-hover/lights:bg-crimson/60 flex items-center justify-center transition-colors"
                >
                  <XIcon className="w-1.5 h-1.5 text-transparent group-hover/lights:text-white transition-colors" />
                </button>
                <div className="w-3 h-3 rounded-full bg-gold/20 border border-gold/50 group-hover/lights:bg-gold/60 flex items-center justify-center transition-colors">
                  <div className="w-1 h-1 rounded-full bg-transparent group-hover/lights:bg-gold transition-colors" />
                </div>
                <div className="w-3 h-3 rounded-full bg-emerald/20 border border-emerald/50 group-hover/lights:bg-emerald/60 flex items-center justify-center transition-colors">
                  <div className="w-1 h-1 rounded-full bg-transparent group-hover/lights:bg-emerald transition-colors" />
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center space-x-2">
                <button
                  onClick={handleBack}
                  title="Back"
                  className="p-1.5 rounded text-text-placeholder hover:text-text-secondary hover:bg-surface-hover"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleForward}
                  title="Forward"
                  className="p-1.5 rounded text-text-placeholder hover:text-text-secondary hover:bg-surface-hover"
                >
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
                <div className="bg-surface-deep border border-border-default rounded px-3 py-1 text-xs text-text-secondary flex items-center space-x-2 min-w-[300px]">
                  <GlobeIcon className="w-3 h-3 shrink-0" />
                  <input
                    type="text"
                    value={barValue}
                    onChange={(e) => setBarValue(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        const raw = barValue.trim();
                        if (!raw) return;
                        if (!raw.startsWith('http')) {
                          // Bare path — navigate within the current server
                          try {
                            const base = new URL(project.serverUrl!);
                            navigateTo(base.origin + (raw.startsWith('/') ? raw : '/' + raw));
                          } catch {}
                          return;
                        }
                        try {
                          const entered = new URL(raw);
                          const current = new URL(project.serverUrl!);
                          if (entered.origin === current.origin) {
                            navigateTo(raw);
                          } else {
                            await fetch(`/api/projects/${project.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ serverUrl: raw }),
                            });
                            await refreshProjects();
                          }
                        } catch {}
                      }
                    }}
                    className="flex-1 bg-transparent text-xs text-text-secondary focus:text-text-primary outline-none"
                  />
                  <button
                    onClick={handleRefresh}
                    title="Refresh"
                    className="p-0.5 rounded text-text-placeholder hover:text-text-secondary shrink-0"
                  >
                    <RotateCwIcon className="w-3 h-3" />
                  </button>
                </div>
                <button
                  onClick={handleOpenInBrowser}
                  title="Open in browser"
                  className="p-1.5 rounded text-text-placeholder hover:text-text-secondary hover:bg-surface-hover"
                >
                  <ExternalLinkIcon className="w-3.5 h-3.5" />
                </button>
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
                    {embedElement}
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
              embedElement
            )}
          </>
        )}
      </div>
  );
}
