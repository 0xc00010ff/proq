# proq Design System

## Philosophy

Hierarchical. Intentional. Restrained. Every surface, color, and animation earns its place. The interface recedes so the work stands forward. Bronze warmth grounds the dark theme; action colors mark state, not decoration.

---

## Surface Elevation (10 levels)

Surfaces stack from deep to modal. Use semantic tokens — never raw hex/zinc values.

| Token              | Dark                | Role                              |
|--------------------|---------------------|-----------------------------------|
| `surface-deep`     | #080809             | Chat, terminals, deepest layer    |
| `surface-base`     | zinc-950 #09090b    | App shell, ground floor           |
| `surface-inset`    | #0C0C0E             | Input wells, recessed fields      |
| `surface-topbar`   | #101012             | Top bar, board background         |
| `surface-secondary`| #131315             | Sidebar, cards                    |
| `surface-detail`   | #111113             | Detail/reading panels             |
| `surface-primary`  | zinc-900 #18181b    | Elevated highlights               |
| `surface-hover`    | zinc-800 #27272a    | Hover states                      |
| `surface-selected` | zinc-800 #27272a    | Selected states                   |
| `surface-modal`    | #1c1c1f             | Modals, popovers — topmost        |

---

## Color Roles

**Bronze** — Brand, active work, chrome text. The default personality.
- Scale: `bronze-50` through `bronze-900`
- Running tasks: `border-bronze-500/40`, `shadow-[0_0_12px_rgba(228,189,137,0.15)]`
- Chrome text: `text-text-chrome` (warm gray) → `text-text-chrome-hover` (bronze-500) → `text-text-chrome-active` (muted gold)

**Lazuli** — Verify, preview, links. The blue.
- `text-lazuli`, `border-lazuli/30`, `bg-lazuli/10`
- Glow: `shadow-[0_0_12px_rgba(91,131,176,0.15)]`

**Emerald** — Done, success, commits ahead. The green.
- `text-emerald`, `border-emerald/40`, `bg-emerald/10`

**Crimson** — Danger, delete, conflicts. The red.
- `text-crimson`, `border-crimson/20`, `bg-crimson/10`
- Buttons: `.btn-danger`

**Gold** — Human attention required. The yellow.
- `text-gold`, `border-gold/20`, `bg-gold/8`
- Reserved for banners that need human action

---

## Text Hierarchy

| Token              | Role                                    |
|--------------------|-----------------------------------------|
| `text-primary`     | Highest contrast — titles, body text    |
| `text-secondary`   | Supporting content, descriptions        |
| `text-tertiary`    | Muted — timestamps, disabled labels     |
| `text-placeholder` | Ghost text in inputs                    |
| `text-chrome`      | Interactive chrome — nav, tabs, buttons |
| `text-chrome-hover`| Chrome on hover — bright bronze         |
| `text-chrome-active`| Chrome selected/active — muted gold   |

---

## Buttons

```
.btn-primary    — bordered, bg-surface-hover/60, text-chrome. Default action.
.btn-secondary  — text-only, text-chrome → text-chrome-hover. Low emphasis.
.btn-ghost      — text-tertiary → text-secondary + bg-surface-hover. Minimal.
.btn-danger     — crimson border/bg tint. Destructive actions only.
```

All buttons: `px-3 py-1.5 text-xs font-medium rounded-md transition-colors`.

---

## Borders & Shadows

| Token            | Use                                      |
|------------------|------------------------------------------|
| `border-default` | Standard card/panel borders              |
| `border-hover`   | Bronze-tinted on hover                   |
| `border-subtle`  | Faint separators (often at `/60`)        |
| `border-strong`  | Prominent borders, button outlines       |

**Glow patterns** — status-colored shadow rings, subtle:
- Running: `shadow-[0_0_12px_rgba(228,189,137,0.15)]` (bronze)
- Preview: `shadow-[0_0_12px_rgba(91,131,176,0.15)]` (lazuli)
- Findings flash: `ring-1 ring-lazuli/50` with 700ms transition

**Shadows**: `shadow-sm` for buttons, `shadow-lg` for drag overlays, `shadow-xl` for modals.

---

## Typography

- **Geist Sans** — Body, UI text. All weights.
- **Geist Mono** — Code, IDs, branch names, file paths.
- **Gemunu Libre** (weight 800) — Display headings, logo text.

---

## Component Patterns

**Cards**: `bg-surface-secondary border border-border-default rounded-md`. Hover adds `bg-surface-hover/40 border-border-hover/50`.

**Modals**: `bg-surface-modal border border-border-default rounded-lg shadow-xl`. Backdrop blur overlay.

**Tabs**: Container `bg-surface-hover/40 border border-border-default rounded-md p-0.5`. Active tab `bg-surface-primary text-text-chrome-active`.

**Dropdowns**: `bg-surface-modal border border-border-default rounded-md shadow-lg`.

**Status badges**: Uppercase, `text-[10px] tracking-wider font-medium`. Color matches status.

---

## Animation

Restrained. Only animate to signal state changes.

- `animate-pulse-subtle` — Running tasks (opacity 1→0.85→1, 2s ease)
- `animate-spin` — Agent spinner (3s linear)
- `transition-colors` — All interactive elements
- 700ms shadow/ring transitions for findings flash
- No bouncing, no sliding, no gratuitous motion

---

## Light Mode

Same tokens, warm palette. Surface elevations invert (lightest = modal, darkest = deep). Bronze chrome text stays bronze. All color roles (lazuli, emerald, crimson, gold) keep their identity. See `globals.css` `:root` block.

---

## Anti-patterns

- Don't use raw `zinc-*` or hex — use semantic tokens
- Don't add `text-white` or `text-black` — use `text-primary`
- Don't over-animate — one subtle pulse or transition per element max
- Don't use action colors (lazuli, emerald, crimson, gold) for decoration — each signals specific state
- Don't bypass button classes — use `.btn-primary` etc.
- Don't hardcode dark-mode colors — tokens adapt automatically
