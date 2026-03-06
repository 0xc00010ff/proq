'use client';

import React from 'react';
import { MessageCircleQuestionIcon } from 'lucide-react';

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface AskQuestionBlockProps {
  questions: Question[];
  /** Whether the agent already got an auto-resolved answer (i.e. has a tool_result) */
  hasResult: boolean;
  /** The auto-resolved result text, if any */
  resultText?: string;
  /** Whether there are subsequent blocks after this question (meaning it's been addressed) */
  isOld?: boolean;
  onAnswer: (answer: string) => void;
}

export function AskQuestionBlock({ questions, hasResult, resultText, isOld, onAnswer }: AskQuestionBlockProps) {
  const answered = isOld && hasResult;

  // Answered questions render as muted/gray; unanswered ones are gold/active
  if (answered) {
    return (
      <div className="my-2">
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/30">
            <MessageCircleQuestionIcon className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Agent Question
            </span>
            <span className="ml-auto text-[10px] text-zinc-600 italic">
              Answered below
            </span>
          </div>
          <div className="p-3 space-y-2">
            {questions.map((q, qi) => (
              <div key={qi}>
                {q.header && (
                  <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wide">
                    {q.header}
                  </span>
                )}
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {q.question}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2">
      <div className="rounded-lg border border-gold/30 bg-gold/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gold/20">
          <MessageCircleQuestionIcon className="w-3.5 h-3.5 text-gold" />
          <span className="text-xs font-medium text-gold uppercase tracking-wide">
            Agent Question
          </span>
          <span className="ml-auto text-[10px] text-text-tertiary italic">
            Select an option or provide your own answer
          </span>
        </div>

        {/* Questions */}
        <div className="p-3 space-y-3">
          {questions.map((q, qi) => (
            <div key={qi} className="space-y-2">
              {q.header && (
                <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">
                  {q.header}
                </span>
              )}
              <p className="text-sm text-text-primary leading-relaxed">
                {q.question}
              </p>
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    onClick={() => onAnswer(opt.label)}
                    className="group/opt flex flex-col items-start gap-0.5 px-3 py-2 rounded-md border border-border-default bg-surface-hover/50 hover:border-gold/50 hover:bg-gold/10 text-left"
                  >
                    <span className="text-xs font-medium text-text-primary group-hover/opt:text-gold">
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-[11px] text-text-tertiary leading-snug">
                        {opt.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
