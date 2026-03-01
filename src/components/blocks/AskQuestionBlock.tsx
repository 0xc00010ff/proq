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
  onAnswer: (answer: string) => void;
}

export function AskQuestionBlock({ questions, hasResult, resultText, onAnswer }: AskQuestionBlockProps) {
  const autoResolved = hasResult && resultText && !resultText.startsWith('{"answers"');

  return (
    <div className="my-2">
      <div className="rounded-lg border border-gold/30 bg-gold/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gold/20">
          <MessageCircleQuestionIcon className="w-3.5 h-3.5 text-gold" />
          <span className="text-xs font-medium text-gold uppercase tracking-wide">
            Agent Question
          </span>
          {autoResolved && (
            <span className="ml-auto text-[10px] text-bronze-500 dark:text-zinc-500 italic">
              auto-resolved — answer below to override
            </span>
          )}
        </div>

        {/* Questions */}
        <div className="p-3 space-y-3">
          {questions.map((q, qi) => (
            <div key={qi} className="space-y-2">
              {q.header && (
                <span className="text-[10px] font-medium text-bronze-500 dark:text-zinc-500 uppercase tracking-wide">
                  {q.header}
                </span>
              )}
              <p className="text-sm text-bronze-800 dark:text-zinc-200 leading-relaxed">
                {q.question}
              </p>
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    onClick={() => onAnswer(opt.label)}
                    className="group/opt flex flex-col items-start gap-0.5 px-3 py-2 rounded-md border border-bronze-300 dark:border-zinc-700 bg-bronze-100/50 dark:bg-zinc-800/50 hover:border-gold/50 hover:bg-gold/10 transition-colors text-left"
                  >
                    <span className="text-xs font-medium text-bronze-800 dark:text-zinc-200 group-hover/opt:text-gold">
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-[11px] text-bronze-500 dark:text-zinc-500 leading-snug">
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
