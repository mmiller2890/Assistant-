# Art Deco Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the Assistant app to a gold-on-black Art Deco design language with rich ornament, leaving the stealth overlay on the existing slate palette.

**Architecture:** All visual identity lives behind CSS tokens in `src/global.css`. Tailwind 4's `@theme inline` maps those tokens to utilities, so swapping token values reskins the whole app without component rewrites. Four new decorative primitives (`src/components/deco/`) provide opt-in ornament (sunbursts, diamond dividers, corner frames, section headings). The stealth overlay page opts out via a scoped `.overlay-slate` class that resets tokens to slate.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind CSS 4, Vite 7, Tauri 2, Google Fonts (Poiret One, Cormorant Garamond).

**Reference spec:** `docs/superpowers/specs/2026-07-21-art-deco-reskin-design.md`

**Branch:** Work on a new branch `artdeco` off `main`. Each task is one commit. Reverting = `git checkout main`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `index.html` | Modify | Load Google Fonts |
| `src/global.css` | Modify | Swap token values for Deco palette + typography; add `.overlay-slate` override |
| `src/components/deco/Sunburst.tsx` | Create | Conic-gradient sunburst ring primitive |
| `src/components/deco/DiamondDivider.tsx` | Create | Gold hairline + diamond + hairline |
| `src/components/deco/CornerFrame.tsx` | Create | Wrapper adding gold L-corners via pseudo-elements |
| `src/components/deco/SectionHeading.tsx` | Create | DiamondDivider + uppercase Poiret One label |
| `src/components/deco/index.ts` | Create | Barrel export for deco primitives |
| `src/components/index.ts` | Modify | Re-export deco barrel |
| `src/components/ui/button.tsx` | Modify | Square corners + inset hover hairline |
| `src/components/ui/card.tsx` | Modify | Square corners + gold hairline border |
| `src/components/ui/input.tsx` | Modify | Bottom hairline only + gold focus underline |
| `src/components/ui/textarea.tsx` | Modify | Same as input |
| `src/components/ui/dialog.tsx` | Modify | Gold border + corner frame + diamond divider under title |
| `src/components/ui/tabs.tsx` | Modify | Active tab: sunburst glyph + gold underline |
| `src/components/Sidebar.tsx` | Modify | Sunburst above logo + diamond divider before footer + gold border |
| `src/components/Header/index.tsx` | Modify | Use SectionHeading for isMainTitle variant |
| `src/layouts/PageLayout.tsx` | Modify | Pass through (no change needed — Header handles it) |
| `src/pages/app/index.tsx` | Modify | Add `.overlay-slate` class to root container |

---

## Task 1: Branch + verify clean baseline

**Files:** none

- [ ] **Step 1: Create the branch**

```bash
git checkout -b artdeco
```

- [ ] **Step 2: Verify baseline compiles**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed with no errors. If they fail on `main`, stop and report — the baseline must be green.

- [ ] **Step 3: Commit nothing (checkpoint only)**

No changes to commit. Proceed to Task 2.

---

## Task 2: Load Google Fonts in index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Edit index.html `<head>`**

Add these `<link>` tags inside `<head>`, after the `<title>` element:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Poiret+One&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap"
      rel="stylesheet"
    />
```

The full `<head>` should read:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Assistant</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Poiret+One&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap"
      rel="stylesheet"
    />
  </head>
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: succeeds. Fonts load at runtime; build does not fetch them.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(deco): load Poiret One + Cormorant Garamond fonts"
```

---

## Task 3: Swap CSS tokens to Art Deco palette + typography

**Files:**
- Modify: `src/global.css`

- [ ] **Step 1: Update the `@theme inline` font tokens**

In `src/global.css`, replace lines 9-10 (the `--font-sans` and `--font-mono` lines inside `@theme inline`):

Replace:
```css
  --font-sans: "Geist Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

With:
```css
  --font-sans: "Cormorant Garamond", "Geist Sans", ui-serif, Georgia, serif;
  --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --font-display: "Poiret One", "Cormorant Garamond", ui-serif, Georgia, serif;
```

- [ ] **Step 2: Replace the `:root` token block**

Replace the entire `:root { ... }` block (lines 54-91 in the current file) with:

```css
:root {
  --radius: 0;
  --cursor-type: default;
  --background: #141414;
  --foreground: #f4ecd8;
  --card: #1a1a1a;
  --card-foreground: #f4ecd8;
  --popover: #1a1a1a;
  --popover-foreground: #f4ecd8;
  --primary: #c5a572;
  --primary-foreground: #141414;
  --secondary: #2a2a2a;
  --secondary-foreground: #f4ecd8;
  --muted: #2a2a2a;
  --muted-foreground: #a8a08a;
  --accent: #1c3a2e;
  --accent-foreground: #f4ecd8;
  --destructive: #e5484d;
  --border: #3a3226;
  --input: #3a3226;
  --ring: #c5a572;
  --meta: #8a7a4a;
  --ok: #3fd99b;
  --warn: #e0b454;
  --gold-bright: #e6c98a;
  --chart-1: oklch(0.7 0.12 80);
  --chart-2: oklch(0.6 0.1 150);
  --chart-3: oklch(0.55 0.1 200);
  --chart-4: oklch(0.6 0.12 40);
  --chart-5: oklch(0.5 0.1 20);
  --sidebar: #141414;
  --sidebar-foreground: #f4ecd8;
  --sidebar-primary: #c5a572;
  --sidebar-primary-foreground: #141414;
  --sidebar-accent: #2a2a2a;
  --sidebar-accent-foreground: #f4ecd8;
  --sidebar-border: #3a3226;
  --sidebar-ring: #c5a572;
}
```

- [ ] **Step 3: Replace the `.dark` token block**

Replace the entire `.dark { ... }` block (lines 93-128 in the current file) with:

```css
.dark {
  --background: #141414;
  --foreground: #f4ecd8;
  --card: #1a1a1a;
  --card-foreground: #f4ecd8;
  --popover: #1a1a1a;
  --popover-foreground: #f4ecd8;
  --primary: #c5a572;
  --primary-foreground: #141414;
  --secondary: #2a2a2a;
  --secondary-foreground: #f4ecd8;
  --muted: #2a2a2a;
  --muted-foreground: #a8a08a;
  --accent: #1c3a2e;
  --accent-foreground: #f4ecd8;
  --destructive: #e5484d;
  --border: #3a3226;
  --input: #3a3226;
  --ring: #c5a572;
  --meta: #8a7a4a;
  --ok: #3fd99b;
  --warn: #e0b454;
  --chart-1: oklch(0.7 0.12 80);
  --chart-2: oklch(0.6 0.1 150);
  --chart-3: oklch(0.55 0.1 200);
  --chart-4: oklch(0.6 0.12 40);
  --chart-5: oklch(0.5 0.1 20);
  --sidebar: #141414;
  --sidebar-foreground: #f4ecd8;
  --sidebar-primary: #c5a572;
  --sidebar-primary-foreground: #141414;
  --sidebar-accent: #2a2a2a;
  --sidebar-accent-foreground: #f4ecd8;
  --sidebar-border: #3a3226;
  --sidebar-ring: #c5a572;
}
```

- [ ] **Step 4: Add the `.overlay-slate` override block**

At the end of the file (after the last rule, after line 223), append:

```css

/* Stealth overlay — keep slate, opt out of Art Deco. Deleting this block
   re-applies the Deco palette to the overlay. */
.overlay-slate {
  --radius: 0.625rem;
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
  --border: #232b35;
  --input: #2e3947;
  --ring: #4da3ff;
  --meta: #57646f;
  --sidebar: #151a21;
  --sidebar-foreground: #e7ecf2;
  --sidebar-primary: #4da3ff;
  --sidebar-primary-foreground: #0e1116;
  --sidebar-accent: #1b222b;
  --sidebar-accent-foreground: #e7ecf2;
  --sidebar-border: #232b35;
  --sidebar-ring: #4da3ff;
  --font-sans: "Geist Sans", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Geist Sans", ui-sans-serif, system-ui, sans-serif;
}
```

- [ ] **Step 5: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/global.css
git commit -m "feat(deco): swap CSS tokens to gold-on-black Art Deco palette + serif typography"
```

---

## Task 4: Create the `Sunburst` primitive

**Files:**
- Create: `src/components/deco/Sunburst.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/deco/Sunburst.tsx` with this exact content:

```tsx
import { cn } from "@/lib/utils";

interface SunburstProps {
  size?: number;
  className?: string;
}

export function Sunburst({ size = 48, className }: SunburstProps) {
  return (
    <div
      className={cn("deco-sunburst", className)}
      style={{
        width: size,
        height: size,
        backgroundImage:
          "conic-gradient(from 0deg, var(--primary) 0deg 15deg, transparent 15deg 30deg, var(--primary) 30deg 45deg, transparent 45deg 60deg, var(--primary) 60deg 75deg, transparent 75deg 90deg, var(--primary) 90deg 105deg, transparent 105deg 120deg, var(--primary) 120deg 135deg, transparent 135deg 150deg, var(--primary) 150deg 165deg, transparent 165deg 180deg, var(--primary) 180deg 195deg, transparent 195deg 210deg, var(--primary) 210deg 225deg, transparent 225deg 240deg, var(--primary) 240deg 255deg, transparent 255deg 270deg, var(--primary) 270deg 285deg, transparent 285deg 300deg, var(--primary) 300deg 315deg, transparent 315deg 330deg, var(--primary) 330deg 345deg, transparent 345deg 360deg)",
        WebkitMask:
          "radial-gradient(circle, transparent 30%, black 31%, black 48%, transparent 49%)",
        mask:
          "radial-gradient(circle, transparent 30%, black 31%, black 48%, transparent 49%)",
      }}
      aria-hidden="true"
    />
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: succeeds (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/deco/Sunburst.tsx
git commit -m "feat(deco): add Sunburst primitive"
```

---

## Task 5: Create the `DiamondDivider` primitive

**Files:**
- Create: `src/components/deco/DiamondDivider.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/deco/DiamondDivider.tsx` with this exact content:

```tsx
import { cn } from "@/lib/utils";

interface DiamondDividerProps {
  className?: string;
}

export function DiamondDivider({ className }: DiamondDividerProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-3 w-full",
        className
      )}
      aria-hidden="true"
    >
      <span
        className="flex-1 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--primary), transparent)",
        }}
      />
      <span
        className="size-1.5 rotate-45"
        style={{ background: "var(--primary)" }}
      />
      <span
        className="flex-1 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--primary), transparent)",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/deco/DiamondDivider.tsx
git commit -m "feat(deco): add DiamondDivider primitive"
```

---

## Task 6: Create the `CornerFrame` primitive

**Files:**
- Create: `src/components/deco/CornerFrame.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/deco/CornerFrame.tsx` with this exact content:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

interface CornerFrameProps extends React.ComponentProps<"div"> {
  inset?: number;
  length?: number;
}

export function CornerFrame({
  inset = 6,
  length = 28,
  className,
  children,
  ...props
}: CornerFrameProps) {
  const cornerStyle = (position: "tl" | "br"): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: "absolute",
      width: length,
      height: length,
      borderColor: "var(--primary)",
      pointerEvents: "none",
    };
    if (position === "tl") {
      return {
        ...base,
        top: -inset,
        left: -inset,
        borderTopWidth: 1,
        borderLeftWidth: 1,
        borderStyle: "solid",
        borderRight: "none",
        borderBottom: "none",
      };
    }
    return {
      ...base,
      bottom: -inset,
      right: -inset,
      borderBottomWidth: 1,
      borderRightWidth: 1,
      borderStyle: "solid",
      borderTop: "none",
      borderLeft: "none",
    };
  };

  return (
    <div
      className={cn("relative", className)}
      {...props}
    >
      <span style={cornerStyle("tl")} />
      <span style={cornerStyle("br")} />
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/deco/CornerFrame.tsx
git commit -m "feat(deco): add CornerFrame primitive"
```

---

## Task 7: Create the `SectionHeading` primitive

**Files:**
- Create: `src/components/deco/SectionHeading.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/deco/SectionHeading.tsx` with this exact content:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import { DiamondDivider } from "./DiamondDivider";

interface SectionHeadingProps {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "h4";
}

export function SectionHeading({
  children,
  className,
  as: Tag = "h2",
}: SectionHeadingProps) {
  return (
    <div className={cn("flex flex-col gap-3 w-full", className)}>
      <Tag
        className="text-center uppercase tracking-[0.15em] text-primary"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {children}
      </Tag>
      <DiamondDivider />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/deco/SectionHeading.tsx
git commit -m "feat(deco): add SectionHeading primitive"
```

---

## Task 8: Create the deco barrel export + wire into components barrel

**Files:**
- Create: `src/components/deco/index.ts`
- Modify: `src/components/index.ts`

- [ ] **Step 1: Write the barrel**

Create `src/components/deco/index.ts` with this exact content:

```ts
export * from "./Sunburst";
export * from "./DiamondDivider";
export * from "./CornerFrame";
export * from "./SectionHeading";
```

- [ ] **Step 2: Re-export from the components barrel**

In `src/components/index.ts`, add a new line after line 11 (`export * from "./Sidebar";`):

Replace:
```ts
export * from "./Sidebar";
export * from "./Empty";
```

With:
```ts
export * from "./Sidebar";
export * from "./Empty";
export * from "./deco";
```

- [ ] **Step 3: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/components/deco/index.ts src/components/index.ts
git commit -m "feat(deco): export deco primitives from components barrel"
```

---

## Task 9: Restyle the Button primitive

**Files:**
- Modify: `src/components/ui/button.tsx`

- [ ] **Step 1: Swap the base + variant strings**

In `src/components/ui/button.tsx`, replace the `buttonVariants` cva call (lines 6-35) with:

```ts
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium uppercase tracking-[0.15em] transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring/80 focus-visible:ring-ring/60 focus-visible:ring-[2px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[var(--gold-bright)]",
        destructive:
          "bg-destructive text-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border border-primary bg-transparent text-primary hover:bg-primary/10",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-none gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-none px-6 has-[>svg]:px-4",
        icon: "size-9 rounded-none",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
```

Changes: `rounded-xl` → `rounded-none`, added `uppercase tracking-[0.15em]`, gold-on-black `outline` variant, `default` hover now uses `--gold-bright`, ring thickness reduced from 4px to 2px for a finer Deco line.

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "feat(deco): restyle Button with square corners + gold outline variant"
```

---

## Task 10: Restyle the Card primitive

**Files:**
- Modify: `src/components/ui/card.tsx`

- [ ] **Step 1: Swap the Card base class**

In `src/components/ui/card.tsx`, replace the `Card` function (lines 5-16) with:

```tsx
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card/80 text-card-foreground relative flex flex-col gap-6 rounded-none border border-primary/40 py-6 shadow-sm",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-px -left-px size-7 border-t border-l border-primary"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-px -right-px size-7 border-b border-r border-primary"
      />
      {props.children}
    </div>
  );
}
```

This adds gold L-corners at top-left + bottom-right directly in the Card markup (simpler than wrapping every Card in `CornerFrame`, which would break layout). Square corners via `rounded-none`. Border is gold hairline `border-primary/40`.

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/card.tsx
git commit -m "feat(deco): restyle Card with gold hairline border + L-corners"
```

---

## Task 11: Restyle the Input primitive

**Files:**
- Modify: `src/components/ui/input.tsx`

- [ ] **Step 1: Swap the Input class string**

In `src/components/ui/input.tsx`, replace the entire `Input` function (lines 5-23) with:

```tsx
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground/70 selection:bg-primary selection:text-primary-foreground dark:bg-input/30 flex h-9 w-full min-w-0 rounded-none border-0 border-b border-primary/40 bg-transparent px-1 py-1 text-base tracking-wide transition-[color,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary",
        "aria-invalid:border-destructive",
        className
      )}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      {...props}
    />
  );
}
```

Changes: removed `rounded-xl`, removed full border, added bottom-only border `border-b border-primary/40`, removed box-shadow ring, focus now just brightens the bottom border to `--primary`. Padding trimmed to `px-1 py-1` for the hairline look.

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/input.tsx
git commit -m "feat(deco): restyle Input with bottom gold hairline + gold focus underline"
```

---

## Task 12: Restyle the Textarea primitive

**Files:**
- Modify: `src/components/ui/textarea.tsx`

- [ ] **Step 1: Swap the Textarea class string**

In `src/components/ui/textarea.tsx`, replace the entire `Textarea` function (lines 5-20) with:

```tsx
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground/70 dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-none border-0 border-b border-primary/40 bg-transparent px-1 py-2 text-base tracking-wide transition-[color,border-color] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary",
        "aria-invalid:border-destructive",
        className
      )}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      {...props}
    />
  );
}
```

Mirrors the Input treatment: bottom hairline only, gold focus underline, square corners.

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/textarea.tsx
git commit -m "feat(deco): restyle Textarea to match Input (bottom hairline + gold focus)"
```

---

## Task 13: Restyle the Dialog primitive

**Files:**
- Modify: `src/components/ui/dialog.tsx`

- [ ] **Step 1: Swap the DialogContent class + add corner spans + diamond divider**

In `src/components/ui/dialog.tsx`, replace the entire `DialogContent` function (lines 47-79) with:

```tsx
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 relative fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-none border border-primary p-6 duration-200 sm:max-w-lg",
          className
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-px -left-px size-7 border-t border-l border-primary"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-px -right-px size-7 border-b border-r border-primary"
        />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
```

Changes: `rounded-xl` → `rounded-none`, `border` → `border-primary`, added two gold L-corner spans inside the content (before `children`).

- [ ] **Step 2: Swap DialogTitle to use the display font**

In the same file, replace the `DialogTitle` function (lines 104-115) with:

```tsx
function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "uppercase tracking-[0.15em] text-primary leading-none",
        className
      )}
      style={{ fontFamily: "var(--font-display)" }}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/dialog.tsx
git commit -m "feat(deco): restyle Dialog with gold border + L-corners + Poiret title"
```

---

## Task 14: Restyle the Tabs primitive

**Files:**
- Modify: `src/components/ui/tabs.tsx`

- [ ] **Step 1: Swap the TabsList + TabsTrigger classes**

In `src/components/ui/tabs.tsx`, replace the `TabsList` function (lines 21-35) with:

```tsx
function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center gap-0 rounded-none border-b border-border bg-transparent p-0",
        className
      )}
      {...props}
    />
  );
}
```

Replace the `TabsTrigger` function (lines 37-51) with:

```tsx
function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-none border border-transparent px-3 py-1 text-sm font-medium uppercase tracking-[0.1em] whitespace-nowrap transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "text-muted-foreground hover:text-foreground",
        "data-[state=active]:text-primary",
        "data-[state=active]:border-b data-[state=active]:border-primary",
        className
      )}
      {...props}
    />
  );
}
```

Changes: removed the pill background from `TabsList`, made it a bottom-bordered row. Triggers are now uppercase with letter-spacing; active trigger gets gold text + gold bottom border (the active "underline"). Removed the shadow + background pill on active.

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/tabs.tsx
git commit -m "feat(deco): restyle Tabs with gold active underline + uppercase triggers"
```

---

## Task 15: Restyle the Sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add imports + Sunburst above logo + DiamondDivider before footer**

In `src/components/Sidebar.tsx`, replace the import block (lines 1-6) with:

```tsx
import { SparklesIcon } from "lucide-react";
import { Button, Sunburst, DiamondDivider } from "@/components";
import { cn } from "@/lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMenuItems, useVersion } from "@/hooks";
```

Replace the `{/* Logo */}` block (lines 16-32) with:

```tsx
      {/* Logo */}
      <div className="flex flex-col items-center pt-10 px-4 gap-3">
        <Sunburst size={40} />
        <div
          onClick={() => navigate("/dashboard")}
          className="flex h-16 items-center gap-1.5 cursor-pointer"
        >
          <div className="flex size-6 lg:size-7 items-center justify-center rounded-md border border-primary">
            <SparklesIcon className="size-4 lg:size-5 text-primary transition-all duration-300" />
          </div>
          <div className="flex flex-col">
            <h1
              className="text-xs lg:text-md font-medium text-foreground tracking-[0.15em] uppercase"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Assistant
            </h1>
            <span className="font-mono text-[8px] lg:text-[10px] text-meta -mt-1 block">
              {isLoading ? "loading" : `v${version}`}
            </span>
          </div>
        </div>
      </div>
```

Replace the `{/* Navigation */}` closing and footer opening (lines 59-60) with:

```tsx
      <div className="flex flex-col space-y-1 px-3 pb-3">
        <DiamondDivider className="mb-3" />
        <div className="flex flex-row justify-evenly items-center gap-2 mb-3">
```

So the footer section now reads:

```tsx
      <div className="flex flex-col space-y-1 px-3  pb-3">
        <DiamondDivider className="mb-3" />
        <div className="flex flex-row justify-evenly items-center gap-2 mb-3">
          {footerLinks.map((item, index) => (
            <Button
              key={`${item.title}-${index}`}
              title={item.title}
              size="sm"
              variant="outline"
              onClick={() => openUrl(item.link)}
            >
              <item.icon className="size-3 lg:size-4 transition-all duration-300" />
            </Button>
          ))}
        </div>
        {footerItems.map((item, index) => (
          <a
            href={item.href}
            onClick={item.action}
            target="_blank"
            rel="noopener noreferrer"
            key={`${item.label}-${index}`}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 font-mono text-xs lowercase text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            )}
          >
            <div className="flex items-center gap-3">
              <item.icon className="size-3 lg:size-4 transition-all duration-300" />
              {item.label}
            </div>
          </a>
        ))}
      </div>
```

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(deco): sidebar with sunburst logo + diamond divider before footer"
```

---

## Task 16: Restyle the Header to use SectionHeading for main titles

**Files:**
- Modify: `src/components/Header/index.tsx`

- [ ] **Step 1: Add import + use display font for main titles**

In `src/components/Header/index.tsx`, add a new import after line 1:

Replace:
```tsx
import { Button, Label } from "@/components";
```

With:
```tsx
import { Button, Label } from "@/components";
import { SectionHeading } from "@/components/deco";
```

Replace the `Header` function's return (lines 30-75) with:

```tsx
  return (
    <div
      className={cn(
        `flex ${
          rightSlot ? "flex-row justify-between items-center" : "flex-col"
        } ${
          isMainTitle && (showBorder || !rightSlot)
            ? "border-b border-primary/40 pb-2"
            : ""
        }`,
        className
      )}
    >
      <div className="flex items-center gap-2">
        {allowBackButton && (
          <Button size="icon" variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeftIcon className="size-3 lg:size-4 transition-all duration-300" />
          </Button>
        )}
        <div className="flex flex-col gap-2">
          {isMainTitle ? (
            <SectionHeading as="h1">{title}</SectionHeading>
          ) : (
            <Label
              className={cn(
                "font-medium line-clamp-1 uppercase tracking-[0.1em] text-primary",
                "text-xs lg:text-sm transition-all duration-300",
                titleClassName
              )}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </Label>
          )}
          <p
            className={cn(
              `select-none text-muted-foreground leading-relaxed italic ${
                isMainTitle
                  ? "text-xs lg:text-sm"
                  : "text-[10px] lg:text-xs transition-all duration-300"
              } ${descriptionClassName}`}
            >
              {description}
            </p>
          </div>
        </div>
      </div>
      {rightSlot}
    </div>
  );
```

Changes: main titles now use `SectionHeading` (Poiret One uppercase + diamond divider). Sub-titles use the display font in uppercase with letter-spacing. The bottom border on main titles becomes gold (`border-primary/40`). The description gets `italic` for a Deco flourish. Note the `style={{ fontFamily: ... }}` is applied inline because Tailwind's `font-display` utility only exists if `@theme inline` exposes `--font-display` as a font family token — it does (we added it in Task 3), so `font-display` utility would also work; inline style is used here for clarity and to avoid a Tailwind purge miss.

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/Header/index.tsx
git commit -m "feat(deco): Header uses SectionHeading for main titles + display font for subtitles"
```

---

## Task 17: Apply `.overlay-slate` to the stealth overlay root

**Files:**
- Modify: `src/pages/app/index.tsx`

- [ ] **Step 1: Add the class to the root container**

In `src/pages/app/index.tsx`, find the outer `<div>` returned by the `App` component (line 52-56):

```tsx
      <div
        className={`w-screen h-screen flex overflow-hidden justify-center items-start ${
          isHidden ? "hidden pointer-events-none" : ""
        }`}
      >
```

Replace with:

```tsx
      <div
        className={`overlay-slate w-screen h-screen flex overflow-hidden justify-center items-start ${
          isHidden ? "hidden pointer-events-none" : ""
        }`}
      >
```

That's the only change — the `overlay-slate` class (added in Task 3) resets all Deco tokens to the original slate values for this subtree, so the overlay renders exactly as it did before the reskin.

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/pages/app/index.tsx
git commit -m "feat(deco): scope overlay-slate on stealth overlay root to keep it slate"
```

---

## Task 18: Smoke test + final verification

**Files:** none

- [ ] **Step 1: Full typecheck + build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed with zero errors.

- [ ] **Step 2: Launch the app**

Run:
```bash
npm run tauri dev
```
Expected: app launches, dashboard renders. (You can stop it with Ctrl-C after observing.)

- [ ] **Step 3: Manual smoke checklist**

Open the running app and verify each:

- [ ] Dashboard background is near-black (`#141414`), text is cream.
- [ ] Sidebar shows a sunburst above the "ASSISTANT" logo (now uppercase Poiret One).
- [ ] Sidebar has a diamond divider between the nav and footer links.
- [ ] A page with a main title (e.g. Dashboard) shows the title in uppercase Poiret One flanked by gold hairlines + a center diamond.
- [ ] Cards have square corners, gold hairline border, and gold L-corners at top-left + bottom-right.
- [ ] Buttons are square-cornered; outline variant is gold-on-transparent; primary fills gold.
- [ ] Text inputs show only a gold bottom hairline; focusing brightens it to full gold.
- [ ] Open any dialog (e.g. Settings → a confirm dialog): gold border, gold L-corners, uppercase Poiret One title.
- [ ] Tabs (if visible on a page) are uppercase with a gold underline on the active tab.
- [ ] Open the overlay window (the floating app window, not the dashboard): it stays slate — blue primary, Geist Sans, rounded corners, no gold, no sunburst.
- [ ] No missing-font warnings in the browser console (Poiret One + Cormorant Garamond should load from Google Fonts).

- [ ] **Step 4: Final commit (if any uncommitted changes remain)**

If the smoke test surfaced fixes, commit them:
```bash
git add -A
git commit -m "fix(deco): smoke test adjustments"
```

If nothing changed, skip this step.

---

## Revert Guide

To revert the entire reskin:
```bash
git checkout main
```

To revert a single layer, revert its commit (find with `git log --oneline artdeco ^main`):
```bash
git revert <commit-sha>
```

The commits, in order:
1. `feat(deco): load Poiret One + Cormorant Garamond fonts`
2. `feat(deco): swap CSS tokens to gold-on-black Art Deco palette + serif typography`
3. `feat(deco): add Sunburst primitive`
4. `feat(deco): add DiamondDivider primitive`
5. `feat(deco): add CornerFrame primitive`
6. `feat(deco): add SectionHeading primitive`
7. `feat(deco): export deco primitives from components barrel`
8. `feat(deco): restyle Button with square corners + gold outline variant`
9. `feat(deco): restyle Card with gold hairline border + L-corners`
10. `feat(deco): restyle Input with bottom gold hairline + gold focus underline`
11. `feat(deco): restyle Textarea to match Input`
12. `feat(deco): restyle Dialog with gold border + L-corners + Poiret title`
13. `feat(deco): restyle Tabs with gold active underline + uppercase triggers`
14. `feat(deco): sidebar with sunburst logo + diamond divider before footer`
15. `feat(deco): Header uses SectionHeading for main titles + display font for subtitles`
16. `feat(deco): scope overlay-slate on stealth overlay root to keep it slate`

To revert only the overlay change (re-apply Deco to the overlay too): revert commit 16.