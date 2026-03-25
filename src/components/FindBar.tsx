'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { XIcon, ChevronUpIcon, ChevronDownIcon } from 'lucide-react';
import { isElectron } from '@/lib/utils';

export function FindBar() {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const close = useCallback(() => {
    setVisible(false);
    setQuery('');
    setActiveMatch(0);
    setTotalMatches(0);
    window.proqDesktop?.stopFind();
  }, []);

  // Listen for find:show from Electron main process
  useEffect(() => {
    if (!isElectron || !window.proqDesktop?.onFindShow) return;
    return window.proqDesktop.onFindShow(() => {
      setVisible(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    });
  }, []);

  // Listen for find:result from Electron main process
  useEffect(() => {
    if (!isElectron || !window.proqDesktop?.onFindResult) return;
    return window.proqDesktop.onFindResult((result) => {
      setActiveMatch(result.activeMatchOrdinal);
      setTotalMatches(result.matches);
    });
  }, []);

  // Trigger search when query changes
  useEffect(() => {
    if (!visible || !query) {
      setActiveMatch(0);
      setTotalMatches(0);
      if (!query) window.proqDesktop?.stopFind();
      return;
    }
    window.proqDesktop?.findInPage(query);
  }, [query, visible]);

  const findNext = useCallback(() => {
    if (queryRef.current) {
      window.proqDesktop?.findInPage(queryRef.current, { forward: true, findNext: true });
    }
  }, []);

  const findPrev = useCallback(() => {
    if (queryRef.current) {
      window.proqDesktop?.findInPage(queryRef.current, { forward: false, findNext: true });
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrev();
      else findNext();
    }
  }, [close, findNext, findPrev]);

  if (!isElectron || !visible) return null;

  return (
    <div className="fixed top-2 right-4 z-[9999] flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        className="w-48 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-blue-500"
        autoFocus
      />
      <span className="text-xs text-zinc-400 whitespace-nowrap min-w-[60px] text-center">
        {query ? (totalMatches > 0 ? `${activeMatch} of ${totalMatches}` : 'No results') : ''}
      </span>
      <button
        onClick={findPrev}
        className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUpIcon size={14} />
      </button>
      <button
        onClick={findNext}
        className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700"
        title="Next match (Enter)"
      >
        <ChevronDownIcon size={14} />
      </button>
      <button
        onClick={close}
        className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700"
        title="Close (Escape)"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
