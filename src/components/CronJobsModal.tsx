'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/Modal';
import type { CronJob, TaskMode } from '@/lib/types';
import {
  PlusIcon,
  PlayIcon,
  Trash2Icon,
  PencilIcon,
  ChevronDownIcon,
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
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return 'due now';
  if (diff < 60_000) return 'in <1m';
  if (diff < 3_600_000) return `in ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)}h`;
  return d.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const SCHEDULE_EXAMPLES = [
  '0 9 * * *',
  'every 6h',
  'daily at 9am',
  'every mon 8am',
  '*/30 * * * *',
];

export function CronJobsModal({ isOpen, projectId, onClose }: CronJobsModalProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // job id or 'new'
  const [form, setForm] = useState({ name: '', prompt: '', schedule: '', mode: 'auto' as TaskMode, enabled: true });

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

  return (
    <Modal isOpen={isOpen} onClose={() => { resetForm(); onClose(); }} className="w-full max-w-lg">
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-text-primary">Scheduled Tasks</h2>
          {!editing && (
            <button
              onClick={() => { setEditing('new'); setForm({ name: '', prompt: '', schedule: '', mode: 'auto', enabled: true }); }}
              className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              Add
            </button>
          )}
        </div>

        {/* Job list */}
        {!editing && (
          <div className="space-y-1">
            {loading ? (
              <p className="text-xs text-text-tertiary py-8 text-center">Loading...</p>
            ) : jobs.length === 0 ? (
              <p className="text-xs text-text-tertiary py-8 text-center">
                No scheduled tasks yet
              </p>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  className={`group rounded-md border px-3 py-2.5 transition-colors ${
                    job.enabled
                      ? 'border-border-default bg-surface-secondary'
                      : 'border-border-subtle bg-surface-deep/50 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-text-primary truncate">{job.name}</span>
                      <span className="text-[10px] text-text-chrome font-mono flex-shrink-0">{job.schedule}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => handleTrigger(job)}
                        className="p-1 rounded text-text-chrome hover:text-emerald hover:bg-surface-hover"
                        title="Run now"
                      >
                        <PlayIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => startEdit(job)}
                        className="p-1 rounded text-text-chrome hover:text-text-primary hover:bg-surface-hover"
                        title="Edit"
                      >
                        <PencilIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(job.id)}
                        className="p-1 rounded text-text-chrome hover:text-crimson hover:bg-surface-hover"
                        title="Delete"
                      >
                        <Trash2Icon className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-tertiary">
                    {job.lastRunAt && (
                      <span>Last: {formatRelativeTime(job.lastRunAt)}</span>
                    )}
                    {job.enabled && (
                      <span>Next: {formatNextRun(job.nextRunAt)}</span>
                    )}
                    {job.runCount > 0 && (
                      <span>{job.runCount} run{job.runCount !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-text-tertiary line-clamp-1 mr-4">{job.prompt}</p>
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
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Add / Edit form */}
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nightly lint check"
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-border-strong rounded-md text-text-primary focus:outline-none focus:border-border-strong"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Prompt</label>
              <textarea
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                placeholder="Run the linter and fix any issues found..."
                rows={3}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-border-strong rounded-md text-text-primary focus:outline-none focus:border-border-strong resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Schedule</label>
              <input
                type="text"
                value={form.schedule}
                onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
                placeholder="every 6h"
                className="w-full px-3 py-2 text-sm font-mono bg-surface-deep border border-border-strong rounded-md text-text-primary focus:outline-none focus:border-border-strong"
              />
              <p className="mt-1 text-[10px] text-text-chrome">
                {SCHEDULE_EXAMPLES.join('  ·  ')}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Mode</label>
              <div className="relative">
                <select
                  value={form.mode}
                  onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as TaskMode }))}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-border-strong rounded-md text-text-primary focus:outline-none focus:border-border-strong appearance-none cursor-pointer"
                >
                  <option value="auto">Auto</option>
                  <option value="build">Build</option>
                  <option value="answer">Answer (no code changes)</option>
                  <option value="plan">Plan (read-only)</option>
                </select>
                <ChevronDownIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
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
