'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { Plus, X, TerminalIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface TerminalTab {
  id: string;
  label: string;
  type: 'default' | 'shell' | 'task';
  status?: 'running' | 'done';
}

export interface TerminalPanelHandle {
  openTab: (tabId: string, label: string) => void;
  closeTab: (tabId: string) => void;
  markTabDone: (tabId: string) => void;
}

interface TerminalPanelProps {
  style?: React.CSSProperties;
}

interface TerminalInstance {
  terminal: import('@xterm/xterm').Terminal;
  ws: WebSocket;
  fitAddon: import('@xterm/addon-fit').FitAddon;
}

const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel({ style }, ref) {
    const [tabs, setTabs] = useState<TerminalTab[]>([
      { id: 'default', label: '\u25C6 Claude', type: 'default' },
    ]);
    const [activeTabId, setActiveTabId] = useState('default');
    const instancesRef = useRef<Map<string, TerminalInstance>>(new Map());
    const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const panelRef = useRef<HTMLDivElement>(null);
    const xtermModulesRef = useRef<{
      Terminal: typeof import('@xterm/xterm').Terminal;
      FitAddon: typeof import('@xterm/addon-fit').FitAddon;
      WebLinksAddon: typeof import('@xterm/addon-web-links').WebLinksAddon;
    } | null>(null);

    // Dynamic import of xterm modules
    const loadXtermModules = useCallback(async () => {
      if (xtermModulesRef.current) return xtermModulesRef.current;

      const [xtermMod, fitMod, linksMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ]);

      xtermModulesRef.current = {
        Terminal: xtermMod.Terminal,
        FitAddon: fitMod.FitAddon,
        WebLinksAddon: linksMod.WebLinksAddon,
      };

      return xtermModulesRef.current;
    }, []);

    const createTerminalInstance = useCallback(
      async (tabId: string, container: HTMLDivElement) => {
        if (instancesRef.current.has(tabId)) return;

        const modules = await loadXtermModules();
        const { Terminal, FitAddon, WebLinksAddon } = modules;

        const terminal = new Terminal({
          theme: {
            background: '#000000',
            foreground: '#a1a1aa',
            cursor: '#a1a1aa',
            selectionBackground: '#3f3f46',
          },
          fontFamily: 'Geist Mono, monospace',
          fontSize: 13,
          cursorBlink: true,
          convertEol: true,
          allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon());

        terminal.open(container);

        // Initial fit
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
          } catch {}
        });

        // Connect WebSocket
        const ws = new WebSocket(
          `ws://${window.location.hostname}:42069/ws/terminal?id=${encodeURIComponent(tabId)}`
        );

        ws.onopen = () => {
          // Send initial size
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        };

        ws.onmessage = (event) => {
          const data = event.data;
          // Check for exit message
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'exit') {
              terminal.writeln(`\r\n\x1b[90m[Process exited with code ${parsed.code}]\x1b[0m`);
              return;
            }
          } catch {
            // Not JSON — raw terminal data
          }
          terminal.write(data);
        };

        ws.onclose = () => {
          terminal.writeln('\r\n\x1b[90m[Disconnected]\x1b[0m');
        };

        // Forward terminal input to WS
        terminal.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        instancesRef.current.set(tabId, { terminal, ws, fitAddon });
      },
      [loadXtermModules]
    );

    // Initialize terminal for a tab when its container mounts
    const setContainerRef = useCallback(
      (tabId: string) => (el: HTMLDivElement | null) => {
        if (el && !containersRef.current.has(tabId)) {
          containersRef.current.set(tabId, el);
          createTerminalInstance(tabId, el);
        }
      },
      [createTerminalInstance]
    );

    // Fit terminal on tab switch and resize
    useEffect(() => {
      const instance = instancesRef.current.get(activeTabId);
      if (instance) {
        requestAnimationFrame(() => {
          try {
            instance.fitAddon.fit();
            if (instance.ws.readyState === WebSocket.OPEN) {
              const dims = instance.fitAddon.proposeDimensions();
              if (dims) {
                instance.ws.send(
                  JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows })
                );
              }
            }
          } catch {}
        });
      }
    }, [activeTabId]);

    // ResizeObserver on the panel
    useEffect(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const observer = new ResizeObserver(() => {
        const instance = instancesRef.current.get(activeTabId);
        if (instance) {
          try {
            instance.fitAddon.fit();
            if (instance.ws.readyState === WebSocket.OPEN) {
              const dims = instance.fitAddon.proposeDimensions();
              if (dims) {
                instance.ws.send(
                  JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows })
                );
              }
            }
          } catch {}
        }
      });

      observer.observe(panel);
      return () => observer.disconnect();
    }, [activeTabId]);

    // Load xterm CSS
    useEffect(() => {
      const linkId = 'xterm-css';
      if (!document.getElementById(linkId)) {
        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = '/xterm.css';
        document.head.appendChild(link);
      }
    }, []);

    const addShellTab = useCallback(async () => {
      const id = `shell-${uuidv4().slice(0, 8)}`;
      const shellCount = tabs.filter((t) => t.type === 'shell').length + 1;
      const newTab: TerminalTab = {
        id,
        label: `Terminal ${shellCount}`,
        type: 'shell',
      };

      // Spawn PTY via API
      await fetch('/api/terminal/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: id }),
      });

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(id);
    }, [tabs]);

    const removeTab = useCallback(async (tabId: string) => {
      if (tabId === 'default') return;

      // Kill PTY
      await fetch(`/api/terminal/${tabId}`, { method: 'DELETE' });

      // Cleanup instance
      const instance = instancesRef.current.get(tabId);
      if (instance) {
        instance.ws.close();
        instance.terminal.dispose();
        instancesRef.current.delete(tabId);
      }
      containersRef.current.delete(tabId);

      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tabId);
        return filtered;
      });
      setActiveTabId((prev) => (prev === tabId ? 'default' : prev));
    }, []);

    // Expose methods to parent
    useImperativeHandle(
      ref,
      () => ({
        openTab(tabId: string, label: string) {
          setTabs((prev) => {
            if (prev.find((t) => t.id === tabId)) {
              // Already exists, just switch to it
              return prev;
            }
            return [...prev, { id: tabId, label, type: 'task' as const, status: 'running' as const }];
          });
          setActiveTabId(tabId);
        },
        closeTab(tabId: string) {
          removeTab(tabId);
        },
        markTabDone(tabId: string) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, status: 'done' as const } : t
            )
          );
        },
      }),
      [removeTab]
    );

    const tabAccentColor = (tab: TerminalTab) => {
      if (tab.type === 'default') return 'text-blue-400';
      if (tab.type === 'shell') return 'text-green-400';
      return 'text-blue-400';
    };

    return (
      <div
        ref={panelRef}
        className="w-full flex flex-col bg-black/40 flex-shrink-0 font-mono"
        style={{ minHeight: 0, ...style }}
      >
        {/* Tab Bar */}
        <div className="h-10 flex items-center border-b border-zinc-800/60 bg-zinc-900/20 px-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center gap-1.5 px-3 h-8 text-xs rounded-md transition-colors shrink-0 ${
                activeTabId === tab.id
                  ? 'bg-zinc-800/60 ' + tabAccentColor(tab)
                  : 'text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800/30'
              }`}
            >
              <TerminalIcon className="w-3 h-3" />
              <span className="max-w-[120px] truncate">
                {tab.status === 'done' ? '\u2705 ' : ''}
                {tab.label}
              </span>
              {tab.type !== 'default' && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(tab.id);
                  }}
                  className="ml-1 text-zinc-600 hover:text-zinc-300 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </span>
              )}
            </button>
          ))}

          <button
            onClick={addShellTab}
            className="flex items-center justify-center w-7 h-7 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/30 rounded-md ml-1 shrink-0"
            title="New terminal"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Terminal Containers */}
        <div className="flex-1 relative" style={{ minHeight: 0 }}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              ref={setContainerRef(tab.id)}
              className="absolute inset-0"
              style={{
                display: activeTabId === tab.id ? 'block' : 'none',
                padding: '4px 0 0 4px',
              }}
            />
          ))}
        </div>
      </div>
    );
  }
);

export default TerminalPanel;
