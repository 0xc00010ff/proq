'use client';

import React from 'react';
import { FolderOpenIcon, GitBranchIcon, PlusIcon } from 'lucide-react';

interface OnboardingCardsProps {
  onAddProject: () => void;
  onFocusChat: () => void;
  onSendMessage: (text: string) => void;
}

const quickStartCards = [
  {
    icon: FolderOpenIcon,
    title: 'Add a project',
    description: 'Point proq at an existing codebase',
    action: 'addProject' as const,
  },
  {
    icon: PlusIcon,
    title: 'Create a project',
    description: 'Scaffold a new project from scratch',
    action: 'send' as const,
    message: 'Help me scaffold and create a brand new project from scratch.',
  },
  {
    icon: GitBranchIcon,
    title: 'Import from GitHub',
    description: 'Clone a repo and set it up',
    action: 'send' as const,
    message: 'Help me clone a GitHub repo and set it up as a proq project.',
  },
];

export function OnboardingCards({ onAddProject, onFocusChat, onSendMessage }: OnboardingCardsProps) {
  const handleCardClick = (card: typeof quickStartCards[number]) => {
    if (card.action === 'addProject') {
      onAddProject();
    } else {
      onSendMessage(card.message!);
      onFocusChat();
    }
  };

  const handleLearnMore = () => {
    onSendMessage('What is proq and how does it work? Explain how it uses AI agents to build, test, and ship code.');
    onFocusChat();
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      {/* Top section — Welcome */}
      <div className="flex flex-col items-center text-center gap-3 mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/proq-logo-vector.svg"
          alt="proq"
          width={20}
          height={20}
          className="opacity-60"
        />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-text-primary">Welcome to proq</h2>
          <p className="text-sm text-text-tertiary">Let&apos;s build something great.</p>
        </div>
        <p className="text-xs text-text-quaternary max-w-sm leading-relaxed">
          proq is an agentic coding workspace. Create tasks, assign them to AI agents, and ship code — all from one place.
        </p>
        <button
          onClick={handleLearnMore}
          className="mt-1 text-xs font-medium px-3 py-1.5 rounded-md border border-amber-700/40 text-amber-500/80 hover:border-amber-600/60 hover:text-amber-400 transition-colors"
        >
          Learn more about proq →
        </button>
      </div>

      {/* Divider */}
      <div className="w-full max-w-lg border-t border-border-default mb-6" />

      {/* Bottom section — Quick start */}
      <div className="w-full max-w-lg space-y-3">
        <span className="text-xs font-medium text-text-quaternary uppercase tracking-wider">Quick start</span>
        <div className="grid grid-cols-3 gap-3">
          {quickStartCards.map((card) => (
            <button
              key={card.title}
              onClick={() => handleCardClick(card)}
              className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border-default bg-surface-topbar hover:border-border-strong hover:bg-surface-hover text-left transition-colors"
            >
              <card.icon className="w-5 h-5 text-text-tertiary" />
              <div className="space-y-0.5">
                <span className="text-sm font-medium text-text-primary block">{card.title}</span>
                <span className="text-xs text-text-tertiary leading-snug block">{card.description}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
