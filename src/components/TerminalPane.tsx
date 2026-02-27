'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

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
  visible: boolean,
  cwd?: string,
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
      const wsPort = process.env.NEXT_PUBLIC_WS_PORT || "42069";
      let wsUrl = `ws://${window.location.hostname}:${wsPort}/ws/terminal?id=${encodeURIComponent(tabId)}`;
      if (cwd) wsUrl += `&cwd=${encodeURIComponent(cwd)}`;
      const ws = new WebSocket(wsUrl);

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

      // Intercept Shift+Enter to send CSI u sequence (kitty keyboard protocol)
      // xterm.js onData sends \r for both Enter and Shift+Enter by default
      terminal.attachCustomKeyEventHandler((ev) => {
        if (ev.type === 'keydown' && ev.key === 'Enter' && ev.shiftKey) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('\x1b[13;2u'); // CSI 13 ; 2 u = Shift+Enter
          }
          return false; // prevent default handling
        }
        return true;
      });

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

  /** Send raw data to the terminal's PTY (as if typed) */
  const sendData = useCallback((data: string) => {
    const inst = instanceRef.current;
    if (inst && inst.ws.readyState === WebSocket.OPEN) {
      inst.ws.send(data);
    }
  }, []);

  return { sendData };
}

/* -------------------------------------------------------------------------- */
/*  Individual terminal pane (one per tab, mounts its own xterm)               */
/* -------------------------------------------------------------------------- */

export function TerminalPane({
  tabId,
  visible,
  enableDrop,
  cwd,
}: {
  tabId: string;
  visible: boolean;
  enableDrop?: boolean;
  cwd?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { sendData } = useTerminal(tabId, containerRef, visible, cwd);
  const [dropping, setDropping] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!enableDrop) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  }, [enableDrop]);

  const handleDragLeave = useCallback(() => {
    setDropping(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    if (!enableDrop) return;
    e.preventDefault();
    setDropping(false);

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length === 0) return;

    for (const file of files) {
      const form = new FormData();
      form.append('file', file);

      try {
        const res = await fetch('/api/terminal/upload', {
          method: 'POST',
          body: form,
        });
        const { path } = await res.json();
        if (path) {
          sendData(path + ' ');
        }
      } catch (err) {
        console.error('[TerminalPane] image upload failed:', err);
      }
    }
  }, [enableDrop, sendData]);

  return (
    <div
      className="absolute inset-0"
      style={{
        display: visible ? 'block' : 'none',
      }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ padding: '4px 0 0 4px' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      {dropping && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-steel/10 border-2 border-dashed border-steel/40 rounded-md pointer-events-none">
          <span className="text-sm text-steel font-medium">
            Drop image to paste path
          </span>
        </div>
      )}
    </div>
  );
}
