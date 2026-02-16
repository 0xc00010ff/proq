'use client';

import React, {
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { Plus, X, TerminalIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useTerminalTabs, type TerminalTab } from './TerminalTabsProvider';

interface TerminalPanelProps {
  projectId: string;
  style?: React.CSSProperties;
}

interface TerminalInstance {
  terminal: import('@xterm/xterm').Terminal;
  ws: WebSocket;
  fitAddon: import('@xterm/addon-fit').FitAddon;
}

/* -------------------------------------------------------------------------- */
/*  Single-terminal mounting hook                                              */
/* -------------------------------------------------------------------------- */

function useTerminal(
  tabId: string,
  containerRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean
) {
  const instanceRef = useRef<TerminalInstance | null>(null);

  // Mount / unmount the terminal instance
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let instance: TerminalInstance | null = null;

    (async () => {
      const [xtermMod, fitMod, linksMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ]);

      if (cancelled) return;

      const terminal = new xtermMod.Terminal({
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

      const fitAddon = new fitMod.FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new linksMod.WebLinksAddon());
      terminal.open(container);

      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}
      });

      // Connect WS — server auto-spawns the PTY if needed and replays scrollback
      const ws = new WebSocket(
        `ws://${window.location.hostname}:42069/ws/terminal?id=${encodeURIComponent(tabId)}`
      );

      ws.onopen = () => {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'exit') {
            terminal.writeln(`\r\n\x1b[90m[Process exited with code ${parsed.code}]\x1b[0m`);
            return;
          }
        } catch {
          // Not JSON — raw terminal data
        }
        terminal.write(event.data);
      };

      ws.onclose = () => {
        terminal.writeln('\r\n\x1b[90m[Disconnected]\x1b[0m');
      };

      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      instance = { terminal, ws, fitAddon };
      instanceRef.current = instance;
    })();

    return () => {
      cancelled = true;
      if (instance) {
        try { instance.ws.close(); } catch {}
        try { instance.terminal.dispose(); } catch {}
      }
      instanceRef.current = null;
    };
    // Only re-run if tabId changes (container ref is stable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Fit on visibility change + resize observer
  useEffect(() => {
    const inst = instanceRef.current;
    if (!visible || !inst) return;

    const fit = () => {
      try {
        inst.fitAddon.fit();
        if (inst.ws.readyState === WebSocket.OPEN) {
          const dims = inst.fitAddon.proposeDimensions();
          if (dims) {
            inst.ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        }
      } catch {}
    };

    requestAnimationFrame(fit);

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [visible, containerRef, tabId]);
}

/* -------------------------------------------------------------------------- */
/*  Individual terminal pane (one per tab, mounts its own xterm)               */
/* -------------------------------------------------------------------------- */

function TerminalPane({ tabId, visible }: { tabId: string; visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(tabId, containerRef, visible);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        display: visible ? 'block' : 'none',
        padding: '4px 0 0 4px',
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel component                                                            */
/* -------------------------------------------------------------------------- */

export default function TerminalPanel({ projectId, style }: TerminalPanelProps) {
  const { getTabs, getActiveTabId, setActiveTabId, openTab, closeTab } = useTerminalTabs();
  const panelRef = useRef<HTMLDivElement>(null);

  const tabs = getTabs(projectId);
  const activeTabId = getActiveTabId(projectId);

  // Load xterm CSS once
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

    await fetch('/api/terminal/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId: id }),
    });

    openTab(projectId, id, `Terminal ${shellCount}`, 'shell');
  }, [tabs, openTab, projectId]);

  const removeTab = useCallback(
    (tabId: string) => {
      closeTab(projectId, tabId);
    },
    [closeTab, projectId]
  );

  const tabAccentColor = (tab: TerminalTab) =>
    tab.type === 'task' ? 'text-blue-400' : 'text-green-400';

  return (
    <div
      ref={panelRef}
      className="w-full flex flex-col bg-zinc-100 dark:bg-black/40 flex-shrink-0 font-mono"
      style={{ minHeight: 0, ...style }}
    >
      {/* Tab Bar */}
      <div className="h-10 flex items-center border-b border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-200/20 dark:bg-zinc-900/20 px-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(projectId, tab.id)}
            className={`flex items-center gap-1.5 px-3 h-8 text-xs rounded-md transition-colors shrink-0 ${
              activeTabId === tab.id
                ? 'bg-zinc-200/60 dark:bg-zinc-800/60 ' + tabAccentColor(tab)
                : 'text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-zinc-200/30 dark:hover:bg-zinc-800/30'
            }`}
          >
            <TerminalIcon className="w-3 h-3" />
            <span className="max-w-[120px] truncate">
              {tab.status === 'done' ? '\u2705 ' : ''}
              {tab.label}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
              className="ml-1 text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        ))}

        <button
          onClick={addShellTab}
          className="flex items-center justify-center w-7 h-7 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 hover:bg-zinc-200/30 dark:hover:bg-zinc-800/30 rounded-md ml-1 shrink-0"
          title="New terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal Panes — each manages its own xterm lifecycle */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        {tabs.map((tab) => (
          <TerminalPane key={tab.id} tabId={tab.id} visible={activeTabId === tab.id} />
        ))}
      </div>
    </div>
  );
}
