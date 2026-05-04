'use client';

import React from 'react';
import {
  Columns3Icon,
  GlobeIcon,
  CodeIcon,
  TerminalIcon,
  Users2Icon,
  CheckIcon,
  ChevronDownIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { PanelKind } from '@/lib/types';

export const PANEL_TYPES: { kind: PanelKind; label: string; icon: LucideIcon }[] = [
  { kind: 'agent-editor',     label: 'Agents',    icon: Users2Icon },
  { kind: 'agents-workbench', label: 'Workbench', icon: TerminalIcon },
  { kind: 'kanban',           label: 'Tasks',     icon: Columns3Icon },
  { kind: 'code',             label: 'Code',      icon: CodeIcon },
  { kind: 'live',             label: 'Live',      icon: GlobeIcon },
];

export function panelKindMeta(kind: PanelKind) {
  return PANEL_TYPES.find((t) => t.kind === kind) ?? PANEL_TYPES[0];
}

interface PanelTypeSwitcherProps {
  current: PanelKind;
  onChange: (kind: PanelKind) => void;
}

/**
 * Leftmost item in a panel's sub-nav: shows the icon for the current view kind
 * with a chevron, and pops a menu of the five available view types on click.
 */
export function PanelTypeSwitcher({ current, onChange }: PanelTypeSwitcherProps) {
  const meta = panelKindMeta(current);
  const Icon = meta.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 px-2 self-stretch text-text-tertiary hover:text-text-secondary hover:bg-surface-hover/30 shrink-0"
          title={`${meta.label} — switch panel type`}
        >
          <Icon className="w-3.5 h-3.5" />
          <ChevronDownIcon className="w-3 h-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-44">
        {PANEL_TYPES.map(({ kind, label, icon: ItemIcon }) => (
          <DropdownMenuItem
            key={kind}
            onSelect={() => onChange(kind)}
            className="text-xs gap-2"
          >
            <ItemIcon className="w-3.5 h-3.5" />
            <span>{label}</span>
            {current === kind && <CheckIcon className="w-3 h-3 ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
