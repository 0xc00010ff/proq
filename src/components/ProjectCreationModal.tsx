'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Modal } from '@/components/Modal';
import {
  FileIcon,
  GlobeIcon,
  BrainIcon,
  NotebookPenIcon,
  SearchIcon,
  SparklesIcon,
  ArrowLeftIcon,
  Loader2Icon,
  FolderOpenIcon,
} from 'lucide-react';
import type { TemplateDefinition, TemplateToggle } from '@/lib/templates';
import { templates } from '@/lib/templates';

// ── Icon map ─────────────────────────────────────────────

const iconMap: Record<string, React.ElementType> = {
  FileIcon,
  GlobeIcon,
  BrainIcon,
  NotebookPenIcon,
  SearchIcon,
};

// ── Props ────────────────────────────────────────────────

interface ProjectCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new project id after successful creation */
  onCreated: (projectId: string) => void;
  /** Close modal and prefill supervisor chat */
  onSomethingElse?: (text: string) => void;
  /** Open folder picker for existing project */
  onOpenExisting?: () => void;
}

// ── Component ────────────────────────────────────────────

export function ProjectCreationModal({
  isOpen,
  onClose,
  onCreated,
  onSomethingElse,
  onOpenExisting,
}: ProjectCreationModalProps) {
  const [step, setStep] = useState<'pick' | 'configure'>('pick');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDefinition | null>(null);

  // Configuration state
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [stackOverride, setStackOverride] = useState('');
  const [editingStack, setEditingStack] = useState(false);
  const [toggles, setToggles] = useState<Record<string, { enabled: boolean; value?: string }>>({});
  const [schedule, setSchedule] = useState('');
  const [location, setLocation] = useState('');

  // UI state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setStep('pick');
      setSelectedTemplate(null);
      setProjectName('');
      setDescription('');
      setStackOverride('');
      setEditingStack(false);
      setToggles({});
      setSchedule('');
      setLocation('');
      setIsCreating(false);
      setError(null);
    }
  }, [isOpen]);

  // Set default location
  useEffect(() => {
    if (isOpen && !location) {
      setLocation('~/Desktop/Projects');
    }
  }, [isOpen, location]);

  // Focus name input when entering configure step
  useEffect(() => {
    if (step === 'configure') {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [step]);

  const handleSelectTemplate = useCallback(
    (template: TemplateDefinition) => {
      setSelectedTemplate(template);
      setStackOverride(template.defaultStack || '');
      // Initialize toggles with defaults
      const initialToggles: Record<string, { enabled: boolean; value?: string }> = {};
      for (const t of template.toggles) {
        initialToggles[t.id] = { enabled: t.defaultOn };
      }
      setToggles(initialToggles);
      setStep('configure');
    },
    [],
  );

  const handleSomethingElse = useCallback(() => {
    onClose();
    onSomethingElse?.('Create a new project: ');
  }, [onClose, onSomethingElse]);

  const handleOpenExisting = useCallback(() => {
    onClose();
    onOpenExisting?.();
  }, [onClose, onOpenExisting]);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    setToggles((prev) => ({
      ...prev,
      [id]: { ...prev[id], enabled },
    }));
  }, []);

  const handleToggleValue = useCallback((id: string, value: string) => {
    setToggles((prev) => ({
      ...prev,
      [id]: { ...prev[id], value },
    }));
  }, []);

  const handlePickLocation = useCallback(async () => {
    try {
      const res = await fetch('/api/folder-picker', { method: 'POST' });
      const data = await res.json();
      if (!data.cancelled) {
        setLocation(data.path);
      }
    } catch {
      // Ignore
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!projectName.trim() || !selectedTemplate) return;

    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/projects/scaffold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          projectName: projectName.trim(),
          location: location.trim(),
          description: description.trim() || undefined,
          stackOverride: stackOverride !== selectedTemplate.defaultStack ? stackOverride : undefined,
          toggles,
          schedule: schedule.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      onCreated(data.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  }, [projectName, selectedTemplate, location, description, stackOverride, toggles, schedule, onCreated, onClose]);

  // Cmd+Enter to create
  useEffect(() => {
    if (!isOpen || step !== 'configure') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && projectName.trim() && !isCreating) {
        e.preventDefault();
        handleCreate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, step, projectName, isCreating, handleCreate]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="mx-4 p-0 max-w-2xl w-full overflow-hidden">
      {step === 'pick' ? (
        <TemplatePicker
          onSelect={handleSelectTemplate}
          onSomethingElse={handleSomethingElse}
          onOpenExisting={handleOpenExisting}
        />
      ) : selectedTemplate ? (
        <TemplateConfigurator
          template={selectedTemplate}
          projectName={projectName}
          onProjectNameChange={setProjectName}
          description={description}
          onDescriptionChange={setDescription}
          stackOverride={stackOverride}
          editingStack={editingStack}
          onEditingStackChange={setEditingStack}
          onStackOverrideChange={setStackOverride}
          toggles={toggles}
          onToggle={handleToggle}
          onToggleValue={handleToggleValue}
          schedule={schedule}
          onScheduleChange={setSchedule}
          location={location}
          onPickLocation={handlePickLocation}
          onLocationChange={setLocation}
          isCreating={isCreating}
          error={error}
          onBack={() => setStep('pick')}
          onCreate={handleCreate}
          nameInputRef={nameInputRef}
        />
      ) : null}
    </Modal>
  );
}

// ── Template Picker Grid ─────────────────────────────────

function TemplatePicker({
  onSelect,
  onSomethingElse,
  onOpenExisting,
}: {
  onSelect: (template: TemplateDefinition) => void;
  onSomethingElse: () => void;
  onOpenExisting?: () => void;
}) {
  return (
    <div className="p-6">
      <h2 className="text-sm font-semibold text-text-primary mb-1">Create a new project</h2>
      <p className="text-xs text-text-tertiary mb-5">Choose a template to get started</p>

      <div className="grid grid-cols-3 gap-2.5">
        {templates.map((template) => {
          const Icon = iconMap[template.icon] || FileIcon;
          return (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border-default bg-surface-topbar hover:border-border-strong hover:bg-surface-hover text-left transition-colors"
            >
              <Icon className="w-5 h-5 text-text-tertiary" />
              <div className="space-y-0.5">
                <span className="text-sm font-medium text-text-primary block">{template.name}</span>
                <span className="text-xs text-text-tertiary leading-snug block">{template.subtitle}</span>
              </div>
            </button>
          );
        })}

        {/* Something else */}
        <button
          onClick={onSomethingElse}
          className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border-default bg-surface-topbar hover:border-border-strong hover:bg-surface-hover text-left transition-colors"
        >
          <SparklesIcon className="w-5 h-5 text-text-tertiary" />
          <div className="space-y-0.5">
            <span className="text-sm font-medium text-text-primary block">Something else</span>
            <span className="text-xs text-text-tertiary leading-snug block">Describe what you want</span>
          </div>
        </button>
      </div>

      {/* Open existing */}
      {onOpenExisting && (
        <div className="mt-4 pt-4 border-t border-border-default">
          <button
            onClick={onOpenExisting}
            className="flex items-center gap-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <FolderOpenIcon className="w-3.5 h-3.5" />
            Open existing folder
          </button>
        </div>
      )}
    </div>
  );
}

// ── Template Configurator ────────────────────────────────

function TemplateConfigurator({
  template,
  projectName,
  onProjectNameChange,
  description,
  onDescriptionChange,
  stackOverride,
  editingStack,
  onEditingStackChange,
  onStackOverrideChange,
  toggles,
  onToggle,
  onToggleValue,
  schedule,
  onScheduleChange,
  location,
  onPickLocation,
  onLocationChange,
  isCreating,
  error,
  onBack,
  onCreate,
  nameInputRef,
}: {
  template: TemplateDefinition;
  projectName: string;
  onProjectNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  stackOverride: string;
  editingStack: boolean;
  onEditingStackChange: (v: boolean) => void;
  onStackOverrideChange: (v: string) => void;
  toggles: Record<string, { enabled: boolean; value?: string }>;
  onToggle: (id: string, enabled: boolean) => void;
  onToggleValue: (id: string, value: string) => void;
  schedule: string;
  onScheduleChange: (v: string) => void;
  location: string;
  onPickLocation: () => void;
  onLocationChange: (v: string) => void;
  isCreating: boolean;
  error: string | null;
  onBack: () => void;
  onCreate: () => void;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const Icon = iconMap[template.icon] || FileIcon;

  return (
    <div className="flex flex-col max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border-default">
        <button
          onClick={onBack}
          className="p-1 -ml-1 rounded hover:bg-surface-hover transition-colors text-text-tertiary hover:text-text-primary"
        >
          <ArrowLeftIcon className="w-4 h-4" />
        </button>
        <Icon className="w-4 h-4 text-text-tertiary" />
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{template.name}</h2>
          {template.defaultStack && !editingStack && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-tertiary">{stackOverride || template.defaultStack}</span>
              {template.stackEditable && (
                <button
                  onClick={() => onEditingStackChange(true)}
                  className="text-[10px] text-text-chrome hover:text-text-chrome-hover transition-colors"
                >
                  (edit)
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Stack override (expanded) */}
        {editingStack && (
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">Stack</label>
            <input
              type="text"
              value={stackOverride}
              onChange={(e) => onStackOverrideChange(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-border-default bg-surface-inset text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-border-hover"
              placeholder={template.defaultStack}
            />
            <button
              onClick={() => onEditingStackChange(false)}
              className="text-[10px] text-text-chrome hover:text-text-chrome-hover mt-1 transition-colors"
            >
              done
            </button>
          </div>
        )}

        {/* Project name */}
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1.5">Project name</label>
          <input
            ref={nameInputRef}
            type="text"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-border-default bg-surface-inset text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-border-hover"
            placeholder="my-project"
          />
        </div>

        {/* Location */}
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1.5">Location</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={location}
              onChange={(e) => onLocationChange(e.target.value)}
              className="flex-1 px-3 py-2 text-sm rounded-md border border-border-default bg-surface-inset text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-border-hover font-mono text-xs"
              placeholder="~/Desktop/Projects"
            />
            <button
              onClick={onPickLocation}
              className="btn-secondary flex items-center gap-1.5 shrink-0"
            >
              <FolderOpenIcon className="w-3 h-3" />
              Browse
            </button>
          </div>
        </div>

        {/* Description textarea */}
        {template.descriptionLabel && (
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">
              {template.descriptionLabel}
            </label>
            <textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-border-default bg-surface-inset text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-border-hover resize-none"
              rows={3}
              placeholder={template.descriptionPlaceholder}
            />
            {/* Example suggestions for research agent */}
            {template.descriptionExamples && template.descriptionExamples.length > 0 && (
              <div className="mt-2 space-y-1">
                {template.descriptionExamples.map((example) => (
                  <button
                    key={example}
                    onClick={() => onDescriptionChange(example)}
                    className="block text-[11px] text-text-chrome hover:text-text-chrome-hover transition-colors text-left"
                  >
                    &ldquo;{example}&rdquo;
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Schedule (Research Agent) */}
        {template.hasSchedule && (
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">How often?</label>
            <input
              type="text"
              value={schedule}
              onChange={(e) => onScheduleChange(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-border-default bg-surface-inset text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-border-hover"
              placeholder={template.schedulePlaceholder}
            />
          </div>
        )}

        {/* Toggles */}
        {template.toggles.length > 0 && (
          <div>
            <div className="space-y-2">
              {template.toggles.map((toggle) => (
                <ToggleRow
                  key={toggle.id}
                  toggle={toggle}
                  enabled={toggles[toggle.id]?.enabled ?? toggle.defaultOn}
                  value={toggles[toggle.id]?.value ?? ''}
                  onToggle={(enabled) => onToggle(toggle.id, enabled)}
                  onValueChange={(value) => onToggleValue(toggle.id, value)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border-default flex items-center justify-between">
        <div className="flex-1 min-w-0">
          {error && (
            <p className="text-xs text-red-500 truncate">{error}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-3">
          <button onClick={onBack} className="btn-secondary">
            Back
          </button>
          <button
            onClick={onCreate}
            disabled={!projectName.trim() || isCreating}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
          >
            {isCreating ? (
              <>
                <Loader2Icon className="w-3 h-3 animate-spin" />
                Creating...
              </>
            ) : (
              <>Create</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toggle Row ───────────────────────────────────────────

function ToggleRow({
  toggle,
  enabled,
  value,
  onToggle,
  onValueChange,
}: {
  toggle: TemplateToggle;
  enabled: boolean;
  value: string;
  onToggle: (enabled: boolean) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-text-primary">{toggle.label}</span>
          {toggle.description && (
            <span className="text-xs text-text-tertiary ml-1.5">{toggle.description}</span>
          )}
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-3 ${
            enabled ? 'bg-blue-500' : 'bg-zinc-600'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>

      {/* Text field when toggle is on and has text field */}
      {enabled && toggle.hasTextField && (
        <input
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="w-full px-3 py-1.5 text-xs rounded-md border border-border-default bg-surface-inset text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-border-hover"
          placeholder={toggle.placeholder}
        />
      )}
    </div>
  );
}
