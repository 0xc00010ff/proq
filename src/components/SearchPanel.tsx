'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, CaseSensitive, Regex, ChevronRight, ChevronDown, FileText } from 'lucide-react';

interface Match {
  line: number;
  text: string;
  column: number;
}

interface FileResult {
  file: string;
  matches: Match[];
}

interface SearchResult {
  results: FileResult[];
  totalMatches: number;
  truncated: boolean;
}

interface SearchPanelProps {
  projectPath: string;
  onOpenFile: (filePath: string, line: number) => void;
  onClose: () => void;
}

export function SearchPanel({ projectPath, onOpenFile, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const doSearch = useCallback(async (q: string, cs: boolean, re: boolean) => {
    if (q.length < 2) {
      setResult(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        path: projectPath,
        q,
        caseSensitive: String(cs),
        regex: String(re),
      });
      const res = await fetch(`/api/files/search?${params}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setResult(null);
      } else {
        setResult(data);
        setCollapsedFiles(new Set());
      }
    } catch {
      setError('Search failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Debounced search on query/option change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query, caseSensitive, useRegex);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, caseSensitive, useRegex, doSearch]);

  const toggleCollapse = useCallback((file: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  const fileCount = result?.results.length ?? 0;
  const totalMatches = result?.totalMatches ?? 0;

  // Highlight matching text in a line
  const highlightMatch = useMemo(() => {
    if (!query || query.length < 2) return (text: string) => <span>{text}</span>;
    return (text: string) => {
      if (useRegex) {
        try {
          const flags = caseSensitive ? 'g' : 'gi';
          const re = new RegExp(`(${query})`, flags);
          const parts = text.split(re);
          return (
            <>
              {parts.map((part, i) =>
                re.test(part) ? (
                  <span key={i} className="bg-amber-500/30 text-amber-200 rounded-sm">{part}</span>
                ) : (
                  <span key={i}>{part}</span>
                )
              )}
            </>
          );
        } catch {
          return <span>{text}</span>;
        }
      }
      // Fixed string highlight
      const searchIn = caseSensitive ? text : text.toLowerCase();
      const searchFor = caseSensitive ? query : query.toLowerCase();
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let idx = searchIn.indexOf(searchFor);
      let key = 0;
      while (idx !== -1) {
        if (idx > lastIndex) parts.push(<span key={key++}>{text.slice(lastIndex, idx)}</span>);
        parts.push(
          <span key={key++} className="bg-amber-500/30 text-amber-200 rounded-sm">
            {text.slice(idx, idx + query.length)}
          </span>
        );
        lastIndex = idx + query.length;
        idx = searchIn.indexOf(searchFor, lastIndex);
      }
      if (lastIndex < text.length) parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
      return <>{parts}</>;
    };
  }, [query, caseSensitive, useRegex]);

  return (
    <div className="h-full flex flex-col">
      {/* Search input */}
      <div className="p-2 border-b border-border-default shrink-0">
        <div className="flex items-center gap-1">
          <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] bg-surface-inset rounded-md border border-border-default focus-within:border-border-strong transition-colors">
            <Search className="w-3 h-3 text-text-tertiary/60 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onClose();
                }
              }}
              placeholder="Search in files"
              className="flex-1 bg-transparent text-[11px] text-text-primary placeholder:text-text-tertiary/50 outline-none min-w-0"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResult(null); inputRef.current?.focus(); }}
                className="p-0.5 text-text-tertiary hover:text-text-secondary rounded"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            className={`p-1.5 rounded transition-colors ${
              caseSensitive
                ? 'bg-lazuli/20 text-lazuli border border-lazuli/30'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover border border-transparent'
            }`}
            title="Match case"
          >
            <CaseSensitive className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setUseRegex((v) => !v)}
            className={`p-1.5 rounded transition-colors ${
              useRegex
                ? 'bg-lazuli/20 text-lazuli border border-lazuli/30'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover border border-transparent'
            }`}
            title="Use regex"
          >
            <Regex className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Results summary */}
      {result && (
        <div className="px-3 py-1.5 text-[10px] text-text-tertiary border-b border-border-default shrink-0">
          {totalMatches} result{totalMatches !== 1 ? 's' : ''} in {fileCount} file{fileCount !== 1 ? 's' : ''}
          {result.truncated && <span className="text-amber-400 ml-1">(results capped)</span>}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-[11px] text-red-400">{error}</div>
      )}

      {loading && !result && (
        <div className="px-3 py-3 text-[11px] text-text-tertiary text-center">Searching...</div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {result?.results.map((fileResult) => {
          const rel = fileResult.file.replace(projectPath + '/', '');
          const fileName = rel.split('/').pop() || rel;
          const isCollapsed = collapsedFiles.has(fileResult.file);

          return (
            <div key={fileResult.file}>
              {/* File header */}
              <button
                onClick={() => toggleCollapse(fileResult.file)}
                className="w-full flex items-center gap-1 px-2 py-1 text-left hover:bg-surface-hover/60 transition-colors group"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-text-tertiary/60 shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-text-tertiary/60 shrink-0" />
                )}
                <FileText className="w-3 h-3 text-text-tertiary/60 shrink-0" />
                <span className="text-[11px] text-text-primary font-medium truncate">{fileName}</span>
                <span className="text-[10px] text-text-tertiary/50 font-mono truncate ml-auto pl-2">
                  {rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''}
                </span>
                <span className="text-[10px] text-text-tertiary bg-surface-hover rounded px-1 ml-1 shrink-0">
                  {fileResult.matches.length}
                </span>
              </button>

              {/* Match rows */}
              {!isCollapsed && (
                <div>
                  {fileResult.matches.map((match, i) => (
                    <button
                      key={i}
                      onClick={() => onOpenFile(fileResult.file, match.line)}
                      className="w-full flex items-start gap-2 pl-7 pr-2 py-0.5 text-left hover:bg-surface-hover/40 transition-colors"
                    >
                      <span className="text-[10px] text-text-tertiary/50 font-mono w-7 text-right shrink-0 pt-px">
                        {match.line}
                      </span>
                      <span className="text-[11px] text-text-secondary font-mono truncate leading-relaxed">
                        {highlightMatch(match.text.trimStart())}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {result && result.results.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-text-tertiary text-center">No results found</div>
        )}
      </div>
    </div>
  );
}
