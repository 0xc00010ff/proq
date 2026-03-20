'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '@/components/Modal';
import type { CronJob, TaskMode } from '@/lib/types';
import {
  PlusIcon,
  PlayIcon,
  Trash2Icon,
  PencilIcon,
  ArrowLeftIcon,
} from 'lucide-react';

interface CronJobsModalProps {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatNextRun(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return 'due now';
  if (diff < 60_000) return 'in <1m';
  if (diff < 3_600_000) return `in ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)}h`;
  return d.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const MODES: { value: TaskMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'answer', label: 'Answer' },
  { value: 'plan', label: 'Plan' },
  { value: 'build', label: 'Build' },
];

export function CronJobsModal({ isOpen, projectId, onClose }: CronJobsModalProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // job id or 'new'
  const [form, setForm] = useState({ name: '', prompt: '', schedule: '', mode: 'auto' as TaskMode, enabled: true });
  const nameRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/projects/${projectId}/crons`)
      .then((r) => r.json())
      .then((data) => { setJobs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [isOpen, projectId]);

  const resetForm = () => {
    setForm({ name: '', prompt: '', schedule: '', mode: 'auto', enabled: true });
    setEditing(null);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.prompt.trim() || !form.schedule.trim()) return;

    if (editing === 'new') {
      const res = await fetch(`/api/projects/${projectId}/crons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const job = await res.json();
        setJobs((prev) => [...prev, job]);
      }
    } else if (editing) {
      const res = await fetch(`/api/projects/${projectId}/crons/${editing}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const updated = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === editing ? updated : j)));
      }
    }
    resetForm();
  };

  const handleToggle = async (job: CronJob) => {
    const res = await fetch(`/api/projects/${projectId}/crons/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
    }
  };

  const handleDelete = async (jobId: string) => {
    const res = await fetch(`/api/projects/${projectId}/crons/${jobId}`, { method: 'DELETE' });
    if (res.ok) {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (editing === jobId) resetForm();
    }
  };

  const handleTrigger = async (job: CronJob) => {
    await fetch(`/api/projects/${projectId}/crons/${job.id}/trigger`, { method: 'POST' });
  };

  const startEdit = (job: CronJob) => {
    setEditing(job.id);
    setForm({ name: job.name, prompt: job.prompt, schedule: job.schedule, mode: job.mode ?? 'auto', enabled: job.enabled });
  };

  const startNew = () => {
    setEditing('new');
    setForm({ name: '', prompt: '', schedule: '', mode: 'auto', enabled: true });
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="w-full max-w-lg">
      <div className="p-5 pt-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4 pr-6">
          {editing ? (
            <button
              onClick={resetForm}
              className="p-1 -ml-1 rounded text-text-tertiary hover:text-text-secondary"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" />
            </button>
          ) : null}
          <h2 className="text-sm font-semibold text-text-primary">
            {editing === 'new' ? 'New Schedule' : editing ? 'Edit Schedule' : 'Scheduled Tasks'}
          </h2>
        </div>

        {/* ── List view ── */}
        {!editing && (
          <>
            <div className="space-y-1.5">
              {loading ? (
                <div className="py-12 text-center">
                  <p className="text-xs text-text-tertiary">Loading...</p>
                </div>
              ) : jobs.length === 0 ? (
                <div className="py-10 text-center">
                  <button
                    onClick={startNew}
                    className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    Create a schedule
                  </button>
                </div>
              ) : (
                jobs.map((job) => (
                  <div
                    key={job.id}
                    className={`group rounded-md border px-3 py-2.5 transition-colors ${
                      job.enabled
                        ? 'border-border-default bg-surface-secondary hover:bg-surface-hover/40'
                        : 'border-border-subtle bg-surface-deep/30 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Toggle */}
                      <button
                        onClick={() => handleToggle(job)}
                        className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
                          job.enabled ? 'bg-emerald/60' : 'bg-zinc-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 rounded-full bg-white transition-transform mt-0.5 ${
                            job.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>

                      {/* Name + schedule */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-primary truncate">{job.name}</span>
                          <span className="text-[10px] text-text-chrome font-mono flex-shrink-0">{job.schedule}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => handleTrigger(job)}
                          className="p-1.5 rounded text-text-chrome hover:text-emerald hover:bg-surface-hover"
                          title="Run now"
                        >
                          <PlayIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => startEdit(job)}
                          className="p-1.5 rounded text-text-chrome hover:text-text-primary hover:bg-surface-hover"
                          title="Edit"
                        >
                          <PencilIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(job.id)}
                          className="p-1.5 rounded text-text-chrome hover:text-crimson hover:bg-surface-hover"
                          title="Delete"
                        >
                          <Trash2Icon className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-1.5 ml-9 text-[10px] text-text-tertiary">
                      {job.lastRunAt && (
                        <span>Last {formatRelativeTime(job.lastRunAt)}</span>
                      )}
                      {job.enabled && formatNextRun(job.nextRunAt) && (
                        <>
                          {job.lastRunAt && <span className="text-border-default">·</span>}
                          <span>Next {formatNextRun(job.nextRunAt)}</span>
                        </>
                      )}
                      {job.runCount > 0 && (
                        <>
                          <span className="text-border-default">·</span>
                          <span>{job.runCount} run{job.runCount !== 1 ? 's' : ''}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add button — only show if there are existing jobs (empty state has its own CTA) */}
            {!loading && jobs.length > 0 && (
              <button
                onClick={startNew}
                className="flex items-center gap-1.5 mt-3 px-2 py-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors rounded"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Add schedule
              </button>
            )}
          </>
        )}

        {/* ── Edit / Create form ── */}
        {editing && (
          <div>
            {/* Mode selector — pill style matching TaskDraft */}
            <div className="bg-surface-hover/40 p-0.5 rounded-md flex items-center border border-border-default w-fit mb-4">
              {MODES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setForm((f) => ({ ...f, mode: value }))}
                  className={`relative px-3 py-1 text-xs font-medium rounded z-10 ${
                    form.mode === value
                      ? 'text-text-chrome-active'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {form.mode === value && (
                    <div
                      className="absolute inset-0 bg-surface-modal rounded border border-border-hover/50 shadow-sm"
                      style={{ zIndex: -1 }}
                    />
                  )}
                  {label}
                </button>
              ))}
            </div>

            {/* Name */}
            <input
              ref={nameRef}
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Schedule name"
              className="w-full bg-transparent text-base font-medium text-text-primary focus:outline-none placeholder:text-text-placeholder mb-3"
              autoFocus
            />

            {/* Prompt */}
            <textarea
              ref={promptRef}
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder="What should the agent do?"
              rows={3}
              className="w-full bg-transparent text-sm text-text-primary focus:outline-none placeholder:text-text-placeholder resize-none leading-relaxed mb-4"
            />

            {/* Schedule */}
            <div className="border-t border-border-default/60 pt-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-tertiary flex-shrink-0">Schedule</span>
                <input
                  type="text"
                  value={form.schedule}
                  onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
                  placeholder="every 6h"
                  className="flex-1 bg-transparent text-sm font-mono text-text-primary focus:outline-none placeholder:text-text-placeholder"
                />
              </div>
              <p className="mt-1.5 text-[10px] text-text-chrome leading-relaxed">
                e.g. <code className="text-text-tertiary">every 6h</code> · <code className="text-text-tertiary">daily at 9am</code> · <code className="text-text-tertiary">every mon 8am</code> · <code className="text-text-tertiary">0 9 * * *</code>
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetForm} className="btn-secondary">Cancel</button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || !form.prompt.trim() || !form.schedule.trim()}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {editing === 'new' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
