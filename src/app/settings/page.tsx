'use client';

import { useState, useEffect, useCallback } from 'react';
import { SaveIcon, CheckIcon, Loader2Icon } from 'lucide-react';
import type { ProqSettings } from '@/lib/types';

export default function SettingsPage() {
  const [settings, setSettings] = useState<ProqSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then(setSettings)
      .catch(console.error);
  }, []);

  const handleSave = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);

        // Apply theme change immediately
        if (updated.theme === 'light') {
          document.documentElement.classList.remove('dark');
          localStorage.setItem('theme', 'light');
        } else {
          document.documentElement.classList.add('dark');
          localStorage.setItem('theme', 'dark');
        }

        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      console.error('Failed to save settings:', e);
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (!settings) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto py-10 px-6">
        <h1 className="text-2xl font-semibold text-gunmetal-900 dark:text-zinc-100 mb-1">Settings</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">Configure your proq instance.</p>

        <div className="space-y-8">
          {/* Appearance */}
          <section>
            <h2 className="text-sm font-medium text-gunmetal-800 dark:text-zinc-200 uppercase tracking-wider mb-4">Appearance</h2>
            <div className="space-y-4">
              <Field label="Theme">
                <select
                  value={settings.theme}
                  onChange={(e) => setSettings({ ...settings, theme: e.target.value as 'dark' | 'light' })}
                  className="w-full bg-gunmetal-100 dark:bg-zinc-900 border border-border-default rounded-md px-3 py-2 text-sm text-gunmetal-900 dark:text-zinc-100 focus:outline-none focus:border-steel"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </Field>
            </div>
          </section>

          {/* Agent */}
          <section>
            <h2 className="text-sm font-medium text-gunmetal-800 dark:text-zinc-200 uppercase tracking-wider mb-4">Agent</h2>
            <div className="space-y-4">
              <Field label="Claude binary path" hint="Path or command name for the Claude CLI. Defaults to &quot;claude&quot;.">
                <input
                  type="text"
                  value={settings.claudeBin}
                  onChange={(e) => setSettings({ ...settings, claudeBin: e.target.value })}
                  placeholder="claude"
                  className="w-full bg-gunmetal-100 dark:bg-zinc-900 border border-border-default rounded-md px-3 py-2 text-sm font-mono text-gunmetal-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-steel"
                />
              </Field>
            </div>
          </section>

          {/* Notifications */}
          <section>
            <h2 className="text-sm font-medium text-gunmetal-800 dark:text-zinc-200 uppercase tracking-wider mb-4">Notifications</h2>
            <div className="space-y-4">
              <Field label="OpenClaw binary path" hint="Path to the OpenClaw CLI for Slack notifications. Leave empty to disable.">
                <input
                  type="text"
                  value={settings.openclawBin}
                  onChange={(e) => setSettings({ ...settings, openclawBin: e.target.value })}
                  placeholder="/usr/local/bin/openclaw"
                  className="w-full bg-gunmetal-100 dark:bg-zinc-900 border border-border-default rounded-md px-3 py-2 text-sm font-mono text-gunmetal-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-steel"
                />
              </Field>
              <Field label="Slack channel" hint="Channel name for task completion notifications.">
                <input
                  type="text"
                  value={settings.slackChannel}
                  onChange={(e) => setSettings({ ...settings, slackChannel: e.target.value })}
                  placeholder="#dev-updates"
                  className="w-full bg-gunmetal-100 dark:bg-zinc-900 border border-border-default rounded-md px-3 py-2 text-sm font-mono text-gunmetal-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-steel"
                />
              </Field>
            </div>
          </section>
        </div>

        {/* Save button */}
        <div className="mt-10 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-gunmetal-800 dark:bg-zinc-700 text-white hover:bg-gunmetal-900 dark:hover:bg-zinc-600 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {saving ? (
              <Loader2Icon className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <CheckIcon className="w-4 h-4" />
            ) : (
              <SaveIcon className="w-4 h-4" />
            )}
            {saved ? 'Saved' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gunmetal-700 dark:text-zinc-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">{hint}</p>}
      {children}
    </div>
  );
}
