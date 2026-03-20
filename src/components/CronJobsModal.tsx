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

// ── Schedule picker helpers ──

type Frequency = 'interval' | 'daily' | 'weekly';
type IntervalUnit = 'minutes' | 'hours' | 'days';
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const ampm = i < 12 ? 'am' : 'pm';
  return { value: i, label: `${h}:00 ${ampm}` };
});

interface ScheduleState {
  frequency: Frequency;
  intervalAmount: number;
  intervalUnit: IntervalUnit;
  hour: number;
  days: number[]; // 0=Sun, 1=Mon, ... 6=Sat
}

function scheduleToString(s: ScheduleState): string {
  if (s.frequency === 'interval') {
    const n = Math.max(1, s.intervalAmount);
    if (s.intervalUnit === 'minutes') return `*/${n} * * * *`;
    if (s.intervalUnit === 'hours') return `0 */${n} * * *`;
    // days: run at the given hour every N days — approximate with */N in dom field
    return `0 ${s.hour} */${n} * *`;
  }
  if (s.frequency === 'daily') return `0 ${s.hour} * * *`;
  // weekly: multiple days
  const dayStr = s.days.length === 0 ? '*' : s.days.sort().join(',');
  return `0 ${s.hour} * * ${dayStr}`;
}

function parseScheduleState(schedule: string): ScheduleState {
  const s = schedule.trim().toLowerCase();
  const defaults: ScheduleState = { frequency: 'daily', intervalAmount: 6, intervalUnit: 'hours', hour: 9, days: [1] };

  // Friendly: "every Xh/Xm"
  const friendlyInterval = s.match(/^every\s+(\d+)\s*([hmd])/);
  if (friendlyInterval) {
    const n = parseInt(friendlyInterval[1]);
    const u = friendlyInterval[2];
    const unit: IntervalUnit = u === 'm' ? 'minutes' : u === 'd' ? 'days' : 'hours';
    return { ...defaults, frequency: 'interval', intervalAmount: n, intervalUnit: unit };
  }

  // Friendly: "daily at Xam/pm"
  const dailyMatch = s.match(/daily\s+(?:at\s+)?(\d{1,2})\s*(am|pm)?/);
  if (dailyMatch) {
    let h = parseInt(dailyMatch[1]);
    if (dailyMatch[2] === 'pm' && h < 12) h += 12;
    if (dailyMatch[2] === 'am' && h === 12) h = 0;
    return { ...defaults, frequency: 'daily', hour: h };
  }

  // Friendly: "every mon/tue..."
  const weeklyMatch = s.match(/every\s+(sun|mon|tue|wed|thu|fri|sat)\w*\s+(?:at\s+)?(\d{1,2})\s*(am|pm)?/);
  if (weeklyMatch) {
    const dayAbbrevs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayIdx = dayAbbrevs.indexOf(weeklyMatch[1]);
    let h = parseInt(weeklyMatch[2]);
    if (weeklyMatch[3] === 'pm' && h < 12) h += 12;
    if (weeklyMatch[3] === 'am' && h === 12) h = 0;
    return { ...defaults, frequency: 'weekly', hour: h, days: dayIdx >= 0 ? [dayIdx] : [1] };
  }

  // Cron expression
  const parts = s.split(/\s+/);
  if (parts.length === 5) {
    const hour = parseInt(parts[1]);
    const dow = parts[4];

    // Interval: */N in minute or hour field
    if (parts[0].startsWith('*/')) {
      return { ...defaults, frequency: 'interval', intervalAmount: parseInt(parts[0].slice(2)) || 30, intervalUnit: 'minutes' };
    }
    if (parts[1].startsWith('*/')) {
      return { ...defaults, frequency: 'interval', intervalAmount: parseInt(parts[1].slice(2)) || 6, intervalUnit: 'hours' };
    }
    if (parts[2].startsWith('*/')) {
      return { ...defaults, frequency: 'interval', intervalAmount: parseInt(parts[2].slice(2)) || 1, intervalUnit: 'days', hour: isNaN(hour) ? 9 : hour };
    }

    // Weekly: specific days
    if (dow !== '*' && parts[2] === '*' && parts[3] === '*') {
      const days = dow.split(',').map((d) => parseInt(d)).filter((d) => !isNaN(d));
      return { ...defaults, frequency: 'weekly', hour: isNaN(hour) ? 9 : hour, days: days.length > 0 ? days : [1] };
    }

    // Daily: M H * * *
    if (dow === '*' && parts[2] === '*' && parts[3] === '*' && !isNaN(hour)) {
      return { ...defaults, frequency: 'daily', hour };
    }
  }

  return defaults;
}

function SelectField({ value, onChange, children }: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-surface-deep border border-border-default rounded-md px-2.5 py-1.5 pr-7 text-xs text-text-primary focus:outline-none focus:border-border-strong cursor-pointer"
      >
        {children}
      </select>
      <ChevronDownIcon className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary pointer-events-none" />
    </div>
  );
}

export function CronJobsModal({ isOpen, projectId, onClose }: CronJobsModalProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // job id or 'new'
  const [form, setForm] = useState({ name: '', prompt: '', schedule: '', mode: 'auto' as TaskMode, enabled: true });
  const [schedState, setSchedState] = useState<ScheduleState>({ frequency: 'daily', intervalAmount: 6, intervalUnit: 'hours', hour: 9, days: [1] });
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

  const updateSched = (partial: Partial<ScheduleState>) => {
    setSchedState((prev) => {
      const next = { ...prev, ...partial };
      setForm((f) => ({ ...f, schedule: scheduleToString(next) }));
      return next;
    });
  };

  const startEdit = (job: CronJob) => {
    setEditing(job.id);
    setForm({ name: job.name, prompt: job.prompt, schedule: job.schedule, mode: job.mode ?? 'auto', enabled: job.enabled });
    setSchedState(parseScheduleState(job.schedule));
  };

  const startNew = () => {
    const defaultSched: ScheduleState = { frequency: 'daily', intervalAmount: 6, intervalUnit: 'hours', hour: 9, days: [1] };
    setEditing('new');
    setForm({ name: '', prompt: '', schedule: scheduleToString(defaultSched), mode: 'auto', enabled: true });
    setSchedState(defaultSched);
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
            {!loading && jobs.length > 0 && (
              <button
                onClick={startNew}
                className="btn-secondary text-xs mb-3 -ml-3 inline-flex items-center gap-1.5"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Add schedule
              </button>
            )}

            <div className="space-y-1.5">
              {loading ? (
                <div className="py-12 text-center">
                  <p className="text-xs text-text-tertiary">Loading...</p>
                </div>
              ) : jobs.length === 0 ? (
                <div className="py-10 text-center">
                  <button
                    onClick={startNew}
                    className="btn-secondary text-xs"
                  >
                    Create a schedule
                  </button>
                </div>
              ) : (
                jobs.map((job) => (
                  <div
                    key={job.id}
                    onClick={() => startEdit(job)}
                    className={`group rounded-md border px-3 py-2.5 transition-colors cursor-pointer ${
                      job.enabled
                        ? 'border-border-default bg-surface-secondary hover:bg-surface-hover/40'
                        : 'border-border-subtle bg-surface-deep/30 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggle(job); }}
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
                          onClick={(e) => { e.stopPropagation(); handleTrigger(job); }}
                          className="p-1.5 rounded text-text-chrome hover:text-emerald hover:bg-surface-hover"
                          title="Run now"
                        >
                          <PlayIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(job); }}
                          className="p-1.5 rounded text-text-chrome hover:text-text-primary hover:bg-surface-hover"
                          title="Edit"
                        >
                          <PencilIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}
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
              {/* Frequency selector — pill style */}
              <div className="bg-surface-hover/40 p-0.5 rounded-md flex items-center border border-border-default w-fit mb-3">
                {([
                  ['interval', 'Every'],
                  ['daily', 'Daily'],
                  ['weekly', 'Weekly'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => updateSched({ frequency: value })}
                    className={`relative px-3 py-1 text-xs font-medium rounded z-10 ${
                      schedState.frequency === value
                        ? 'text-text-chrome-active'
                        : 'text-text-tertiary hover:text-text-secondary'
                    }`}
                  >
                    {schedState.frequency === value && (
                      <div
                        className="absolute inset-0 bg-surface-modal rounded border border-border-hover/50 shadow-sm"
                        style={{ zIndex: -1 }}
                      />
                    )}
                    {label}
                  </button>
                ))}
              </div>

              {/* Interval: number + unit */}
              {schedState.frequency === 'interval' && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={schedState.intervalAmount}
                    onChange={(e) => updateSched({ intervalAmount: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-16 bg-surface-deep border border-border-default rounded-md px-2.5 py-1.5 text-xs text-text-primary text-center focus:outline-none focus:border-border-strong [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <SelectField value={schedState.intervalUnit} onChange={(v) => updateSched({ intervalUnit: v as IntervalUnit })}>
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </SelectField>
                </div>
              )}

              {/* Daily: time picker */}
              {schedState.frequency === 'daily' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-tertiary">at</span>
                  <SelectField value={schedState.hour} onChange={(v) => updateSched({ hour: parseInt(v) })}>
                    {HOURS.map((h) => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </SelectField>
                </div>
              )}

              {/* Weekly: day checkboxes + time */}
              {schedState.frequency === 'weekly' && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1">
                    {DAY_LABELS.map((label, i) => {
                      const active = schedState.days.includes(i);
                      return (
                        <button
                          key={i}
                          onClick={() => {
                            const next = active
                              ? schedState.days.filter((d) => d !== i)
                              : [...schedState.days, i];
                            // Ensure at least one day selected
                            if (next.length > 0) updateSched({ days: next });
                          }}
                          className={`w-7 h-7 rounded-md text-[11px] font-medium transition-colors ${
                            active
                              ? 'bg-bronze-600/80 text-white border border-bronze-500/60'
                              : 'bg-surface-deep text-text-tertiary border border-border-default hover:border-border-strong hover:text-text-secondary'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-tertiary">at</span>
                    <SelectField value={schedState.hour} onChange={(v) => updateSched({ hour: parseInt(v) })}>
                      {HOURS.map((h) => (
                        <option key={h.value} value={h.value}>{h.label}</option>
                      ))}
                    </SelectField>
                  </div>
                </div>
              )}

              <p className="mt-2.5 text-xs text-text-chrome font-mono font-semibold">{form.schedule}</p>
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
