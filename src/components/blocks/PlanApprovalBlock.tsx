'use client';

import React, { useState } from 'react';
import { ChevronRightIcon, ClipboardCheckIcon } from 'lucide-react';

interface PlanApprovalBlockProps {
  input: Record<string, unknown>;
  /** Whether the agent already got an auto-resolved answer */
  hasResult: boolean;
  /** Markdown content of the plan file, if found */
  planContent?: string;
  /** Path to the plan file */
  planFilePath?: string;
  onApprove: () => void;
  onReject: (feedback: string) => void;
}

export function PlanApprovalBlock({ input, hasResult, planContent, planFilePath, onApprove, onReject }: PlanApprovalBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Extract plan content — ExitPlanMode may include allowedPrompts in its input
  const allowedPrompts = Array.isArray(input.allowedPrompts) ? input.allowedPrompts as { tool: string; prompt: string }[] : [];

  // Extract a short filename from the plan path
  const planFileName = planFilePath ? planFilePath.split('/').pop() : undefined;

  return (
    <div className="my-2">
      <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2">
          <ClipboardCheckIcon className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            Plan ready for approval
          </span>
          {hasResult && (
            <span className="ml-auto text-[10px] text-zinc-600 italic">
              auto-resolved
            </span>
          )}
        </div>

        {/* Expandable plan content */}
        {planContent && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 border-t border-zinc-800/60 hover:bg-zinc-800/30 transition-colors text-left"
            >
              <ChevronRightIcon className={`w-3 h-3 text-zinc-600 transition-transform ${expanded ? 'rotate-90' : ''}`} />
              <span className="text-[11px] text-zinc-500">
                {expanded ? 'Hide plan' : 'View plan'}
              </span>
              {planFileName && (
                <span className="text-[10px] text-zinc-600 ml-1 font-mono">{planFileName}</span>
              )}
            </button>
            {expanded && (
              <div className="border-t border-zinc-800/60 px-3 py-2 max-h-80 overflow-y-auto">
                <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{planContent}</pre>
              </div>
            )}
          </>
        )}

        {/* Permissions */}
        {allowedPrompts.length > 0 && (
          <div className="px-3 py-2 border-t border-zinc-800/60">
            <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wide">
              Requested Permissions
            </span>
            <ul className="text-xs text-zinc-400 mt-1 space-y-0.5 list-disc list-inside">
              {allowedPrompts.map((p, i) => (
                <li key={i}>{p.prompt}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="px-3 py-2.5 border-t border-zinc-800/60">
          {!feedbackMode ? (
            <div className="flex items-center gap-3">
              <button
                onClick={onApprove}
                className="px-3 py-1.5 rounded-md border border-bronze-500/30 bg-bronze-800/30 hover:bg-bronze-800/50 text-xs font-medium text-bronze-400 transition-colors"
              >
                Approve Plan
              </button>
              <span className="text-[11px] text-zinc-600">
                or{' '}
                <button
                  onClick={() => setFeedbackMode(true)}
                  className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
                >
                  request changes
                </button>
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What changes would you like to the plan?"
                className="w-full h-20 px-2.5 py-2 rounded-md border border-zinc-700 bg-zinc-800/50 text-xs text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-600"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { if (feedback.trim()) onReject(feedback.trim()); }}
                  disabled={!feedback.trim()}
                  className="px-3 py-1.5 rounded-md border border-bronze-500/30 bg-bronze-800/30 hover:bg-bronze-800/50 text-xs font-medium text-bronze-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send Feedback
                </button>
                <button
                  onClick={() => { setFeedbackMode(false); setFeedback(''); }}
                  className="px-3 py-1.5 rounded-md text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
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
