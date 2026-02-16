'use client';

import React, { useEffect } from 'react';
import {
  XIcon,
  AlertTriangleIcon,
  Loader2Icon,
  FileTextIcon,
  ClipboardListIcon,
  CheckCircle2Icon,
  ClockIcon,
} from 'lucide-react';
import type { Task } from '@/lib/types';
import { TerminalPane } from './TerminalPane';

interface TaskAgentModalProps {
  task: Task;
  onClose: () => void;
  onComplete?: (taskId: string) => void;
}

export function TaskAgentModal({ task, onClose, onComplete }: TaskAgentModalProps) {
  const shortId = task.id.slice(0, 8);
  const terminalTabId = `task-${shortId}`;
  const steps = task.humanSteps?.split('\n').filter(Boolean) || [];
  const findings = task.findings?.split('\n').filter(Boolean) || [];
  const isLocked = task.status === 'in-progress' && task.locked;
  const showTerminal = task.status === 'in-progress' || task.status === 'verify';

  // Load xterm CSS
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

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />

      {/* Modal */}
      <div
        className="relative w-full max-w-7xl h-[90vh] flex flex-row rounded-lg border border-[#222] bg-[#141414] shadow-2xl shadow-black/60 mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Left panel: task details (30% with terminal, full width without) ── */}
        <div className={`${showTerminal ? 'w-[30%] border-r border-zinc-800' : 'w-full'} shrink-0 flex flex-col overflow-hidden`}>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 left-4 p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors z-10"
          >
            <XIcon className="w-4 h-4" />
          </button>

          {/* Top half: title, status, description */}
          <div className="flex-1 overflow-y-auto p-5 pt-12 space-y-4">
            {/* Status badge */}
            <div className="flex items-center gap-1.5">
              {isLocked ? (
                <span className="flex items-center gap-1.5 text-xs text-blue-400 font-medium uppercase tracking-wide">
                  <Loader2Icon className="w-3 h-3 animate-spin" />
                  Agent working
                </span>
              ) : task.status === 'verify' ? (
                <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium uppercase tracking-wide">
                  <ClockIcon className="w-3 h-3" />
                  Awaiting review
                </span>
              ) : task.status === 'done' ? (
                <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium uppercase tracking-wide">
                  <CheckCircle2Icon className="w-3 h-3" />
                  Completed
                </span>
              ) : (
                <span className="text-xs text-zinc-500 font-medium uppercase tracking-wide">
                  {task.status}
                </span>
              )}
              <span className="ml-auto text-[10px] text-zinc-600 font-mono">{shortId}</span>
            </div>

            {/* Title */}
            <h2 className="text-base font-semibold text-zinc-100 leading-snug">
              {task.title || 'Untitled task'}
            </h2>

            {/* Description */}
            {task.description && (
              <p className="text-xs text-zinc-400 leading-relaxed font-mono whitespace-pre-wrap">
                {task.description}
              </p>
            )}

            {/* Human steps banner */}
            {steps.length > 0 && (
              <div className="bg-amber-500/8 border border-amber-500/20 rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangleIcon className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-xs font-medium text-amber-500 uppercase tracking-wide">
                    Steps for you
                  </span>
                </div>
                <ul className="space-y-1">
                  {steps.map((step, idx) => (
                    <li key={idx} className="text-xs text-zinc-300 flex items-start">
                      <span className="mr-2 text-zinc-600">&bull;</span>
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Bottom half: agent findings & summary */}
          <div className={`flex-1 overflow-y-auto border-t border-zinc-800 ${isLocked && findings.length === 0 ? 'flex flex-col items-center justify-center p-5' : 'p-5 space-y-4'}`}>
            {findings.length > 0 || !isLocked ? (
              <div className="flex items-center gap-2">
                <ClipboardListIcon className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Agent Report
                </span>
              </div>
            ) : null}

            {findings.length > 0 ? (
              <div className="space-y-3">
                <ul className="space-y-1.5">
                  {findings.map((finding, idx) => (
                    <li key={idx} className="text-xs text-zinc-400 flex items-start font-mono">
                      <span className="mr-2 text-zinc-700 shrink-0">-</span>
                      <span>{finding}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : isLocked ? (
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2Icon className="w-5 h-5 text-blue-400 animate-spin" />
                <span className="text-xs text-blue-400 font-medium uppercase tracking-wide">
                  Agent working
                </span>
                <p className="text-xs text-zinc-600 italic text-center mt-1">
                  Agent is still working. Findings will appear here when reported.
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-600 italic">
                No findings reported.
              </p>
            )}

            {task.agentLog && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileTextIcon className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wide">
                    Log
                  </span>
                </div>
                <pre className="text-[11px] text-zinc-500 font-mono bg-zinc-950 border border-zinc-800 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {task.agentLog}
                </pre>
              </div>
            )}
          </div>

          {/* Complete button pinned to bottom */}
          {task.status === 'verify' && onComplete && (
            <div className="border-t border-zinc-800 p-4">
              <button
                onClick={() => onComplete(task.id)}
                className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-green-400 border border-green-500/30 rounded-md hover:bg-green-500/10 transition-colors"
              >
                <CheckCircle2Icon className="w-3.5 h-3.5" />
                Complete
              </button>
            </div>
          )}
        </div>

        {/* ── Right panel: terminal (70%) ── */}
        {showTerminal && (
          <div className="flex-1 relative min-h-0">
            <TerminalPane tabId={terminalTabId} visible={true} enableDrop />
          </div>
        )}
      </div>
    </div>
  );
}
