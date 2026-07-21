# Art Deco Reskin — Design Spec

**Date:** 2026-07-21
**Status:** Approved (pending spec review)
**Scope:** Full reskin of the Assistant app to an Art Deco design language, gold-on-black classic palette, rich ornament, reversible via git branch.

## Goals

- Give the entire dashboard/settings/sidebar/dialog surface an Art Deco visual identity.
- Keep the stealth overlay (`src/pages/app/`) minimal and unobtrusive over other apps.
- Make the reskin fully reversible: every layer is a separate commit, revert via `git checkout main` or per-commit.

## Non-Goals

- Re-enabling cloud features or altering app behavior.
- Changing component structure, props, or logic.
- Touching Rust, hooks, lib, or Tauri config.
- Adding a light theme variant.

## Architecture

All visual changes live behind the existing token system so no component rewrite is required:

1. **`src/global.css`** — swap token values, add new tokens. Structure (`@theme inline`, `:root`, `.dark`) unchanged.
2. **`index.html`** — load Google Fonts (Poiret One, Cormorant Garamond) in `<head>`.
3. **`src/components/deco/`** (new) — decorative primitives: `Sunburst`, `DiamondDivider`, `CornerFrame`, `SectionHeading`. Pure CSS/SVG, no deps, opt-in.
4. **Layout + key components** — additive edits to apply Deco primitives: `Sidebar`, `Header`, `DashboardLayout`, `PageLayout`, `card.tsx`, `dialog.tsx`, `button.tsx`, `input.tsx`, `tabs.tsx`.

## Palette (gold-on-black, classic)

| Token | Value | Usage |
|---|---|---|
| `--background` | `#141414` | App background |
| `--foreground` | `#f4ecd8` | Body text (cream) |
| `--card` | `#1a1a1a` | Card surfaces |
| `--popover` | `#1a1a1a` | Popover/dialog surfaces |
| `--primary` | `#c5a572` | Gold — primary action, borders, accents |
| `--primary-foreground` | `#141414` | Text on gold fills |
| `--secondary` | `#2a2a2a` | Secondary surfaces |
| `--muted` | `#2a2a2a` | Muted surfaces |
| `--muted-foreground` | `#a8a08a` | Dimmed text |
| `--accent` | `#1c3a2e` | Deep green — rare subtle accent |
| `--border` | `#3a3226` | Warm dark hairline borders |
| `--input` | `#3a3226` | Input borders |
| `--ring` | `#c5a572` | Focus ring (gold) |
| `--destructive` | `#e5484d` | Unchanged |
| `--gold-bright` (new) | `#e6c98a` | Hover/active gold |
| `--radius` | `0` | Square corners everywhere |

## Typography

- **`--font-display`** (new): `Poiret One` — app title, page headings, section labels. Uppercase, `letter-spacing: 0.15em`.
- **`--font-sans`** (replaced): `Cormorant Garamond` — body text and general UI. Replaces Geist Sans.
- **`--font-mono`** (unchanged): `Geist Mono` — version strings, status, code, technical UI.

Loaded via Google Fonts `<link>` in `index.html`. Applied through Tailwind tokens so `font-sans` / `font-mono` utilities keep working.

## Ornament (rich, consistent)

| Surface | Treatment |
|---|---|
| **Sidebar** | `Sunburst` motif above the logo, gold hairline right border, `DiamondDivider` before footer links |
| **Page headers** | `SectionHeading` — uppercase Poiret One title flanked by gold hairlines with a center diamond |
| **Cards** (`card.tsx`) | `CornerFrame` — thin gold L-shaped corners at top-left + bottom-right via `::before`/`::after`, square corners |
| **Dialogs** (`dialog.tsx`) | Gold 1px border + `CornerFrame` + `DiamondDivider` under title |
| **Buttons** (`button.tsx`) | Square corners, gold hairline border, inset second hairline on hover. Primary = gold fill, black text |
| **Inputs** (`input.tsx`, `textarea.tsx`) | Bottom hairline only (no full border), gold underline, gold focus ring |
| **Tabs** (`tabs.tsx`) | Active tab gets a small sunburst glyph + gold underline |
| **Scrollbars** | Gold-tinted thumb (already tokenized in `global.css`) |

## Stealth Overlay (minimal)

`src/pages/app/` stays on the existing slate palette — no gold, no serif, no sunbursts.

Implementation: scope an `.overlay-slate` class on the overlay page root that resets the Deco tokens to slate values via a small CSS override block in `global.css`:

```css
.overlay-slate {
  --background: #0e1116;
  --foreground: #e7ecf2;
  --card: #151a21;
  --primary: #4da3ff;
  --border: #232b35;
  --input: #2e3947;
  --ring: #4da3ff;
  --radius: 0.625rem;
  --font-sans: "Geist Sans", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Geist Sans", ui-sans-serif, system-ui, sans-serif;
}
```

Reverting the overlay's look = delete this one block.

## Deco Primitives (`src/components/deco/`)

All pure CSS/SVG, zero deps, exported from `src/components/deco/index.ts`:

- **`Sunburst`** — conic-gradient sunburst in a sized box, masked to a ring. Props: `size` (px), `className`.
- **`DiamondDivider`** — flex row: gold gradient hairline + rotated gold square + hairline. Props: `className`.
- **`CornerFrame`** — wrapper that adds gold L-corners at TL + BR via pseudo-elements. Props: `children`, `className`, `inset` (px).
- **`SectionHeading`** — composes `DiamondDivider` + uppercase Poiret One label. Props: `children`, `className`, `as` (heading level).

## Component Edit Plan

Each edit is **additive** (wrapping existing markup, swapping class tokens). No props or behavior change.

| File | Edit |
|---|---|
| `src/components/Sidebar.tsx` | Add `Sunburst` above logo, `DiamondDivider` before footer, swap border class to gold |
| `src/components/Header/index.tsx` | Use `SectionHeading` for `isMainTitle` variant |
| `src/layouts/DashboardLayout.tsx` | (read first) Apply gold border treatment if it owns borders |
| `src/layouts/PageLayout.tsx` | (read first) Apply `CornerFrame` to page container |
| `src/components/ui/card.tsx` | Wrap content in `CornerFrame`, force square corners |
| `src/components/ui/dialog.tsx` | Add gold border, `CornerFrame`, `DiamondDivider` under title |
| `src/components/ui/button.tsx` | Square corners, inset hover hairline via `::before` |
| `src/components/ui/input.tsx` | Bottom hairline only, gold focus underline |
| `src/components/ui/textarea.tsx` | Same as input |
| `src/components/ui/tabs.tsx` | Active tab: sunburst glyph + gold underline |
| `src/pages/app/index.tsx` | Add `overlay-slate` class to root container |

## What Does NOT Change

- Component structure, props, behavior.
- Tailwind 4 `@theme inline` mechanism — same tokens, new values.
- `theme.context.tsx` — still dark-only.
- Tauri config, Rust, hooks, lib.
- Provider system, STT/AI logic, storage.

## Revert Strategy

- All work on a git branch `artdeco`.
- Each layer is a separate commit for granular rollback:
  1. Tokens (`global.css`)
  2. Fonts (`index.html`)
  3. Deco primitives (`src/components/deco/`)
  4. Component edits (one commit per component group)
- Full revert: `git checkout main`.
- Overlay-only revert: revert the `.overlay-slate` commit.
- Single-component revert: revert that component's commit.

## Verification

After each layer:
- `npx tsc --noEmit` — typecheck must pass.
- `npm run build` — production build must succeed.
- Manual smoke test:
  - Dashboard renders gold-on-black with sunburst sidebar + diamond dividers.
  - Settings page renders serif body + Poiret headings.
  - A dialog opens with gold corner frame.
  - Overlay window stays slate, no gold, no serif.
  - No layout breakage, no missing fonts.

## Out of Scope / Future

- Light theme variant (plumbing already exists in `theme.context.tsx`).
- Custom Deco icon set (lucide-react stays for now).
- Tauri window chrome styling (Rust-side).