'use client';

import React, { useState, useCallback } from 'react';
import { MessageCircleQuestionIcon, SendIcon } from 'lucide-react';

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
  const hasMultipleQuestions = questions.length > 1;

  // Track selected option index per question (for multi-question mode)
  const [selections, setSelections] = useState<Record<number, number>>({});

  const toggleSelection = useCallback((questionIndex: number, optionIndex: number) => {
    setSelections(prev => {
      // Toggle off if already selected
      if (prev[questionIndex] === optionIndex) {
        const next = { ...prev };
        delete next[questionIndex];
        return next;
      }
      return { ...prev, [questionIndex]: optionIndex };
    });
  }, []);

  const handleSubmitAll = useCallback(() => {
    const parts: string[] = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const selectedIdx = selections[qi];
      if (selectedIdx !== undefined) {
        const header = q.header || q.question;
        parts.push(`${header}: ${q.options[selectedIdx].label}`);
      }
    }
    if (parts.length > 0) {
      onAnswer(parts.join('\n'));
    }
  }, [questions, selections, onAnswer]);

  const selectionCount = Object.keys(selections).length;

  // Answered questions render as muted/gray; unanswered ones are gold/active
  if (answered) {
    return (
      <div className="my-2">
        <div className="rounded-lg border border-border-strong/40 bg-surface-topbar overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-strong/30">
            <MessageCircleQuestionIcon className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
              Agent Question
            </span>
            <span className="ml-auto text-[10px] text-text-tertiary italic">
              Answered below
            </span>
          </div>
          <div className="p-3 space-y-2">
            {questions.map((q, qi) => (
              <div key={qi}>
                {q.header && (
                  <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">
                    {q.header}
                  </span>
                )}
                <p className="text-sm text-text-secondary leading-relaxed">
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
      <div className="rounded-lg border border-border-default bg-surface-topbar overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle/60">
          <MessageCircleQuestionIcon className="w-3.5 h-3.5 text-lazuli" />
          <span className="text-xs font-medium text-lazuli uppercase tracking-wide">
            Agent Question
          </span>
          <span className="ml-auto text-[10px] text-text-tertiary italic">
            {hasMultipleQuestions
              ? 'Select options across questions, then submit'
              : 'Select an option or provide your own answer'}
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
                {q.options.map((opt, oi) => {
                  const isSelected = selections[qi] === oi;

                  // Single question: click immediately submits
                  if (!hasMultipleQuestions) {
                    return (
                      <button
                        key={oi}
                        onClick={() => onAnswer(opt.label)}
                        className="group/opt flex flex-col items-start gap-0.5 px-3 py-2 rounded-md border border-border-default bg-surface-hover/50 hover:border-border-strong hover:bg-surface-hover text-left"
                      >
                        <span className="text-xs font-medium text-text-primary">
                          {opt.label}
                        </span>
                        {opt.description && (
                          <span className="text-[11px] text-text-tertiary leading-snug">
                            {opt.description}
                          </span>
                        )}
                      </button>
                    );
                  }

                  // Multiple questions: click toggles selection
                  return (
                    <button
                      key={oi}
                      onClick={() => toggleSelection(qi, oi)}
                      className={`group/opt flex flex-col items-start gap-0.5 px-3 py-2 rounded-md border text-left transition-colors ${
                        isSelected
                          ? 'border-lazuli bg-lazuli/10'
                          : 'border-border-default bg-surface-hover/50 hover:border-border-strong hover:bg-surface-hover'
                      }`}
                    >
                      <span className={`text-xs font-medium ${isSelected ? 'text-lazuli' : 'text-text-primary'}`}>
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className={`text-[11px] leading-snug ${isSelected ? 'text-lazuli/70' : 'text-text-tertiary'}`}>
                          {opt.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Submit button for multi-question mode */}
        {hasMultipleQuestions && (
          <div className="px-3 pb-3 flex justify-end">
            <button
              onClick={handleSubmitAll}
              disabled={selectionCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-lazuli/90 hover:bg-lazuli text-white"
            >
              <SendIcon className="w-3 h-3" />
              Submit {selectionCount > 0 ? `(${selectionCount}/${questions.length})` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
