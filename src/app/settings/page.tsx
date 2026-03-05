"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BotIcon,
  GitBranchIcon,
  PaletteIcon,
  BellIcon,
  InfoIcon,
  CircleHelpIcon,
  PlusIcon,
  XIcon,
  SearchIcon,
  LoaderIcon,
} from "lucide-react";
import type { ProqSettings } from "@/lib/types";
import { Select } from "@/components/ui/select";

type SettingsSection =
  | "about"
  | "appearance"
  | "agent"
  | "git"
  | "notifications";

const SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: "about", label: "About", icon: <InfoIcon className="w-4 h-4" /> },
  {
    id: "appearance",
    label: "Appearance",
    icon: <PaletteIcon className="w-4 h-4" />,
  },
  { id: "agent", label: "Agent", icon: <BotIcon className="w-4 h-4" /> },
  { id: "git", label: "Git", icon: <GitBranchIcon className="w-4 h-4" /> },
  {
    id: "notifications",
    label: "Notifications",
    icon: <BellIcon className="w-4 h-4" />,
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<ProqSettings | null>(null);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("about");
  const [detectingBin, setDetectingBin] = useState(false);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
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
      let current: SettingsSection = "about";

      for (const section of SECTIONS) {
        const el = sectionRefs.current[section.id];
        if (el) {
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

  const update = <K extends keyof ProqSettings>(
    key: K,
    value: ProqSettings[K],
  ) => {
    if (!settings) return;
    const next = { ...settings, [key]: value };
    setSettings(next);

    // Apply theme immediately
    if (key === "theme") {
      const isDark = value === "dark";
      document.documentElement.classList.toggle("dark", isDark);
      localStorage.setItem("theme", isDark ? "dark" : "light");
    }

    // Persist to API
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    }).catch((e) => console.error("Failed to save setting:", e));
  };

  if (!settings) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading settings...</div>
      </div>
    );
  }

  const webhooks = Array.isArray(settings.webhooks) ? settings.webhooks : [];

  return (
    <>
      {/* Top bar */}
      <header className="h-16 bg-surface-base flex items-center px-6 flex-shrink-0">
        <div className="flex flex-col justify-center">
          <h1 className="text-lg font-semibold text-bronze-900 dark:text-zinc-100">
            Settings
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Configure your proq instance
          </p>
        </div>
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
              <p className="text-sm text-bronze-700 dark:text-zinc-400 leading-relaxed mb-2">
                A task board that runs your coding agents. You write tasks,
                agents do the work, you review and merge. proq is a kanban
                board that launches CLI coding agents in tmux, one per task,
                against your actual codebase.
              </p>
              <p className="text-sm text-bronze-700 dark:text-zinc-400 leading-relaxed mb-4">
                Internally it&apos;s a process manager — local, self-contained,
                no external services. It works with whatever agent config, MCPs,
                and subagents you already have.
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
              <div className="space-y-4">
                <Field label="Theme">
                  <Select
                    value={settings.theme}
                    onChange={(v) => update("theme", v as "dark" | "light")}
                    options={[
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" },
                    ]}
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
              <div className="space-y-4">
                <Field label="Coding agent">
                  <div className="flex items-center gap-2">
                    <div
                      className={`${inputClass} flex-1 opacity-50 cursor-not-allowed select-none`}
                    >
                      Claude Code
                    </div>
                    <Tooltip text="Currently built for Claude Code. Codex/OpenCode coming soon.">
                      <CircleHelpIcon className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                    </Tooltip>
                  </div>
                </Field>
                <Field
                  label="Claude binary"
                  hint="Path to the Claude Code CLI. Auto-detect finds it from your shell profile, nvm, or homebrew."
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={settings.claudeBin}
                      onChange={(e) => update("claudeBin", e.target.value)}
                      placeholder="claude"
                      className={`${inputClassMono} flex-1`}
                    />
                    <button
                      onClick={async () => {
                        setDetectingBin(true);
                        setDetectMessage(null);
                        try {
                          const res = await fetch("/api/settings/detect-claude-bin", { method: "POST" });
                          const data = await res.json();
                          setSettings((s) => s ? { ...s, claudeBin: data.claudeBin } : s);
                          setDetectMessage(data.message);
                        } catch {
                          setDetectMessage("Detection failed");
                        } finally {
                          setDetectingBin(false);
                        }
                      }}
                      disabled={detectingBin}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm bg-bronze-200 dark:bg-zinc-800 border border-border-default text-bronze-800 dark:text-zinc-200 hover:bg-bronze-300 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                    >
                      {detectingBin ? (
                        <LoaderIcon className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <SearchIcon className="w-3.5 h-3.5" />
                      )}
                      Auto-detect
                    </button>
                  </div>
                  {detectMessage && (
                    <p className={`text-xs mt-1.5 ${detectMessage.startsWith("Found") ? "text-green-500" : "text-zinc-400"}`}>
                      {detectMessage}
                    </p>
                  )}
                </Field>
                <Field
                  label="Agent render mode"
                  hint="Chat shows a formatted chat window like Claude Code desktop. CLI shows a raw terminal running the Claude Code CLI."
                >
                  <Select
                    value={settings.agentRenderMode}
                    onChange={(v) =>
                      update("agentRenderMode", v as "cli" | "structured")
                    }
                    options={[
                      { value: "structured", label: "Chat" },
                      { value: "cli", label: "CLI" },
                    ]}
                  />
                </Field>
                {settings.agentRenderMode === "structured" && (
                  <Field
                    label="Show costs"
                    hint="Display a calculated hypothetical token cost per turn. If you're on the Claude subscription plan, you are not billed anything extra — this is just data returned by Claude."
                  >
                    <Toggle
                      checked={settings.showCosts}
                      onChange={(v) => update("showCosts", v)}
                    />
                  </Field>
                )}
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
              <div className="space-y-4">
                <Field label="Default branch" hint="Default branch selection coming soon.">
                  <input
                    type="text"
                    value="main"
                    disabled
                    className={`${inputClass} opacity-50 cursor-not-allowed`}
                  />
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
              <p className="text-xs text-zinc-400 dark:text-zinc-500 italic mb-4">
                Notifications coming soon.
              </p>
              <div className="space-y-4 opacity-50 pointer-events-none select-none">
                <Field label="Sounds">
                  <Toggle
                    checked={settings.soundNotifications}
                    onChange={(v) => update("soundNotifications", v)}
                  />
                </Field>
                <Field label="Local notifications">
                  <Toggle
                    checked={settings.localNotifications}
                    onChange={(v) => update("localNotifications", v)}
                  />
                </Field>
                <Field label="Webhooks" hint="URLs to notify on task events.">
                  <div className="space-y-2">
                    {webhooks.map((url, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={url}
                          readOnly
                          className={`${inputClassMono} flex-1`}
                        />
                        <button
                          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400"
                          tabIndex={-1}
                        >
                          <XIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 py-1">
                      <PlusIcon className="w-3.5 h-3.5" />
                      Add webhook
                    </button>
                  </div>
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

function Tooltip({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  return (
    <span className="relative group">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded bg-zinc-800 dark:bg-zinc-700 text-xs text-zinc-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
        {text}
      </span>
    </span>
  );
}
