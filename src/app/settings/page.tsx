"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  SaveIcon,
  CheckIcon,
  Loader2Icon,
  MonitorIcon,
  BotIcon,
  GitBranchIcon,
  PaletteIcon,
  BellIcon,
  CogIcon,
  InfoIcon,
} from "lucide-react";
import type { ProqSettings } from "@/lib/types";

type SettingsSection =
  | "system"
  | "agent"
  | "git"
  | "appearance"
  | "notifications"
  | "process"
  | "about";

const SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: "about", label: "About", icon: <InfoIcon className="w-4 h-4" /> },
  { id: "system", label: "System", icon: <MonitorIcon className="w-4 h-4" /> },
  { id: "agent", label: "Agent", icon: <BotIcon className="w-4 h-4" /> },
  { id: "process", label: "Process", icon: <CogIcon className="w-4 h-4" /> },
  { id: "git", label: "Git", icon: <GitBranchIcon className="w-4 h-4" /> },
  {
    id: "appearance",
    label: "Appearance",
    icon: <PaletteIcon className="w-4 h-4" />,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: <BellIcon className="w-4 h-4" />,
  },
];

function NotImplemented({ message }: { message?: string }) {
  return (
    <p className="text-red-400 italic text-sm mb-4">
      {message || "Settings on this page are not yet implemented."}
    </p>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<ProqSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("about");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const isScrollingTo = useRef(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then(setSettings)
      .catch(console.error);
  }, []);

  // Track which section is visible on scroll
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isScrollingTo.current) return;

      const containerTop = container.scrollTop;
      let current: SettingsSection = "system";

      for (const section of SECTIONS) {
        const el = sectionRefs.current[section.id];
        if (el) {
          // Section is "active" when its top is within 100px of the scroll container top
          if (el.offsetTop - container.offsetTop <= containerTop + 100) {
            current = section.id;
          }
        }
      }
      setActiveSection(current);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = useCallback((id: SettingsSection) => {
    const el = sectionRefs.current[id];
    if (!el) return;

    setActiveSection(id);
    isScrollingTo.current = true;

    el.scrollIntoView({ block: "start" });

    requestAnimationFrame(() => {
      isScrollingTo.current = false;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);

        if (updated.theme === "light") {
          document.documentElement.classList.remove("dark");
          localStorage.setItem("theme", "light");
        } else {
          document.documentElement.classList.add("dark");
          localStorage.setItem("theme", "dark");
        }

        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      console.error("Failed to save settings:", e);
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const update = <K extends keyof ProqSettings>(
    key: K,
    value: ProqSettings[K],
  ) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  };

  if (!settings) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading settings...</div>
      </div>
    );
  }

  return (
    <>
      {/* Top bar */}
      <header className="h-16 bg-surface-base flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex flex-col justify-center">
          <h1 className="text-lg font-semibold text-bronze-900 dark:text-zinc-100">
            Settings
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Configure your proq instance
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-bronze-800 dark:bg-zinc-700 text-white hover:bg-bronze-900 dark:hover:bg-zinc-600 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          {saving ? (
            <Loader2Icon className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <CheckIcon className="w-4 h-4" />
          ) : (
            <SaveIcon className="w-4 h-4" />
          )}
          {saved ? "Saved" : "Save settings"}
        </button>
      </header>

      {/* Sidebar + scrolling content */}
      <div className="flex-1 flex min-h-0">
        {/* Jump-to sidebar */}
        <nav className="w-52 flex-shrink-0 py-2 overflow-y-auto">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors relative ${
                activeSection === s.id
                  ? "text-bronze-900 dark:text-zinc-100 bg-bronze-300 dark:bg-zinc-800/50"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-bronze-800 dark:hover:text-zinc-200 hover:bg-bronze-300/60 dark:hover:bg-zinc-800/40"
              }`}
            >
              {activeSection === s.id && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-bronze-600 dark:bg-bronze-500" />
              )}
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>

        {/* All sections flow vertically */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="px-8 py-6 pb-[100px] max-w-3xl space-y-12">
            {/* About */}
            <section
              ref={(el) => {
                sectionRefs.current.about = el;
              }}
              id="settings-about"
            >
              <SectionHeading
                icon={<InfoIcon className="w-4 h-4" />}
                label="About"
              />
              <p className="text-sm text-bronze-700 dark:text-zinc-400 leading-relaxed mb-4">
                proq is a vibe coding IDE built for shipping quality software.
                It's a kanban board for CLI-based agentic coding agents. It was
                designed to make us better at our job: defining what we want.
                Under the hood it's a tmux task runner that bolts up to your
                favorite command line agent. It works out of the box with
                subagents, git, worktrees, and whatever config you bring along.
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mb-1">
                This is version 0.1.0
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                Vibed with ♥ by{" "}
                <a
                  href="https://brian.online"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bronze-600 dark:text-bronze-400 hover:underline"
                >
                  brian.online
                </a>{" "}
                &mdash; 0xc00010ff on{" "}
                <a
                  href="https://x.com/0xc00010ff"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bronze-600 dark:text-bronze-400 hover:underline"
                >
                  X
                </a>{" "}
                and{" "}
                <a
                  href="https://github.com/0xc00010ff"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bronze-600 dark:text-bronze-400 hover:underline"
                >
                  GitHub
                </a>
              </p>
            </section>

            {/* System */}
            <section
              ref={(el) => {
                sectionRefs.current.system = el;
              }}
              id="settings-system"
            >
              <SectionHeading
                icon={<MonitorIcon className="w-4 h-4" />}
                label="System"
              />
              <NotImplemented />
              <div className="space-y-4">
                <Field
                  label="Port"
                  hint="The port that proq itself runs on. Requires restart to take effect."
                >
                  <input
                    type="number"
                    value={settings.port}
                    onChange={(e) =>
                      update("port", parseInt(e.target.value) || 7331)
                    }
                    className={inputClass}
                  />
                </Field>
              </div>
            </section>

            {/* Agent */}
            <section
              ref={(el) => {
                sectionRefs.current.agent = el;
              }}
              id="settings-agent"
            >
              <SectionHeading
                icon={<BotIcon className="w-4 h-4" />}
                label="Agent"
              />
              <NotImplemented />
              <div className="space-y-4">
                <Field
                  label="CLI tool path"
                  hint="Path or command name for the Claude CLI."
                >
                  <input
                    type="text"
                    value={settings.claudeBin}
                    onChange={(e) => update("claudeBin", e.target.value)}
                    placeholder="claude"
                    className={inputClassMono}
                  />
                </Field>
                <Field
                  label="Default model"
                  hint="Model to use for agent tasks. Leave empty for tool default."
                >
                  <input
                    type="text"
                    value={settings.defaultModel}
                    onChange={(e) => update("defaultModel", e.target.value)}
                    placeholder="Tool default"
                    className={inputClassMono}
                  />
                </Field>
                <Field
                  label="System prompt additions"
                  hint="Extra instructions appended to every agent prompt."
                >
                  <textarea
                    value={settings.systemPromptAdditions}
                    onChange={(e) =>
                      update("systemPromptAdditions", e.target.value)
                    }
                    rows={4}
                    className={inputClassMono}
                  />
                </Field>
                <Field
                  label="Execution mode"
                  hint="Sequential runs one task at a time; parallel runs all queued tasks."
                >
                  <select
                    value={settings.executionMode}
                    onChange={(e) =>
                      update(
                        "executionMode",
                        e.target.value as "sequential" | "parallel",
                      )
                    }
                    className={inputClass}
                  >
                    <option value="sequential">Sequential</option>
                    <option value="parallel">Parallel</option>
                  </select>
                </Field>
              </div>
            </section>

            {/* Process */}
            <section
              ref={(el) => {
                sectionRefs.current.process = el;
              }}
              id="settings-process"
            >
              <SectionHeading
                icon={<CogIcon className="w-4 h-4" />}
                label="Process"
              />
              <NotImplemented />
              <div className="space-y-4">
                <Field
                  label="Cleanup delay"
                  hint="Minutes before completed agent sessions are cleaned up."
                >
                  <input
                    type="number"
                    value={settings.cleanupDelay}
                    onChange={(e) =>
                      update("cleanupDelay", parseInt(e.target.value) || 60)
                    }
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Task poll interval"
                  hint="Seconds between task status refreshes."
                >
                  <input
                    type="number"
                    value={settings.taskPollInterval}
                    onChange={(e) =>
                      update("taskPollInterval", parseInt(e.target.value) || 5)
                    }
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Deleted task retention"
                  hint="Hours to keep deleted tasks for undo."
                >
                  <input
                    type="number"
                    value={settings.deletedTaskRetention}
                    onChange={(e) =>
                      update(
                        "deletedTaskRetention",
                        parseInt(e.target.value) || 24,
                      )
                    }
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Terminal scrollback"
                  hint="Scrollback buffer size in KB."
                >
                  <input
                    type="number"
                    value={settings.terminalScrollback}
                    onChange={(e) =>
                      update(
                        "terminalScrollback",
                        parseInt(e.target.value) || 50,
                      )
                    }
                    className={inputClass}
                  />
                </Field>
              </div>
            </section>

            {/* Git */}
            <section
              ref={(el) => {
                sectionRefs.current.git = el;
              }}
              id="settings-git"
            >
              <SectionHeading
                icon={<GitBranchIcon className="w-4 h-4" />}
                label="Git"
              />
              <NotImplemented />
              <div className="space-y-4">
                <Field label="Auto-commit">
                  <Toggle
                    checked={settings.autoCommit}
                    onChange={(v) => update("autoCommit", v)}
                  />
                </Field>
                <Field label="Commit style" hint="e.g. conventional commits">
                  <input
                    type="text"
                    value={settings.commitStyle}
                    onChange={(e) => update("commitStyle", e.target.value)}
                    placeholder="e.g. conventional commits"
                    className={inputClass}
                  />
                </Field>
                <Field label="Auto-push">
                  <Toggle
                    checked={settings.autoPush}
                    onChange={(v) => update("autoPush", v)}
                  />
                </Field>
                <Field label="Show git branches">
                  <Toggle
                    checked={settings.showGitBranches}
                    onChange={(v) => update("showGitBranches", v)}
                  />
                </Field>
              </div>
            </section>

            {/* Appearance */}
            <section
              ref={(el) => {
                sectionRefs.current.appearance = el;
              }}
              id="settings-appearance"
            >
              <SectionHeading
                icon={<PaletteIcon className="w-4 h-4" />}
                label="Appearance"
              />
              <p className="text-red-400 italic text-sm mb-4">
                Theme is active. Other appearance settings coming soon.
              </p>
              <div className="space-y-4">
                <Field label="Theme">
                  <select
                    value={settings.theme}
                    onChange={(e) =>
                      update("theme", e.target.value as "dark" | "light")
                    }
                    className={inputClass}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </Field>
              </div>
            </section>

            {/* Notifications */}
            <section
              ref={(el) => {
                sectionRefs.current.notifications = el;
              }}
              id="settings-notifications"
            >
              <SectionHeading
                icon={<BellIcon className="w-4 h-4" />}
                label="Notifications"
              />
              <NotImplemented />
              <div className="space-y-4">
                <Field label="Notification method">
                  <select
                    value={settings.notificationMethod}
                    onChange={(e) =>
                      update(
                        "notificationMethod",
                        e.target.value as ProqSettings["notificationMethod"],
                      )
                    }
                    className={inputClass}
                  >
                    <option value="none">None</option>
                    <option value="slack">Slack</option>
                    <option value="system">System</option>
                    <option value="sound">Sound</option>
                  </select>
                </Field>
                <Field
                  label="Slack channel"
                  hint="Channel name for task completion notifications."
                >
                  <input
                    type="text"
                    value={settings.slackChannel}
                    onChange={(e) => update("slackChannel", e.target.value)}
                    placeholder="#dev-updates"
                    className={inputClassMono}
                  />
                </Field>
                <Field
                  label="Webhooks"
                  hint="JSON array of webhook URLs to notify on task events."
                >
                  <textarea
                    value={settings.webhooks}
                    onChange={(e) => update("webhooks", e.target.value)}
                    rows={4}
                    placeholder='[{"url": "https://..."}]'
                    className={inputClassMono}
                  />
                </Field>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Shared styles ──

const inputClass =
  "w-full bg-bronze-100 dark:bg-zinc-900 border border-border-default rounded-md px-3 py-2 text-sm text-bronze-900 dark:text-zinc-100 focus:outline-none focus:border-steel";

const inputClassMono =
  inputClass +
  " font-mono placeholder:text-zinc-400 dark:placeholder:text-zinc-600";

// ── Reusable components ──

function SectionHeading({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <h2 className="text-base font-semibold text-bronze-800 dark:text-zinc-200 uppercase tracking-wider mb-1 flex items-center gap-2">
      {icon}
      {label}
    </h2>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-bronze-700 dark:text-zinc-300 mb-1">
        {label}
      </label>
      {hint && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">{hint}</p>
      )}
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked
          ? "bg-bronze-600 dark:bg-bronze-500"
          : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
