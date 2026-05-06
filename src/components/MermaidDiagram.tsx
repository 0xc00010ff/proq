'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

let mermaidLoader: Promise<typeof import('mermaid').default> | null = null;
let lastInitTheme: 'dark' | 'default' | null = null;

async function getMermaid(theme: 'dark' | 'default') {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((m) => m.default);
  }
  const mermaid = await mermaidLoader;
  if (lastInitTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
      fontFamily: 'inherit',
    });
    lastInitTheme = theme;
  }
  return mermaid;
}

function detectTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'default';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

export function extractMermaid(children: React.ReactNode): string | null {
  let result: string | null = null;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const cn = (child.props as { className?: string }).className;
    if (!cn || !/\blanguage-mermaid\b/.test(cn)) return;
    const inner = (child.props as { children?: React.ReactNode }).children;
    const text =
      typeof inner === 'string'
        ? inner
        : Array.isArray(inner)
          ? inner.map((c) => (typeof c === 'string' ? c : '')).join('')
          : String(inner ?? '');
    result = text.replace(/\n$/, '');
  });
  return result;
}

export function MermaidDiagram({ code }: { code: string }) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'default'>(detectTheme);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const check = () => setTheme(detectTheme());
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!code.trim()) {
      setSvg(null);
      setError(null);
      return;
    }
    const myToken = ++tokenRef.current;
    const timer = setTimeout(async () => {
      try {
        const mermaid = await getMermaid(theme);
        await mermaid.parse(code);
        if (myToken !== tokenRef.current) return;
        const renderId = `mermaid-${id}-${myToken}`;
        const result = await mermaid.render(renderId, code);
        if (myToken !== tokenRef.current) return;
        setSvg(result.svg);
        setError(null);
      } catch (e) {
        if (myToken !== tokenRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [code, theme, id]);

  if (svg) {
    return (
      <div className="my-2 overflow-x-auto bg-surface-base rounded-md p-3 [&_svg]:!max-w-full [&_svg]:w-full [&_svg]:h-auto">
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    );
  }

  return (
    <div className="my-2">
      <pre className="bg-surface-deep rounded-md overflow-x-auto p-3">
        <code className="block text-[12px] font-mono text-text-secondary whitespace-pre">{code}</code>
      </pre>
      {error && (
        <div className="text-[11px] text-text-placeholder mt-1 px-1">
          Mermaid: {error.split('\n')[0]}
        </div>
      )}
    </div>
  );
}
