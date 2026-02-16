'use client';

import React, { useEffect, useRef } from 'react';

interface TerminalInstance {
  terminal: import('@xterm/xterm').Terminal;
  ws: WebSocket;
  fitAddon: import('@xterm/addon-fit').FitAddon;
}

/* -------------------------------------------------------------------------- */
/*  Single-terminal mounting hook                                              */
/* -------------------------------------------------------------------------- */

export function useTerminal(
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

export function TerminalPane({ tabId, visible }: { tabId: string; visible: boolean }) {
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
