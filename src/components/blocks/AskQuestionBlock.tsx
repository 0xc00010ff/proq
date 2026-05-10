'use client';

import React, { useState, useCallback } from 'react';
import { MessageCircleQuestionIcon, SendIcon } from 'lucide-react';

interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
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

  // Track selected option index per question. Index === q.options.length means "Other".
  const [selections, setSelections] = useState<Record<number, number>>({});
  // Free-text answer for "Other" per question
  const [otherText, setOtherText] = useState<Record<number, string>>({});

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

  const selectOther = useCallback((questionIndex: number) => {
    setSelections(prev => ({ ...prev, [questionIndex]: questions[questionIndex].options.length }));
  }, [questions]);

  const updateOtherText = useCallback((questionIndex: number, value: string) => {
    setOtherText(prev => ({ ...prev, [questionIndex]: value }));
  }, []);

  const submitSingleOther = useCallback((questionIndex: number) => {
    const text = (otherText[questionIndex] || '').trim();
    if (!text) return;
    onAnswer(text);
  }, [otherText, onAnswer]);

  const handleSubmitAll = useCallback(() => {
    const parts: string[] = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const selectedIdx = selections[qi];
      if (selectedIdx === undefined) continue;
      const header = q.header || q.question;
      if (selectedIdx === q.options.length) {
        const text = (otherText[qi] || '').trim();
        if (!text) continue;
        parts.push(`${header}: ${text}`);
      } else {
        parts.push(`${header}: ${q.options[selectedIdx].label}`);
      }
    }
    if (parts.length > 0) {
      onAnswer(parts.join('\n'));
    }
  }, [questions, selections, otherText, onAnswer]);

  // Count valid answers (selections with text filled in for "Other")
  const validCount = (() => {
    let n = 0;
    for (let qi = 0; qi < questions.length; qi++) {
      const sel = selections[qi];
      if (sel === undefined) continue;
      if (sel === questions[qi].options.length) {
        if ((otherText[qi] || '').trim()) n++;
      } else {
        n++;
      }
    }
    return n;
  })();

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
          {questions.map((q, qi) => {
            const otherIdx = q.options.length;
            const otherSelected = selections[qi] === otherIdx;
            const hasAnyPreview = q.options.some(o => o.preview);
            const containerClass = hasAnyPreview
              ? 'flex flex-col gap-2'
              : 'flex flex-wrap gap-2';
            const widthClass = hasAnyPreview ? 'w-full' : '';

            return (
              <div key={qi} className="space-y-2">
                {q.header && (
                  <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">
                    {q.header}
                  </span>
                )}
                <p className="text-sm text-text-primary leading-relaxed">
                  {q.question}
                </p>
                <div className={containerClass}>
                  {q.options.map((opt, oi) => {
                    const isSelected = selections[qi] === oi;

                    // Single question: click immediately submits
                    if (!hasMultipleQuestions) {
                      return (
                        <button
                          key={oi}
                          onClick={() => onAnswer(opt.label)}
                          className={`group/opt flex flex-col items-start gap-1 px-3 py-2 rounded-md border border-border-default bg-surface-hover/50 hover:border-border-strong hover:bg-surface-hover text-left ${widthClass}`}
                        >
                          <span className="text-xs font-medium text-text-primary">
                            {opt.label}
                          </span>
                          {opt.description && (
                            <span className="text-[11px] text-text-tertiary leading-snug">
                              {opt.description}
                            </span>
                          )}
                          {opt.preview && (
                            <pre className="mt-1 w-full max-h-64 overflow-auto rounded border border-border-subtle/60 bg-surface-base/60 px-2 py-1.5 text-[11px] leading-snug text-text-secondary whitespace-pre-wrap font-mono">
                              {opt.preview}
                            </pre>
                          )}
                        </button>
                      );
                    }

                    // Multiple questions: click toggles selection
                    return (
                      <button
                        key={oi}
                        onClick={() => toggleSelection(qi, oi)}
                        className={`group/opt flex flex-col items-start gap-1 px-3 py-2 rounded-md border text-left transition-colors ${widthClass} ${
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
                        {opt.preview && (
                          <pre className={`mt-1 w-full max-h-64 overflow-auto rounded border px-2 py-1.5 text-[11px] leading-snug whitespace-pre-wrap font-mono ${
                            isSelected
                              ? 'border-lazuli/40 bg-lazuli/5 text-text-primary'
                              : 'border-border-subtle/60 bg-surface-base/60 text-text-secondary'
                          }`}>
                            {opt.preview}
                          </pre>
                        )}
                      </button>
                    );
                  })}

                  {/* Synthetic "Other" option */}
                  <button
                    onClick={() => {
                      if (hasMultipleQuestions) {
                        toggleSelection(qi, otherIdx);
                      } else {
                        selectOther(qi);
                      }
                    }}
                    className={`group/opt flex flex-col items-start gap-1 px-3 py-2 rounded-md border border-dashed text-left transition-colors ${widthClass} ${
                      otherSelected
                        ? 'border-lazuli bg-lazuli/10'
                        : 'border-border-default bg-surface-hover/30 hover:border-border-strong hover:bg-surface-hover'
                    }`}
                  >
                    <span className={`text-xs font-medium ${otherSelected ? 'text-lazuli' : 'text-text-primary'}`}>
                      Other
                    </span>
                    <span className={`text-[11px] leading-snug ${otherSelected ? 'text-lazuli/70' : 'text-text-tertiary'}`}>
                      Provide your own answer
                    </span>
                  </button>
                </div>

                {/* Free-text input shown when "Other" is selected */}
                {otherSelected && (
                  <div className="flex items-start gap-2">
                    <textarea
                      value={otherText[qi] || ''}
                      onChange={(e) => updateOtherText(qi, e.target.value)}
                      onKeyDown={(e) => {
                        if (!hasMultipleQuestions && e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          submitSingleOther(qi);
                        }
                      }}
                      autoFocus
                      placeholder="Type your answer..."
                      rows={1}
                      className="flex-1 px-2 py-1.5 rounded-md border border-border-default bg-surface-base text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-lazuli resize-y min-h-[32px]"
                    />
                    {!hasMultipleQuestions && (
                      <button
                        onClick={() => submitSingleOther(qi)}
                        disabled={!(otherText[qi] || '').trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-lazuli/90 hover:bg-lazuli text-white"
                      >
                        <SendIcon className="w-3 h-3" />
                        Send
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Submit button for multi-question mode */}
        {hasMultipleQuestions && (
          <div className="px-3 pb-3 flex justify-end">
            <button
              onClick={handleSubmitAll}
              disabled={validCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-lazuli/90 hover:bg-lazuli text-white"
            >
              <SendIcon className="w-3 h-3" />
              Submit {validCount > 0 ? `(${validCount}/${questions.length})` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
