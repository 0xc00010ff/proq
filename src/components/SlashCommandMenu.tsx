'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SkillInfo } from '@/lib/types';

interface SlashCommandMenuProps {
  skills: SkillInfo[];
  query: string;
  position: { top: number; left: number };
  onSelect: (skillName: string) => void;
  onClose: () => void;
}

export function SlashCommandMenu({ skills, query, position, onSelect, onClose }: SlashCommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const filtered = skills.filter((s) =>
    s.name.toLowerCase().startsWith(query.toLowerCase())
  );

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Stable keydown handler via refs
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const f = filteredRef.current;
    if (f.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((i) => (i + 1) % f.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((i) => (i - 1 + f.length) % f.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onSelectRef.current(f[selectedRef.current].name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // Close if no matches
  if (filtered.length === 0) return null;

  return (
    <div
      className="absolute z-50 bg-surface-modal border border-border-default rounded-md shadow-lg py-1 min-w-[180px] max-h-[200px] overflow-y-auto"
      style={{ top: position.top, left: position.left }}
    >
      <div className="px-3 py-1 text-[10px] font-semibold text-text-placeholder tracking-wider uppercase">Skills</div>
      {filtered.map((skill, i) => (
        <button
          key={skill.name}
          ref={(el) => { itemRefs.current[i] = el; }}
          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 cursor-pointer ${
            i === selectedIndex
              ? 'bg-surface-hover text-text-primary'
              : 'text-text-secondary hover:bg-surface-hover/50'
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(skill.name);
          }}
        >
          <span className="text-text-placeholder">/</span>
          <span>{skill.name}</span>
        </button>
      ))}
    </div>
  );
}
