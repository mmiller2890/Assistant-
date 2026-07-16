# Slate & signal reskin — design

**Date:** 2026-07-15 · **Status:** Approved · **Parent direction:** `docs/design/ui-redesign-slate-and-signal.md`

## Why

First implementation increment of the Slate & signal UI direction: swap the app's visual identity from the translucent consumer-overlay look inherited from the Pluely fork to the steel-dark, mono-forward "professional instrument" identity — **without any structural changes**. New dashboard IA, dashboard-primary launch, cross-window live state, and the coding panel are explicitly later sub-projects.

## Decisions locked during brainstorming

1. **Window model (end state):** multi-window + Tauri event sync — dashboard and floating pop-out can be up simultaneously. Not built in this increment, but later sub-projects assume it; nothing in this reskin may preclude it.
2. **This increment:** theme tokens + reskin of existing surfaces only. No new zones, routes, or window behavior.
3. **Dark-only for now:** the app always renders the slate theme. The light/dark/system toggle is removed from Settings; the ThemeProvider machinery stays so a future light variant slots back in.
4. **Fonts:** Geist (sans) + Geist Mono, bundled locally via `@fontsource/geist-sans` + `@fontsource/geist-mono` npm packages (OFL, woff2, offline-capable — no CDN). Weights 400/500 only.

## 1. Token architecture

Slate values go into the existing shadcn variable slots in `src/global.css`, using the design doc's hex values verbatim (traceable back to the doc; hex is valid alongside oklch):

| shadcn token | Slate value | Doc token / role |
|---|---|---|
| `--background` | `#0E1116` | `--bg` — base steel |
| `--card`, `--popover`, `--sidebar` | `#151A21` | `--panel` — panel surface |
| `--secondary`, `--muted`, `--accent`, `--sidebar-accent` | `#1B222B` | `--elev` — elevated chips/inputs/hover. **Note:** shadcn `--accent` is a hover *surface*, not the brand accent; the signal blue is deliberately NOT mapped to it. |
| `--border`, `--sidebar-border` | `#232B35` | `--line` — hairline |
| `--input` | `#2E3947` | `--line2` — stronger border |
| `--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground`, `--sidebar-foreground` | `#E7ECF2` | `--tp` — text primary |
| `--muted-foreground` | `#93A2B2` | `--ts` — text secondary |
| `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring` | `#4DA3FF` | `--sig` — the signal. `--primary-foreground`: `#0E1116` |
| `--destructive` | `#E5484D` | steel-compatible red (doc left red TBD) |

**New tokens** (registered in `@theme inline` so utilities exist):
- `--meta: #57646F` → `text-meta` (doc `--tm`, third text level)
- `--ok: #3FD99B` → `text-ok` (status ok / connected)
- `--warn: #E0B454` → `text-warn` (warning states)

`--chart-*` variables: keep existing values (charts are peripheral; retune later if needed).
`--radius`: keep `0.625rem`. The "machined" feel comes from hairlines and opacity, not radius surgery.

**Dark-only mechanism:** the slate values are written into **both** `:root` and `.dark` (identical blocks). The ThemeProvider forces the `dark` class regardless of the stored `theme` value (stored value is ignored, not migrated — harmless key). The appearance toggle component (`src/pages/settings/components/Theme.tsx`) is removed from the Settings page. Rationale: whatever class ends up on the root element, the app renders slate; restoring a distinct `:root` block later re-enables a light variant with no plumbing changes.

**Transparency:** the user-facing opacity/blur setting stays functional (no feature removal), but defaults change to opaque (`opacity: 1`) with blur off — "structure over softness." Existing users' stored preference is respected.

## 2. Typography

- Install `@fontsource/geist-sans` and `@fontsource/geist-mono`; import weights 400 and 500 only (four CSS imports total) in `src/main.tsx`.
- Register in `@theme` in `global.css`: `--font-sans: "Geist Sans", ui-sans-serif, system-ui, sans-serif;` and `--font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;` so Tailwind's `font-sans` / `font-mono` utilities resolve to them. `body` gets `font-sans` by default.
- **Voice convention (applies to every surface pass):** monospace is the *system's* voice — statusline, labels, timestamps, metrics, latency readouts, keyboard hints, provider/model names; lowercase where it reads as terminal (`listening`, `answer`, `session`). Sans is the *human's* voice — questions, answers, chat content, settings prose. Two weights only (400/500); no bold-700 anywhere.

## 3. Signal discipline

`#4DA3FF` appears **only** where something is live or actionable: the listening/recording indicator, the active answer's left rule and label, focus rings, primary action buttons, active nav item. Everything else is steel grays. `--ok` green only on connection/status dots. If a component currently uses color for decoration, it loses it.

## 4. Surface passes (in order)

1. **Primitives** (`src/components/ui/`: button, card, badge, input, textarea, popover, dialog, select, tabs, switch, etc.): hairline `--border` borders, flat `--card`/`--elev` surfaces, signal-blue restricted to focus rings and primary variants, mono for badge/kbd-style text where it's system voice.
2. **Overlay bar + popover** (`src/pages/app/` — the most-seen surface): statusline elements go mono; the AI answer block gets the signal-blue left rule + mono lowercase `answer` label; quick-action chips become `--elev` steel chips with mono text; transcript/timestamps mono.
3. **Dashboard shell** (`src/layouts/DashboardLayout.tsx`, `src/components/Sidebar.tsx`, `src/components/Header/`): panel surfaces, hairline dividers, mono lowercase nav labels, signal-blue active state only.
4. **Routed pages consistency pass** (`src/pages/*`): mostly inherited via tokens/primitives; audit for hardcoded colors, gradients, or blur classes that bypass tokens and replace them with token utilities.

## 5. Error handling

No behavioral error paths change. Visual error states standardize on `--destructive` (red) and `--warn` (amber) tokens.

## 6. Verification

- `npm run build` (tsc + vite) green after every pass.
- Visual review in `npm run tauri dev` after each surface pass — overlay bar, popover open, dashboard window (⌘⇧D), each routed page.
- No behavior changes: hook logic, return shapes, and window behavior untouched. `useSystemAudioType` consumers guard against accidental API drift.
- Grep gate at the end: no remaining `backdrop-blur` defaults, no hex colors in components that bypass the token system (except the token definitions themselves).

## Out of scope (later sub-projects, in the direction doc's order)

- New dashboard IA (transcript feed · live answer · session rail zones)
- Dashboard-primary launch + overlay as opt-in pop-out
- Cross-window live state sync (multi-window model)
- Coding panel
- Light variant of the slate theme
