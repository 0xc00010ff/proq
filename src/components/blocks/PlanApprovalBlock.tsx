'use client';

import React, { useState } from 'react';
import { ClipboardCheckIcon } from 'lucide-react';

interface PlanApprovalBlockProps {
  input: Record<string, unknown>;
  /** Whether the agent already got an auto-resolved answer */
  hasResult: boolean;
  onApprove: () => void;
  onReject: (feedback: string) => void;
}

export function PlanApprovalBlock({ input, hasResult, onApprove, onReject }: PlanApprovalBlockProps) {
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Extract plan content — ExitPlanMode may include allowedPrompts in its input
  const allowedPrompts = Array.isArray(input.allowedPrompts) ? input.allowedPrompts as { tool: string; prompt: string }[] : [];

  return (
    <div className="my-2">
      <div className="rounded-lg border border-bronze-300 dark:border-zinc-700/60 bg-bronze-50/50 dark:bg-zinc-800/30 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-bronze-300 dark:border-zinc-700/50">
          <ClipboardCheckIcon className="w-3.5 h-3.5 text-bronze-500 dark:text-zinc-500" />
          <span className="text-xs font-medium text-bronze-600 dark:text-zinc-400 uppercase tracking-wide">
            Plan Ready for Approval
          </span>
          {hasResult && (
            <span className="ml-auto text-[10px] text-bronze-500 dark:text-zinc-500 italic">
              auto-resolved — approve or reject below
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-3 space-y-3">
          {allowedPrompts.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-bronze-500 dark:text-zinc-500 uppercase tracking-wide">
                Requested Permissions
              </span>
              <ul className="text-xs text-bronze-800 dark:text-zinc-300 space-y-0.5 list-disc list-inside">
                {allowedPrompts.map((p, i) => (
                  <li key={i}>{p.prompt}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-sm text-bronze-800 dark:text-zinc-200 leading-relaxed">
            The agent has finished planning and is waiting for your approval to proceed with implementation.
          </p>

          {!feedbackMode ? (
            <div className="flex gap-2">
              <button
                onClick={onApprove}
                className="px-3 py-1.5 rounded-md border border-steel/40 bg-steel/10 hover:bg-steel/20 text-xs font-medium text-steel transition-colors"
              >
                Approve Plan
              </button>
              <button
                onClick={() => setFeedbackMode(true)}
                className="px-3 py-1.5 rounded-md border border-bronze-300 dark:border-zinc-700 bg-bronze-100/50 dark:bg-zinc-800/50 hover:border-bronze-400 dark:hover:border-zinc-600 text-xs font-medium text-bronze-600 dark:text-zinc-400 hover:text-bronze-800 dark:hover:text-zinc-200 transition-colors"
              >
                Request Changes
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What changes would you like to the plan?"
                className="w-full h-20 px-2.5 py-2 rounded-md border border-bronze-300 dark:border-zinc-700 bg-bronze-100/50 dark:bg-zinc-800/50 text-xs text-bronze-800 dark:text-zinc-200 placeholder:text-bronze-400 dark:placeholder:text-zinc-600 resize-none focus:outline-none focus:border-steel/50"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { if (feedback.trim()) onReject(feedback.trim()); }}
                  disabled={!feedback.trim()}
                  className="px-3 py-1.5 rounded-md border border-crimson/40 bg-crimson/10 hover:bg-crimson/20 text-xs font-medium text-crimson transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send Feedback
                </button>
                <button
                  onClick={() => { setFeedbackMode(false); setFeedback(''); }}
                  className="px-3 py-1.5 rounded-md border border-bronze-300 dark:border-zinc-700 text-xs text-bronze-500 dark:text-zinc-500 hover:text-bronze-700 dark:hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
