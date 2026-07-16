# Slate & Signal Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the app's visual identity to the steel-dark, mono-forward "Slate & signal" theme — tokens, fonts, dark-only, and surface-by-surface restyling — with zero structural or behavioral changes.

**Architecture:** Foundation first (fonts → token values → dark-only forcing), then convention-driven restyle passes over each surface in visibility order: shared primitives, overlay bar + popover, dashboard shell, routed pages. Every pass ends with a `tsc`/build gate and a visual check; the token system does most of the work, so component edits are concentrated where the mono/sans voice split and signal discipline live.

**Tech Stack:** Tailwind CSS v4 (CSS-config via `@theme`), shadcn-style tokens in `src/global.css`, `@fontsource/geist-sans` + `@fontsource/geist-mono`, React 18, Tauri v2.

## Global Constraints

- **No behavior change**: hook logic, return shapes, window behavior, routes untouched. Styling + theme/settings wiring only.
- **Dark-only**: the app always renders slate; ThemeProvider machinery stays (future light variant), the settings appearance toggle is removed.
- **Palette**: exact hex values from the spec (`docs/superpowers/specs/2026-07-15-slate-and-signal-reskin-design.md` §1). Signal `#4DA3FF` only on live/actionable; `--ok` only on status dots.
- **Fonts**: Geist Sans + Geist Mono, weights 400/500 only, bundled locally (no CDN). No bold-700 anywhere.
- **Transparency setting stays functional**; default flips to opaque (0) with blur off.
- **Verification per task**: `npx tsc --noEmit` clean + `npm run build` green; visual review in the running app at pass boundaries.
- Commit after every task.

---

## File structure

```
src/main.tsx                        # + 4 fontsource imports
src/global.css                      # token rewrite (:root + .dark identical slate blocks), font vars, body font-sans
src/contexts/theme.context.tsx      # force dark class; transparency default 10 → 0
src/pages/settings/components/Theme.tsx  # remove theme dropdown, keep transparency slider
src/components/ui/*                 # primitives audit pass
src/pages/app/components/speech/*   # overlay surface pass (statusline, answer, chips)
src/pages/app/components/completion/*  # text-input mode surface pass
src/layouts/DashboardLayout.tsx, src/components/Sidebar.tsx, src/components/Header/index.tsx  # shell pass
src/pages/*                         # grep-driven consistency pass
```

---

## Task 1: Bundle Geist fonts and wire font tokens

**Files:**
- Modify: `package.json` (two deps), `src/main.tsx:1-7`, `src/global.css:8-44` (`@theme inline` block) and `@layer base`

**Interfaces:**
- Produces: Tailwind utilities `font-sans` → Geist Sans, `font-mono` → Geist Mono, available to all later tasks.

- [ ] **Step 1: Install the font packages**

Run: `npm install @fontsource/geist-sans @fontsource/geist-mono`
Expected: both added to `dependencies` in `package.json`.

- [ ] **Step 2: Verify the exact font-family names the packages register**

Run: `grep -h "font-family" node_modules/@fontsource/geist-sans/400.css node_modules/@fontsource/geist-mono/400.css | sort -u`
Expected: lines containing `font-family: 'Geist Sans';` and `font-family: 'Geist Mono';`. **If the names differ, use the names printed here in Step 4's `--font-sans`/`--font-mono` values.**

- [ ] **Step 3: Import weights 400/500 in `src/main.tsx`**

Add directly below the existing `import "./global.css";` line:

```ts
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
```

- [ ] **Step 4: Register font tokens and default body font in `src/global.css`**

Inside the existing `@theme inline { ... }` block, add at the top:

```css
  --font-sans: "Geist Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

In the existing `@layer base` block, extend the `body` rule:

```css
  body {
    @apply bg-background text-foreground font-sans;
  }
```

- [ ] **Step 5: Build + visual check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. Then in the running app (`npm run tauri dev`), confirm text renders in Geist (distinctly narrower `g`/`a` than system SF); `font-mono` elements (any code block) render Geist Mono.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/global.css
git commit -m "feat(theme): bundle Geist Sans/Mono locally and wire font tokens"
```

---

## Task 2: Slate token values + new meta/ok/warn tokens

**Files:**
- Modify: `src/global.css:46-114` (`:root` and `.dark` blocks), `:8-44` (`@theme inline`)

**Interfaces:**
- Produces: all shadcn token utilities now render slate; new utilities `text-meta`, `text-ok`, `text-warn`, `bg-ok`, `bg-warn` available to later tasks.

- [ ] **Step 1: Replace the `:root` and `.dark` variable blocks**

Replace the **entire** `:root { ... }` block with (note: `--radius` and `--cursor-type` preserved; `--chart-*` values preserved from the current `.dark` block):

```css
:root {
  --radius: 0.625rem;
  --cursor-type: default;
  --background: #0e1116;
  --foreground: #e7ecf2;
  --card: #151a21;
  --card-foreground: #e7ecf2;
  --popover: #151a21;
  --popover-foreground: #e7ecf2;
  --primary: #4da3ff;
  --primary-foreground: #0e1116;
  --secondary: #1b222b;
  --secondary-foreground: #e7ecf2;
  --muted: #1b222b;
  --muted-foreground: #93a2b2;
  --accent: #1b222b;
  --accent-foreground: #e7ecf2;
  --destructive: #e5484d;
  --border: #232b35;
  --input: #2e3947;
  --ring: #4da3ff;
  --meta: #57646f;
  --ok: #3fd99b;
  --warn: #e0b454;
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: #151a21;
  --sidebar-foreground: #e7ecf2;
  --sidebar-primary: #4da3ff;
  --sidebar-primary-foreground: #0e1116;
  --sidebar-accent: #1b222b;
  --sidebar-accent-foreground: #e7ecf2;
  --sidebar-border: #232b35;
  --sidebar-ring: #4da3ff;
}
```

Replace the **entire** `.dark { ... }` block with the identical variable set (everything from `--background` down — omit `--radius`/`--cursor-type`, which only need declaring once):

```css
.dark {
  --background: #0e1116;
  --foreground: #e7ecf2;
  --card: #151a21;
  --card-foreground: #e7ecf2;
  --popover: #151a21;
  --popover-foreground: #e7ecf2;
  --primary: #4da3ff;
  --primary-foreground: #0e1116;
  --secondary: #1b222b;
  --secondary-foreground: #e7ecf2;
  --muted: #1b222b;
  --muted-foreground: #93a2b2;
  --accent: #1b222b;
  --accent-foreground: #e7ecf2;
  --destructive: #e5484d;
  --border: #232b35;
  --input: #2e3947;
  --ring: #4da3ff;
  --meta: #57646f;
  --ok: #3fd99b;
  --warn: #e0b454;
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: #151a21;
  --sidebar-foreground: #e7ecf2;
  --sidebar-primary: #4da3ff;
  --sidebar-primary-foreground: #0e1116;
  --sidebar-accent: #1b222b;
  --sidebar-accent-foreground: #e7ecf2;
  --sidebar-border: #232b35;
  --sidebar-ring: #4da3ff;
}
```

- [ ] **Step 2: Register the three new tokens as color utilities**

In the `@theme inline` block, add alongside the other `--color-*` lines:

```css
  --color-meta: var(--meta);
  --color-ok: var(--ok);
  --color-warn: var(--warn);
```

- [ ] **Step 3: Build + visual check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. In the running app, both the overlay and dashboard window (⌘⇧D) render steel-dark regardless of macOS light/dark setting **when the OS is in dark mode** (system-light still shows slate too because `:root` now carries slate — confirm by toggling OS appearance if convenient).

- [ ] **Step 4: Commit**

```bash
git add src/global.css
git commit -m "feat(theme): slate & signal token values; add meta/ok/warn tokens"
```

---

## Task 3: Dark-only forcing, opaque default, remove theme toggle

**Files:**
- Modify: `src/contexts/theme.context.tsx:38-41,60-91`, `src/pages/settings/components/Theme.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useTheme()` keeps its exact public shape `{ theme, setTheme, transparency, onSetTransparency }` — no consumer changes anywhere.

- [ ] **Step 1: Force the dark class in `theme.context.tsx`**

Replace the theme-applying effect (lines 60–91, the `useEffect` containing `applyTheme`) with:

```ts
  // Slate & signal is dark-only for now. Theme state is retained so a future
  // light variant can restore class switching without plumbing changes.
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add("dark");
  }, [theme]);
```

Note: `mediaQuery`/`isSystemThemeDark` (lines 43–44) stay — `isSystemThemeDark` is still exported in the context value.

- [ ] **Step 2: Default transparency to opaque**

Change the `transparency` initializer (lines 38–41) to:

```ts
  const [transparency, setTransparency] = useState<number>(() => {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.TRANSPARENCY);
    return stored ? parseInt(stored, 10) : 0;
  });
```

And in `initialState` (line 23), change `transparency: 10,` to `transparency: 0,`.

- [ ] **Step 3: Remove the appearance toggle from `Theme.tsx`, keep transparency**

Replace the entire file content with:

```tsx
import { useApp, useTheme } from "@/contexts";
import { Header, Slider } from "@/components";

export const Theme = () => {
  const { transparency, onSetTransparency } = useTheme();
  const { hasActiveLicense } = useApp();

  return (
    <div id="theme" className="relative space-y-3">
      <Header
        title={`Appearance ${
          hasActiveLicense
            ? ""
            : " (You need an active license to use this feature)"
        }`}
        description="Adjust the transparency level of the application window"
        isMainTitle
      />

      {/* Transparency Slider */}
      <div
        className={`space-y-2 ${
          hasActiveLicense ? "" : "opacity-60 pointer-events-none"
        }`}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-4 mt-4">
            <Slider
              value={[transparency]}
              onValueChange={(value: number[]) => onSetTransparency(value[0])}
              min={0}
              max={100}
              step={1}
              className="flex-1"
            />
          </div>

          <p className="text-xs text-muted-foreground/70">
            Higher transparency lets you see through the window. Changes apply
            immediately.
          </p>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. `noUnusedLocals` will flag anything orphaned in `theme.context.tsx` (e.g. if `applyTheme` helpers were left) — fix by deleting the orphan.

- [ ] **Step 5: Visual check**

In the running app: surfaces are fully opaque with no blur (fresh profile default; an existing stored transparency still applies — that's spec'd). Settings shows only the transparency slider under "Appearance", no light/dark dropdown.

- [ ] **Step 6: Commit**

```bash
git add src/contexts/theme.context.tsx src/pages/settings/components/Theme.tsx
git commit -m "feat(theme): dark-only slate rendering; default opaque; remove theme toggle"
```

---

## Task 4: Primitives pass (`src/components/ui/`)

**Files:**
- Modify: `src/components/ui/*.tsx` (audit-driven; expect small diffs — these are token-driven shadcn components)

**Interfaces:**
- Produces: primitives that later passes compose; no API changes, class-level only.

- [ ] **Step 1: Generate the audit worklist**

Run:
```bash
grep -rn "bg-white\|bg-black\|text-white\|text-black\|#[0-9a-fA-F]\{6\}\|backdrop-blur\|bg-gradient\|shadow-lg\|shadow-xl" src/components/ui/
```
Expected: a short list (possibly empty). These are the lines to fix.

- [ ] **Step 2: Apply the replacement rules to every hit**

| Found | Replace with |
|---|---|
| `bg-white`, `bg-black/…` | `bg-card` (surface) or `bg-secondary` (chip/inset) |
| `text-white`, `text-black` | `text-foreground` (or `text-primary-foreground` on signal-blue fills) |
| any hex literal | nearest token utility per spec §1 table |
| `backdrop-blur*` | delete the class (global transparency vars still honor the user setting) |
| `bg-gradient*` | flat `bg-card` |
| `shadow-lg`/`shadow-xl` | `shadow-sm` or delete — hairline borders carry depth: ensure `border border-border` present |

- [ ] **Step 3: Build gate**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui
git commit -m "restyle(ui): primitives on slate tokens; drop blur/gradients for hairlines"
```

---

## Task 5: Overlay bar + popover pass (the most-seen surface)

**Files:**
- Modify: `src/pages/app/index.tsx`, `src/pages/app/components/speech/` — `Header.tsx`, `StatusIndicator.tsx`, `ResultsSection.tsx`, `QuickActions.tsx`, `RecordingPanel.tsx`, `ModeSwitcher.tsx`, `Warning.tsx`, `PermissionFlow.tsx`, `SettingsPanel.tsx`; `src/pages/app/components/completion/` — `Input.tsx`, `MessageHistory.tsx`, `index.tsx` (where visible in the popover)

**Interfaces:**
- Consumes: `font-mono`, `text-meta`, `text-ok`, `text-warn` utilities from Tasks 1–2.
- Produces: nothing consumed later; leaf pass.

Apply the **voice convention** and **signal discipline** to each file. The concrete treatments (from the design doc's reference mockup):

- [ ] **Step 1: Statusline & status indicators** (`Header.tsx`, `StatusIndicator.tsx`, `ModeSwitcher.tsx`)

System-voice text (state words, timers, provider names, shortcut hints) becomes mono, lowercase, small:

```tsx
// status word + dot, e.g. while capturing:
<span className="font-mono text-xs text-primary inline-flex items-center gap-1.5">
  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
  listening
</span>
// idle/meta variants use text-muted-foreground; timestamps/timers:
<span className="font-mono text-xs text-muted-foreground">{elapsed}</span>
// separators between statusline segments:
<span className="font-mono text-xs text-meta">·</span>
```

Rules: recording/live dot = `bg-primary` (signal); connected/ok dots = `bg-ok`; error states `text-destructive`. No other color.

- [ ] **Step 2: AI answer block** (`ResultsSection.tsx`)

The streaming/final answer gets the signal left rule and mono label; body stays sans:

```tsx
<div className="border-l-2 border-primary bg-card pl-3 py-2">
  <div className="font-mono text-[11px] text-primary mb-2">answer</div>
  <div className="text-sm leading-relaxed">{/* existing markdown/answer body */}</div>
</div>
```

Transcription/question display: sans body, with mono speaker/time meta (`font-mono text-[11px] text-muted-foreground`).

- [ ] **Step 3: Quick-action chips** (`QuickActions.tsx`)

```tsx
<button className="bg-secondary border border-border rounded-md px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:border-input transition-colors">
  {action}
</button>
```

- [ ] **Step 4: Remaining files in the list** (`RecordingPanel.tsx`, `Warning.tsx`, `PermissionFlow.tsx`, `SettingsPanel.tsx`, completion components, `index.tsx`)

Run the Task 4 Step 1 grep scoped to `src/pages/app/` and apply the same replacement table; then apply the voice convention: any label/metric/kbd-hint → `font-mono text-xs`, lowercase where it reads as system voice; warnings use `text-warn`/`border-warn`, errors `text-destructive`. Keyboard hints (⌘⏎ etc.) always `font-mono text-xs text-meta`.

- [ ] **Step 5: Build + visual review**

Run: `npx tsc --noEmit && npm run build` — clean.
In `npm run tauri dev`: open the popover; confirm statusline reads as mono terminal voice, the answer block shows the blue left rule + mono `answer` label, chips are steel, and **the only blue on screen is live/actionable**.

- [ ] **Step 6: Commit**

```bash
git add src/pages/app
git commit -m "restyle(overlay): slate & signal pass on bar, popover, answer block, chips"
```

---

## Task 6: Dashboard shell pass

**Files:**
- Modify: `src/layouts/DashboardLayout.tsx`, `src/components/Sidebar.tsx`, `src/components/Header/index.tsx`

**Interfaces:** none new; leaf pass.

- [ ] **Step 1: Sidebar** (`src/components/Sidebar.tsx`)

Nav items become mono lowercase with signal-blue active state only:

```tsx
// nav item classes:
// inactive:
"font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded-md px-3 py-2 transition-colors"
// active:
"font-mono text-xs text-primary bg-sidebar-accent rounded-md px-3 py-2"
```

Sidebar container: `bg-sidebar border-r border-sidebar-border` (hairline divider, no shadow). Section headings (if any): `font-mono text-[11px] text-meta lowercase`.

- [ ] **Step 2: Layout + header** (`DashboardLayout.tsx`, `components/Header/index.tsx`)

Content area `bg-background`; any page-header titles stay sans (human voice) but breadcrumb/meta/count text goes `font-mono text-xs text-muted-foreground`. Dividers are `border-border` hairlines. Apply the Task 4 replacement table to any grep hits in these three files.

- [ ] **Step 3: Build + visual review**

Run: `npx tsc --noEmit && npm run build` — clean. Open the dashboard window (⌘⇧D): sidebar reads as instrument-panel nav, one blue active item, hairline dividers everywhere, no shadows/gradients.

- [ ] **Step 4: Commit**

```bash
git add src/layouts src/components/Sidebar.tsx src/components/Header
git commit -m "restyle(dashboard): shell, sidebar, header on slate tokens with mono nav"
```

---

## Task 7: Routed pages consistency pass + final grep gate

**Files:**
- Modify: remaining hits under `src/pages/` and `src/components/` (audit-driven; ~18 files had hardcoded colors/blur at plan time)

- [ ] **Step 1: Regenerate the full worklist**

Run:
```bash
grep -rln "bg-white\|bg-black\|text-white\|text-black\|#[0-9a-fA-F]\{6\}\|backdrop-blur\|bg-gradient" src/pages src/components src/layouts --include="*.tsx"
```

- [ ] **Step 2: Fix every remaining file** using the Task 4 replacement table + voice convention (labels/timestamps/metrics → mono). Skip `src/components/ui/chart.tsx` chart-color internals (charts keep existing `--chart-*` values per spec).

- [ ] **Step 3: Final grep gate**

Re-run the Step 1 grep. Expected: no output (or only justified exceptions: chart internals, the token definitions in `global.css`, and `audio-visualizer.tsx` canvas-drawing colors if they read from tokens is impractical — if the visualizer hardcodes canvas colors, set them to the slate hexes `#4DA3FF`/`#93A2B2` and note it).

- [ ] **Step 4: Full verification sweep**

Run: `npx tsc --noEmit && npm run build` — clean.
In `npm run tauri dev`: walk every route (`/dashboard`, `/chats`, `/system-prompts`, `/shortcuts`, `/screenshot`, `/settings`, `/audio`, `/responses`, `/dev-space`) + the overlay popover. Checklist per screen: no white flashes, no gradients/blur, mono system voice on labels, signal blue only where live/actionable.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "restyle(pages): consistency pass; final token gate across all routes"
```

---

## Self-Review

**Spec coverage:** §1 tokens → Task 2; dark-only mechanism → Task 3 (both `:root`+`.dark` carry slate per Task 2, class forced in Task 3); transparency default → Task 3 Step 2; §2 typography → Task 1 + voice convention applied in Tasks 5–7; §3 signal discipline → encoded in Tasks 4–7 rules and the Task 5/7 visual checklists; §4 surface order → Tasks 4→5→6→7 match; §5 error tokens → Task 5 Step 4; §6 verification → per-task gates + Task 7 Step 3–4 grep/visual gates. No gaps.

**Placeholders:** none — every restyle step carries either exact code, an exact replacement table, or an exact grep worklist command.

**Type consistency:** no new TS interfaces; `useTheme()` shape explicitly unchanged (Task 3). Utility names introduced once (`text-meta`/`text-ok`/`text-warn`, Task 2) and consumed in Tasks 5–7 with identical spelling.
