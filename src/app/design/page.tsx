"use client";

import { useState, useEffect } from "react";
import { MoonIcon, SunIcon, Loader2Icon } from "lucide-react";

export default function DesignPage() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <div className="min-h-screen bg-surface-base text-text-primary overflow-y-auto">
      {/* ── Hero ── */}
      <header className="pt-20 pb-16 flex flex-col items-center text-center border-b border-border-default">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/proq-logo-vector.svg"
          alt="proq"
          width={64}
          height={64}
          className="mb-6"
        />
        <h1
          className="text-5xl text-text-primary lowercase mb-3"
          style={{ fontFamily: "var(--font-gemunu-libre)" }}
        >
          proq
        </h1>
        <p className="text-text-secondary text-sm mb-8">Design System Reference</p>

        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 text-xs text-text-tertiary hover:text-text-primary transition-colors"
        >
          {isDark ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
          Switch to {isDark ? "Light" : "Dark"}
        </button>
      </header>

      {/* ── Philosophy ── */}
      <div className="max-w-4xl mx-auto px-10">
        <div className="grid grid-cols-3 gap-4 py-12">
          {[
            { title: "Hierarchical", body: "Every surface exists at a deliberate elevation. Nothing floats without reason." },
            { title: "Intentional", body: "Color signals state, not decoration. Each accent earns its presence." },
            { title: "Restrained", body: "One pulse, one transition. The interface recedes so the work stands forward." },
          ].map(({ title, body }) => (
            <div key={title} className="border border-border-default rounded-lg p-5 bg-surface-secondary">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-bronze-600 dark:text-bronze-500 mb-2">{title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        <Divider />

        {/* ── Surface Elevation ── */}
        <Section
          title="Surface Elevation"
          description="Ten levels from terminal depth to modal apex. Surfaces stack to create spatial hierarchy."
        >
          <div className="rounded-lg border border-border-default overflow-hidden">
            {[
              { token: "surface-deep", cls: "bg-surface-deep", role: "Chat, terminals" },
              { token: "surface-base", cls: "bg-surface-base", role: "App shell, ground floor" },
              { token: "surface-inset", cls: "bg-surface-inset", role: "Input wells, recessed" },
              { token: "surface-topbar", cls: "bg-surface-topbar", role: "Topbar, board columns" },
              { token: "surface-secondary", cls: "bg-surface-secondary", role: "Sidebar, cards" },
              { token: "surface-detail", cls: "bg-surface-detail", role: "Reading surface" },
              { token: "surface-primary", cls: "bg-surface-primary", role: "Elevated highlights" },
              { token: "surface-modal", cls: "bg-surface-modal", role: "Modals, popovers" },
              { token: "surface-hover", cls: "bg-surface-hover", role: "Hover states" },
              { token: "surface-selected", cls: "bg-surface-selected", role: "Active selection" },
            ].map(({ token, cls, role }) => (
              <div key={token} className={`flex items-center justify-between px-5 py-3.5 ${cls}`}>
                <span className="font-mono text-xs text-text-secondary">{token}</span>
                <span className="text-xs text-text-tertiary">{role}</span>
              </div>
            ))}
          </div>
        </Section>

        <Divider />

        {/* ── Bronze ── */}
        <Section
          title="Bronze"
          description="The foundation of proq's visual identity. Bronze serves as the primary neutral in light mode and the warm accent thread in dark mode. It replaces standard grays to give the interface a distinct character."
        >
          <div className="flex gap-1.5">
            {[
              { step: "50", cls: "bg-bronze-50" },
              { step: "100", cls: "bg-bronze-100" },
              { step: "200", cls: "bg-bronze-200" },
              { step: "300", cls: "bg-bronze-300" },
              { step: "400", cls: "bg-bronze-400" },
              { step: "500", cls: "bg-bronze-500" },
              { step: "600", cls: "bg-bronze-600" },
              { step: "700", cls: "bg-bronze-700" },
              { step: "800", cls: "bg-bronze-800" },
              { step: "900", cls: "bg-bronze-900" },
            ].map(({ step, cls }) => (
              <div key={step} className="flex-1 text-center">
                <div className={`h-14 rounded-lg ${cls}`} />
                <span className="font-mono text-[10px] text-text-tertiary mt-1.5 block">{step}</span>
              </div>
            ))}
          </div>
        </Section>

        <Divider />

        {/* ── Action Accents ── */}
        <Section
          title="Action Accents"
          description="Four muted, imperial accents — each mapped to a specific semantic role. Warm and desaturated to blend with the bronze palette rather than compete with it."
        >
          <div className="grid grid-cols-2 gap-4">
            {[
              { name: "Lazuli", role: "Preview, info, active links", variants: [
                { label: "light", cls: "bg-lazuli-light" },
                { label: "DEFAULT", cls: "bg-lazuli" },
                { label: "dark", cls: "bg-lazuli-dark" },
              ]},
              { name: "Emerald", role: "Done, success, completion", variants: [
                { label: "light", cls: "bg-emerald-light" },
                { label: "DEFAULT", cls: "bg-emerald" },
                { label: "dark", cls: "bg-emerald-dark" },
              ]},
              { name: "Crimson", role: "Delete, error, danger", variants: [
                { label: "light", cls: "bg-crimson-light" },
                { label: "DEFAULT", cls: "bg-crimson" },
                { label: "dark", cls: "bg-crimson-dark" },
              ]},
              { name: "Gold", role: "Warning, attention, verify", variants: [
                { label: "light", cls: "bg-gold-light" },
                { label: "DEFAULT", cls: "bg-gold" },
                { label: "dark", cls: "bg-gold-dark" },
              ]},
            ].map(({ name, role, variants }) => (
              <div key={name} className="border border-border-default rounded-lg overflow-hidden bg-surface-secondary">
                <div className="flex">
                  {variants.map(({ label, cls }) => (
                    <div key={label} className={`flex-1 h-14 ${cls}`} />
                  ))}
                </div>
                <div className="px-4 py-3">
                  <p className="text-sm text-text-primary font-medium">{name}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">{role}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Divider />

        {/* ── Typography ── */}
        <Section
          title="Typography"
          description="Three typefaces, each with a clear purpose. Display for branding, sans for interface, mono for data."
        >
          <div className="space-y-8">
            <div className="border border-border-default rounded-lg p-6 bg-surface-secondary">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-3">Display — Gemunu Libre</p>
              <p className="text-4xl text-text-primary lowercase leading-tight" style={{ fontFamily: "var(--font-gemunu-libre)" }}>
                The quick brown fox jumps over the lazy dog
              </p>
            </div>
            <div className="border border-border-default rounded-lg p-6 bg-surface-secondary">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-3">Body — Geist Sans</p>
              <p className="text-lg text-text-primary leading-relaxed">
                The quick brown fox jumps over the lazy dog
              </p>
              <p className="text-sm text-text-secondary leading-relaxed mt-1">
                Used for all interface text, labels, descriptions, and body copy.
              </p>
            </div>
            <div className="border border-border-default rounded-lg p-6 bg-surface-secondary">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-3">Code — Geist Mono</p>
              <p className="text-sm text-text-primary font-mono leading-relaxed">
                const task = await dispatch(projectId);
              </p>
              <p className="text-xs text-text-tertiary font-mono mt-1">
                Token names, task IDs, paths, terminal output.
              </p>
            </div>
          </div>
        </Section>

        <Divider />

        {/* ── Text Roles ── */}
        <Section
          title="Text Hierarchy"
          description="Seven semantic text tokens that adapt between light and dark mode. Use these instead of hardcoded colors."
        >
          <div className="border border-border-default rounded-lg overflow-hidden">
            {[
              { token: "text-primary", cls: "text-text-primary", sample: "Primary headings and content" },
              { token: "text-secondary", cls: "text-text-secondary", sample: "Descriptions and supporting text" },
              { token: "text-tertiary", cls: "text-text-tertiary", sample: "Muted labels and metadata" },
              { token: "text-placeholder", cls: "text-text-placeholder", sample: "Input placeholder text" },
              { token: "text-chrome", cls: "text-text-chrome", sample: "UI chrome and navigation" },
              { token: "text-chrome-hover", cls: "text-text-chrome-hover", sample: "Chrome on hover" },
              { token: "text-chrome-active", cls: "text-text-chrome-active", sample: "Chrome when selected" },
            ].map(({ token, cls, sample }, i) => (
              <div key={token} className={`flex items-center justify-between px-5 py-3 ${i > 0 ? "border-t border-border-default" : ""} bg-surface-secondary`}>
                <span className={`text-sm ${cls}`}>{sample}</span>
                <span className="font-mono text-[10px] text-text-tertiary">{token}</span>
              </div>
            ))}
          </div>
        </Section>

        <Divider />

        {/* ── Borders ── */}
        <Section
          title="Borders & Depth"
          description="Borders create containment. Glows signal activity. Both adapt to theme."
        >
          <p className="text-xs text-text-secondary font-medium mb-3 uppercase tracking-wider">Border Tokens</p>
          <div className="grid grid-cols-4 gap-3 mb-8">
            {[
              { token: "border-default", cls: "border-border-default" },
              { token: "border-subtle", cls: "border-border-subtle/60" },
              { token: "border-hover", cls: "border-border-hover" },
              { token: "border-strong", cls: "border-border-strong" },
            ].map(({ token, cls }) => (
              <div key={token} className={`h-20 rounded-lg border-2 ${cls} bg-surface-secondary flex items-center justify-center`}>
                <span className="font-mono text-[10px] text-text-tertiary">{token}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-secondary font-medium mb-3 uppercase tracking-wider">Glow Effects</p>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 rounded-lg border border-bronze-500/40 bg-surface-secondary flex flex-col items-center justify-center shadow-[0_0_12px_rgba(228,189,137,0.15)] animate-pulse-subtle">
              <p className="text-sm text-text-primary font-medium">Bronze Glow</p>
              <p className="font-mono text-[10px] text-text-tertiary mt-1">Agent running</p>
            </div>
            <div className="h-24 rounded-lg border border-lazuli/50 bg-surface-secondary flex flex-col items-center justify-center shadow-[0_0_12px_rgba(91,131,176,0.15)]">
              <p className="text-sm text-text-primary font-medium">Lazuli Glow</p>
              <p className="font-mono text-[10px] text-text-tertiary mt-1">Preview active</p>
            </div>
            <div className="h-24 rounded-lg border border-gold/50 bg-surface-secondary flex flex-col items-center justify-center shadow-[0_0_12px_rgba(201,168,76,0.15)]">
              <p className="text-sm text-text-primary font-medium">Gold Glow</p>
              <p className="font-mono text-[10px] text-text-tertiary mt-1">Needs attention</p>
            </div>
          </div>
        </Section>

        <Divider />

        {/* ── Buttons ── */}
        <Section
          title="Buttons"
          description="Four button styles, each defined as a utility class. Restrained by default — they signal without shouting."
        >
          <div className="space-y-5">
            {[
              { label: "Primary", cls: "btn-primary", token: ".btn-primary", desc: "Default actions, confirmations" },
              { label: "Secondary", cls: "btn-secondary", token: ".btn-secondary", desc: "Alternative actions" },
              { label: "Ghost", cls: "btn-ghost", token: ".btn-ghost", desc: "Tertiary, low-emphasis" },
              { label: "Danger", cls: "btn-danger", token: ".btn-danger", desc: "Destructive actions" },
            ].map(({ label, cls, token, desc }) => (
              <div key={cls} className="flex items-center gap-4">
                <div className="w-48 flex items-center gap-3">
                  <button className={cls}>{label}</button>
                  <button className={cls} disabled>{label}</button>
                </div>
                <div className="flex-1">
                  <span className="font-mono text-[10px] text-text-tertiary">{token}</span>
                  <span className="text-xs text-text-placeholder ml-3">{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Divider />

        {/* ── Task Cards ── */}
        <Section
          title="Task Cards"
          description="The primary interactive unit. Border and glow signal the task's lifecycle state."
        >
          <div className="grid grid-cols-2 gap-4">
            {/* Default */}
            <div className="bg-surface-secondary border border-border-default rounded-md overflow-hidden hover:bg-surface-hover/40 hover:border-border-hover/50 transition-all cursor-pointer">
              <div className="p-3 min-h-[80px]">
                <h4 className="text-sm text-text-primary leading-snug">Fix sidebar overflow</h4>
                <p className="text-xs text-text-tertiary leading-relaxed mt-2 line-clamp-2">
                  The sidebar clips long project names on narrow screens
                </p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-subtle/60">
                  <span className="text-[10px] text-text-tertiary uppercase tracking-wide font-medium">Default</span>
                  <span className="text-[10px] text-text-tertiary font-mono">a1b2c3d4</span>
                </div>
              </div>
            </div>

            {/* Queued */}
            <div className="bg-surface-secondary border border-zinc-500/30 rounded-md overflow-hidden">
              <div className="p-3 min-h-[80px]">
                <h4 className="text-sm text-text-primary leading-snug">Update dependencies</h4>
                <p className="text-xs text-text-tertiary leading-relaxed mt-2 line-clamp-2">
                  Bump Next.js and TypeScript to latest
                </p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-subtle/60">
                  <span className="text-[10px] text-text-secondary font-medium uppercase tracking-wide">Queued</span>
                  <span className="text-[10px] text-text-tertiary font-mono">m3n4o5p6</span>
                </div>
              </div>
            </div>

            {/* Running */}
            <div className="bg-surface-secondary border border-bronze-500/40 rounded-md overflow-hidden shadow-[0_0_12px_rgba(228,189,137,0.15)] animate-pulse-subtle">
              <div className="p-3 min-h-[80px]">
                <h4 className="text-sm text-text-primary leading-snug">Add dark mode toggle</h4>
                <p className="text-xs text-text-tertiary leading-relaxed mt-2 line-clamp-2">
                  Settings page needs a theme switcher
                </p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-subtle/60">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full border-2 border-bronze-500 border-t-transparent animate-spin" />
                    <span className="text-[10px] text-bronze-500 font-medium uppercase tracking-wide">Agent working</span>
                  </div>
                  <span className="text-[10px] text-text-tertiary font-mono">e5f6g7h8</span>
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="bg-surface-secondary border border-lazuli/50 rounded-md overflow-hidden shadow-[0_0_12px_rgba(91,131,176,0.15)]">
              <div className="p-3 min-h-[80px]">
                <h4 className="text-sm text-text-primary leading-snug">Refactor API routes</h4>
                <p className="text-xs text-text-tertiary leading-relaxed mt-2 line-clamp-2">
                  Consolidate duplicate validation logic
                </p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-subtle/60">
                  <span className="text-[10px] text-lazuli font-medium uppercase tracking-wide">Previewing</span>
                  <span className="text-[10px] text-text-tertiary font-mono">i9j0k1l2</span>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Divider />

        {/* ── Interactive States ── */}
        <Section
          title="Interactive States"
          description="Consistent interaction patterns across the interface. Hover warms borders, press scales down, disabled fades out."
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="h-20 rounded-lg border border-border-default bg-surface-secondary flex items-center justify-center hover:border-border-hover/50 hover:bg-surface-hover/40 transition-all cursor-pointer">
              <div className="text-center">
                <p className="text-xs text-text-primary font-medium">Hover</p>
                <p className="text-[10px] text-text-tertiary">Border warms, surface lifts</p>
              </div>
            </div>
            <button className="h-20 rounded-lg border border-border-default bg-surface-secondary flex items-center justify-center active:scale-[0.98] transition-transform cursor-pointer">
              <div className="text-center">
                <p className="text-xs text-text-primary font-medium">Press</p>
                <p className="text-[10px] text-text-tertiary">Scale 98%</p>
              </div>
            </button>
            <div className="h-20 rounded-lg border border-border-default bg-surface-secondary flex items-center justify-center opacity-40 cursor-not-allowed">
              <div className="text-center">
                <p className="text-xs text-text-primary font-medium">Disabled</p>
                <p className="text-[10px] text-text-tertiary">Opacity 40%</p>
              </div>
            </div>
            <div className="group h-20 rounded-lg border border-border-default bg-surface-secondary flex items-center justify-center gap-4 hover:bg-surface-hover/40 transition-colors cursor-pointer">
              <div className="text-center">
                <p className="text-xs text-text-tertiary group-hover:text-text-primary transition-colors font-medium">Group Hover</p>
                <p className="text-[10px] text-text-placeholder group-hover:text-text-chrome-hover transition-colors">Child reacts to parent</p>
              </div>
            </div>
          </div>
        </Section>

        <Divider />

        {/* ── Status Flow ── */}
        <Section
          title="Status Lifecycle"
          description="Every task follows the same four-phase lifecycle. Color and motion communicate state at a glance."
        >
          <div className="flex items-center justify-center gap-3 py-4">
            {[
              { label: "Todo", border: "border-border-default", text: "text-text-secondary", bg: "bg-surface-secondary" },
              { label: "In Progress", border: "border-bronze-500/40", text: "text-bronze-500", bg: "bg-surface-secondary" },
              { label: "Verify", border: "border-lazuli/40", text: "text-lazuli", bg: "bg-surface-secondary" },
              { label: "Done", border: "border-emerald/40", text: "text-emerald", bg: "bg-surface-secondary" },
            ].map(({ label, border, text, bg }, i) => (
              <div key={label} className="flex items-center gap-3">
                {i > 0 && <span className="text-text-placeholder text-lg">&#8594;</span>}
                <div className={`px-5 py-2.5 rounded-lg border ${border} ${bg} flex items-center gap-2`}>
                  {label === "In Progress" && <Loader2Icon className="w-3.5 h-3.5 text-bronze-500 animate-spin" />}
                  <span className={`text-sm font-medium ${text}`}>{label}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Footer */}
        <div className="py-16 text-center">
          <p className="text-xs text-text-placeholder">
            proq design system
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="py-12">
      <h2 className="text-2xl text-text-chrome-active mb-2" style={{ fontFamily: "var(--font-gemunu-libre)" }}>
        {title}
      </h2>
      <p className="text-sm text-text-secondary leading-relaxed mb-8 max-w-2xl">{description}</p>
      {children}
    </section>
  );
}

function Divider() {
  return <hr className="border-border-default" />;
}
