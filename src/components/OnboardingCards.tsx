"use client";

import React, { useState, useEffect, useRef } from "react";
import { FolderOpenIcon, GitBranchIcon, PlusIcon } from "lucide-react";

interface OnboardingCardsProps {
  onAddProject: () => void;
  onFocusChat: () => void;
  onSendMessage: (text: string) => void;
}

const quickStartCards = [
  {
    icon: FolderOpenIcon,
    title: "Add a project",
    description: "Point proq at an existing codebase",
    action: "addProject" as const,
  },
  {
    icon: PlusIcon,
    title: "Create a project",
    description: "Scaffold a new project from scratch",
    action: "send" as const,
    message: "Help me scaffold and create a brand new project from scratch.",
  },
  {
    icon: GitBranchIcon,
    title: "Import from GitHub",
    description: "Clone a repo and set it up",
    action: "send" as const,
    message: "Help me clone a GitHub repo and set it up as a proq project.",
  },
];

function AnimatedLogo({ size = 20 }: { size?: number }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    setKey(1);
  }, []);
  return (
    <svg
      key={key}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M36.3813 253V16H219.618V173.41H89.6223V69.6509H165.507V121.235H128.533"
        stroke="#E4BD89"
        strokeWidth="27"
        strokeDasharray="976"
        strokeDashoffset="976"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="976;0"
          keyTimes="0;1"
          dur="0.8s"
          repeatCount="1"
          fill="freeze"
          calcMode="spline"
          keySplines="0 0 0.58 1"
        />
      </path>
    </svg>
  );
}

export function OnboardingCards({
  onAddProject,
  onFocusChat,
  onSendMessage,
}: OnboardingCardsProps) {
  const [phase, setPhase] = useState<"draw" | "lift" | "reveal">("draw");
  const containerRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const [logoOffset, setLogoOffset] = useState(0);

  // Measure how far the logo needs to move down to be centered
  useEffect(() => {
    if (containerRef.current && logoRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const logoRect = logoRef.current.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;
      const logoCenter = logoRect.top + logoRect.height / 2;
      setLogoOffset(containerCenter - logoCenter);
    }
  }, []);

  useEffect(() => {
    const liftTimer = setTimeout(() => setPhase("lift"), 800);
    const revealTimer = setTimeout(() => setPhase("reveal"), 1400);
    return () => {
      clearTimeout(liftTimer);
      clearTimeout(revealTimer);
    };
  }, []);

  const handleCardClick = (card: (typeof quickStartCards)[number]) => {
    if (card.action === "addProject") {
      onAddProject();
    } else {
      onSendMessage(card.message!);
      onFocusChat();
    }
  };

  const handleLearnMore = () => {
    onSendMessage(
      "What is proq and how does it work? Explain how it uses AI agents to build, test, and ship code.",
    );
    onFocusChat();
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center justify-center h-full px-6"
    >
      {/* Logo — translated down to center during draw, lifts back to resting position */}
      <div
        ref={logoRef}
        className="mb-3"
        style={{
          transform:
            phase === "draw" ? `translateY(${logoOffset}px)` : "translateY(0)",
          transition:
            phase !== "draw"
              ? "transform 1s cubic-bezier(0.25, 0.1, 0.25, 1)"
              : "none",
        }}
      >
        <AnimatedLogo size={20} />
      </div>

      {/* Content — everything in place, just hidden until reveal */}
      <div
        className="flex flex-col items-center w-full transition-opacity duration-500 ease-in"
        style={{
          opacity: phase === "reveal" ? 1 : 0,
          pointerEvents: phase === "reveal" ? "auto" : "none",
        }}
      >
        {/* Top section — Welcome */}
        <div className="flex flex-col items-center text-center gap-3 mb-8">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-text-primary">
              Welcome to proq
            </h2>
            <p className="text-sm text-text-tertiary">
              Build what you want.
            </p>
          </div>
        </div>

        {/* Divider with label */}
        <div className="w-full max-w-lg flex items-center gap-3 mb-8">
          <div className="flex-1 border-t border-border-default" />
          <span className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">
            Quick start
          </span>
          <div className="flex-1 border-t border-border-default" />
        </div>

        {/* Quick start cards */}
        <div className="w-full max-w-lg">
          <div className="grid grid-cols-3 gap-3">
            {quickStartCards.map((card) => (
              <button
                key={card.title}
                onClick={() => handleCardClick(card)}
                className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border-default bg-surface-topbar hover:border-border-strong hover:bg-surface-hover text-left transition-colors"
              >
                <card.icon className="w-5 h-5 text-text-tertiary" />
                <div className="space-y-0.5">
                  <span className="text-sm font-medium text-text-primary block">
                    {card.title}
                  </span>
                  <span className="text-xs text-text-tertiary leading-snug block">
                    {card.description}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Learn more */}
        <button
          onClick={handleLearnMore}
          className="mt-8 text-xs font-medium px-3 py-1.5 rounded-md text-text-chrome-hover hover:brightness-125 transition-all"
        >
          What else can proq do? →
        </button>
      </div>
    </div>
  );
}
