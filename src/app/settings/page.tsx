"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BotIcon,
  DownloadIcon,
  PaletteIcon,
  BellIcon,
  InfoIcon,
  CircleHelpIcon,
  PlusIcon,
  XIcon,
  SearchIcon,
  LoaderIcon,
  CheckIcon,
  PlugIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { isElectron } from "@/lib/utils";
import type { ProqSettings, McpServerInfo } from "@/lib/types";
import { Select } from "@/components/ui/select";
import { useShellActions } from "@/components/ClientShell";

type SettingsSection =
  | "about"
  | "appearance"
  | "agent"
  | "mcp-servers"
  | "updates"
  | "notifications";

const BASE_SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
  electronOnly?: boolean;
}[] = [
  { id: "about", label: "About", icon: <InfoIcon className="w-4 h-4" /> },
  {
    id: "appearance",
    label: "Appearance",
    icon: <PaletteIcon className="w-4 h-4" />,
  },
  { id: "agent", label: "Agent", icon: <BotIcon className="w-4 h-4" /> },
  {
    id: "mcp-servers",
    label: "MCP Servers",
    icon: <PlugIcon className="w-4 h-4" />,
  },
  {
    id: "updates",
    label: "Updates",
    icon: <DownloadIcon className="w-4 h-4" />,
    electronOnly: true,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: <BellIcon className="w-4 h-4" />,
  },
];

const SECTIONS = BASE_SECTIONS.filter((s) => !s.electronOnly || isElectron);

export default function SettingsPage() {
  const { sidebarCollapsed, expandSidebar } = useShellActions();
  const [settings, setSettings] = useState<ProqSettings | null>(null);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("about");
  const [detectingBin, setDetectingBin] = useState(false);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [webUpdate, setWebUpdate] = useState<{ available: boolean; count: number } | null>(null);
  const [shellUpdateReady, setShellUpdateReady] = useState(false);
  const [shellUpdateVersion, setShellUpdateVersion] = useState<string | null>(null);
  const [globalMcps, setGlobalMcps] = useState<McpServerInfo[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const isScrollingTo = useRef(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then(setSettings)
      .catch(console.error);

    fetch("/api/settings/mcp-servers")
      .then((res) => res.json())
      .then((data) => setGlobalMcps(data.servers || []))
      .catch(console.error);

    // Listen for background shell update downloads
    if (isElectron && window.proqDesktop) {
      const cleanup = window.proqDesktop.onShellUpdateDownloaded((_e, result) => {
        setShellUpdateReady(true);
        setShellUpdateVersion(result.version);
      });
      return cleanup;
    }
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
      const isDark = value === "dark" || (value === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
      localStorage.setItem("theme", value as string);
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
        <div className="text-text-tertiary text-sm">Loading settings...</div>
      </div>
    );
  }

  const webhooks = Array.isArray(settings.webhooks) ? settings.webhooks : [];

  return (
    <>
      {/* Top bar */}
      <header className={`h-12 bg-surface-topbar border-b border-border-default flex items-center px-6 flex-shrink-0 ${isElectron ? 'electron-drag' : ''}`}>
        {sidebarCollapsed && (
          <button
            onClick={expandSidebar}
            className={`mr-3 p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-hover ${isElectron ? 'ml-[60px]' : ''}`}
            title="Expand sidebar"
          >
            <PanelLeftOpenIcon className="w-4 h-4" />
          </button>
        )}
        <h1 className="text-sm font-semibold text-text-primary">Settings</h1>
      </header>

      {/* Sidebar + scrolling content */}
      <div className="flex-1 flex min-h-0">
        {/* Jump-to sidebar */}
        <nav className="w-48 flex-shrink-0 py-3 overflow-y-auto border-r border-border-default bg-surface-topbar">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-xs relative ${
                activeSection === s.id
                  ? "text-text-primary bg-surface-hover/50"
                  : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover/40"
              }`}
            >
              {activeSection === s.id && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-bronze-700 dark:bg-bronze-600" />
              )}
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>

        {/* All sections flow vertically */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-surface-deep">
          <div className="px-8 py-6 pb-[100px] max-w-2xl space-y-8">
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
              <SectionCard>
                <p className="text-sm text-text-secondary leading-relaxed mb-2">
                  A task board that runs your coding agents. You write tasks,
                  agents do the work, you review and merge. proq is a kanban
                  board that launches coding agents, one per task,
                  against your actual codebase.
                </p>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Internally it&apos;s a process manager — local, self-contained,
                  no external services. It works with whatever agent config, MCPs,
                  and subagents you already have.
                </p>
                <p className="text-xs text-text-tertiary mb-1">
                  Version {settings.version ?? "…"}
                </p>
                <p className="text-xs text-text-tertiary">
                  Vibed with ♥ by{" "}
                  <a
                    href="https://brian.online"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bronze-700 dark:text-bronze-400 hover:underline"
                  >
                    brian.online
                  </a>{" "}
                  &mdash; 0xc00010ff on{" "}
                  <a
                    href="https://x.com/0xc00010ff"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bronze-700 dark:text-bronze-400 hover:underline"
                  >
                    X
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://github.com/0xc00010ff"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bronze-700 dark:text-bronze-400 hover:underline"
                  >
                    GitHub
                  </a>
                </p>
              </SectionCard>
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
              <SectionCard>
                <Field label="Theme">
                  <Select
                    value={settings.theme}
                    onChange={(v) => update("theme", v as "dark" | "light" | "system")}
                    options={[
                      { value: "system", label: "System" },
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" },
                    ]}
                  />
                </Field>
              </SectionCard>
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
              <SectionCard>
                <Field label="Coding agent">
                  <div className="flex items-center gap-2">
                    <div
                      className={`${inputClass} flex-1 opacity-50 cursor-not-allowed select-none`}
                    >
                      Claude Code
                    </div>
                    <Tooltip text="Currently built for Claude Code. Codex/OpenCode coming soon.">
                      <CircleHelpIcon className="w-4 h-4 text-text-tertiary" />
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
                      className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs bg-surface-modal border border-border-default text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-50"
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
                    <p className={`text-xs mt-1.5 ${detectMessage.startsWith("Found") ? "text-green-500" : "text-text-secondary"}`}>
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
                {settings.agentRenderMode === "structured" && (
                  <Field
                    label="Allow agent interrupts"
                    hint="Send messages while the agent is working without a confirmation prompt. The agent will be stopped and restarted with your message."
                  >
                    <Toggle
                      checked={settings.allowAgentInterrupts}
                      onChange={(v) => update("allowAgentInterrupts", v)}
                    />
                  </Field>
                )}
                <Field
                  label="Allow Chrome access"
                  hint="Give agents access to Chrome. Requires Chrome integration to be set up in Claude CLI first with `claude --chrome`."
                >
                  <Toggle
                    checked={settings.useChrome}
                    onChange={(v) => update("useChrome", v)}
                  />
                </Field>
              </SectionCard>
              <SectionCard>
                <Field
                  label="Global system prompt"
                  hint="Custom instructions injected into every agent runner across all projects. Use this for preferences that apply universally."
                >
                  <textarea
                    value={settings.systemPromptAdditions}
                    onChange={(e) => update("systemPromptAdditions", e.target.value)}
                    placeholder="e.g. Always use TypeScript strict mode. Prefer functional components..."
                    rows={4}
                    className={`${inputClass} resize-y min-h-[80px]`}
                  />
                </Field>
              </SectionCard>
              <h3 className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mt-6 mb-2 px-1">Experimental</h3>
              <SectionCard>
                <Field
                  label="Agent designer"
                  hint="Show the Agents tab for designing and managing per-project agents with custom roles and system prompts."
                >
                  <Toggle
                    checked={settings.enableAgentDesigner}
                    onChange={(v) => update("enableAgentDesigner", v)}
                  />
                </Field>
              </SectionCard>
            </section>

            {/* MCP Servers */}
            <section
              ref={(el) => {
                sectionRefs.current["mcp-servers"] = el;
              }}
              id="settings-mcp-servers"
            >
              <SectionHeading
                icon={<PlugIcon className="w-4 h-4" />}
                label="MCP Servers"
              />
              <SectionCard>
                <Field
                  label="Globally installed"
                  hint="These MCP servers are installed globally in Claude Code and available to all projects and agents. Ask Claude to edit or add MCPs, or run claude mcp add in your terminal."
                >
                  {globalMcps.length === 0 ? (
                    <p className="text-xs text-text-tertiary">
                      No global MCP servers configured.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {globalMcps.map((server) => (
                        <McpServerRow key={server.name} server={server} />
                      ))}
                    </div>
                  )}
                </Field>
              </SectionCard>
            </section>

            {/* Updates — Electron only */}
            {isElectron && (
              <section
                ref={(el) => {
                  sectionRefs.current.updates = el;
                }}
                id="settings-updates"
              >
                <SectionHeading
                  icon={<DownloadIcon className="w-4 h-4" />}
                  label="Updates"
                />
                <SectionCard>
                  <Field
                    label="Auto-update"
                    hint="Automatically check for updates in the background."
                  >
                    <Toggle
                      checked={settings.autoUpdate}
                      onChange={(v) => update("autoUpdate", v)}
                    />
                  </Field>
                  <Field label="Check for updates">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        {(webUpdate?.available || shellUpdateReady) ? (
                          <button
                            onClick={() => {
                              if (shellUpdateReady) {
                                // Desktop app update replaces the whole binary —
                                // web updates get picked up on next launch via splash
                                window.proqDesktop?.installShellUpdate();
                              } else if (webUpdate?.available) {
                                window.proqDesktop?.applyAndRestart();
                              }
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs bg-bronze-600 text-zinc-950 hover:bg-bronze-500 font-medium"
                          >
                            <DownloadIcon className="w-3.5 h-3.5" />
                            Restart to update
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              setCheckingUpdates(true);
                              setWebUpdate(null);
                              try {
                                const [webResult] = await Promise.all([
                                  window.proqDesktop!.checkUpdates(),
                                  window.proqDesktop!.checkShellUpdate(),
                                ]);
                                setWebUpdate({
                                  available: webResult.available,
                                  count: webResult.commits?.length || 0,
                                });
                              } catch {
                                setWebUpdate(null);
                              } finally {
                                setCheckingUpdates(false);
                              }
                            }}
                            disabled={checkingUpdates}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs bg-surface-modal border border-border-default text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-50"
                          >
                            {checkingUpdates ? (
                              <LoaderIcon className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <SearchIcon className="w-3.5 h-3.5" />
                            )}
                            Check for Updates
                          </button>
                        )}
                        {webUpdate && !webUpdate.available && !shellUpdateReady && (
                          <span className="flex items-center gap-1 text-xs text-green-500">
                            <CheckIcon className="w-3.5 h-3.5" />
                            You&apos;re up to date
                          </span>
                        )}
                      </div>
                      {(webUpdate?.available || shellUpdateReady) && (
                        <p className="text-xs text-text-secondary">
                          {[
                            webUpdate?.available && `${webUpdate.count} app update${webUpdate.count !== 1 ? "s" : ""}`,
                            shellUpdateReady && `desktop update${shellUpdateVersion ? ` (${shellUpdateVersion})` : ""}`,
                          ].filter(Boolean).join(" and ")}{" "}
                          available
                        </p>
                      )}
                    </div>
                  </Field>
                </SectionCard>
              </section>
            )}

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
              <SectionCard className="opacity-50 pointer-events-none select-none">
                <p className="text-xs text-text-tertiary italic mb-4">
                  Notifications coming soon.
                </p>
                <div className="space-y-4">
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
                            className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
                            tabIndex={-1}
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary py-1">
                        <PlusIcon className="w-3.5 h-3.5" />
                        Add webhook
                      </button>
                    </div>
                  </Field>
                </div>
              </SectionCard>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Shared styles ──

const inputClass =
  "w-full bg-surface-inset border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-lazuli";

const inputClassMono =
  inputClass +
  " font-mono placeholder:text-text-placeholder";

// ── Reusable components ──

function SectionHeading({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-text-tertiary">{icon}</span>
      <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        {label}
      </h2>
    </div>
  );
}

function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border-default bg-surface-secondary p-5 space-y-4 mb-3 ${className ?? ""}`}
    >
      {children}
    </div>
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
      <label className="block text-sm font-medium text-text-secondary mb-1">
        {label}
      </label>
      {hint && (
        <p className="text-xs text-text-tertiary mb-2">{hint}</p>
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
          ? "bg-bronze-700 dark:bg-bronze-600"
          : "bg-zinc-300 dark:bg-border-strong"
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

function McpServerRow({ server, dimmed }: { server: McpServerInfo; dimmed?: boolean }) {
  const detail =
    server.url ||
    [server.command, ...(server.args || [])].join(" ");
  return (
    <div
      className={`flex items-center gap-2.5 py-1.5 px-1 rounded ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <PlugIcon className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
      <span className="text-sm text-text-primary font-medium truncate">
        {server.name}
      </span>
      <span className="text-[10px] font-mono text-text-tertiary bg-surface-inset px-1.5 py-0.5 rounded flex-shrink-0">
        {server.type}
      </span>
      {detail && (
        <span className="text-xs text-text-quaternary font-mono truncate ml-auto">
          {detail}
        </span>
      )}
    </div>
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
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded bg-surface-modal border border-border-default text-xs text-text-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
        {text}
      </span>
    </span>
  );
}
