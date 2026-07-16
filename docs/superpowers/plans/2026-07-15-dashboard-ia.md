# Dashboard IA Implementation Plan (sub-project ②)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/dashboard` Welcome launcher with the Slate & signal three-zone session dashboard (statusline · transcript feed · session rail), populated from the persisted conversation DB.

**Architecture:** Build the four leaf zone components bottom-up (each independently renderable with props + an empty state), then the page shell that fetches `getAllConversations()`, refreshes on window focus, and composes the zones into the mockup's grid. Finally point the dashboard window at `/dashboard`. Read-only against the DB and `useApp`; no engine or behavior changes.

**Tech Stack:** React 18, react-router-dom, Tailwind v4 slate tokens, Tauri v2 (`getCurrentWebviewWindow().onFocusChanged`), existing `getAllConversations()` lib + `Markdown` component.

## Global Constraints

- **No engine/behavior changes.** `useSystemAudio` and all hooks untouched. Dashboard is read-only against `@/lib` `getAllConversations()` and `useApp()`.
- **Real data only** — no placeholder/sample content. Every zone renders real DB/`useApp` fields or an explicit empty state.
- **No speaker/diarization data exists** — do not render speaker tags or a "speakers" metric.
- **Slate & signal conventions:** mono = system voice (labels, timestamps, metrics, status); sans = human content (questions, answers, titles). Signal blue (`text-primary`/`border-primary`) only on the answer rule and live/actionable elements. Hairline `border-border` structure. No off-palette colors (no `-emerald-`, `-violet-`, `-pink-`, `-cyan-`, etc.).
- **Verification per task:** `npx tsc --noEmit` clean + `npm run build` green. Visual review at the end.
- Commit after every task.

---

## File structure

```
src/pages/dashboard/
  index.tsx                       # REPLACED: fetch + compose (custom full-height layout, not PageLayout)
  components/
    StatusLine.tsx                # top mono statusline; live-state seam for ④
    TranscriptFeed.tsx            # message turn feed; signal rule on answers
    SessionMetrics.tsx            # session header + questions/answers tiles
    RecentSessions.tsx            # list of recent conversations → /chats/view/:id
    ProviderStatus.tsx            # STT + AI model status rows with ok dots
src-tauri/src/window.rs           # dashboard window initial URL /chats → /dashboard
```

Helper (inline in `index.tsx`, not a shared util — only this page needs them): `formatClock(ts)` → `HH:MM`, `formatDuration(ms)` → `M:SS`/`Hh Mm`, `formatRelative(ts)` → `3m ago`.

---

## Task 1: `ProviderStatus` component

**Files:**
- Create: `src/pages/dashboard/components/ProviderStatus.tsx`

**Interfaces:**
- Produces: `ProviderStatus` — no props; reads `useApp()` internally.

- [ ] **Step 1: Write the component**

```tsx
import { useApp } from "@/contexts";

export const ProviderStatus = () => {
  const { selectedAIProvider, selectedSttProvider } = useApp();

  const aiModel = selectedAIProvider.variables?.MODEL || "";
  const aiReady = !!selectedAIProvider.provider && !!aiModel;
  const sttReady = !!selectedSttProvider.provider;

  const Row = ({
    label,
    value,
    ready,
  }: {
    label: string;
    value: string;
    ready: boolean;
  }) => (
    <div className="flex items-center justify-between font-mono text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={ready ? "text-ok" : "text-meta"}>
        <span
          className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
            ready ? "bg-ok" : "bg-meta"
          }`}
        />
        {value}
      </span>
    </div>
  );

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="font-mono text-[11px] text-meta">status</div>
      <Row
        label="on-device stt"
        value={selectedSttProvider.provider || "none"}
        ready={sttReady}
      />
      <Row
        label="model"
        value={aiReady ? aiModel : "not set"}
        ready={aiReady}
      />
    </div>
  );
};
```

- [ ] **Step 2: Build gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/components/ProviderStatus.tsx
git commit -m "feat(dashboard): ProviderStatus zone component"
```

---

## Task 2: `SessionMetrics` component

**Files:**
- Create: `src/pages/dashboard/components/SessionMetrics.tsx`

**Interfaces:**
- Consumes: `{ conversation: ChatConversation | null }` (from `@/types/completion`).
- Produces: `SessionMetrics`.

- [ ] **Step 1: Write the component**

```tsx
import { ChatConversation } from "@/types/completion";

const formatDuration = (ms: number): string => {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const formatDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

export const SessionMetrics = ({
  conversation,
}: {
  conversation: ChatConversation | null;
}) => {
  const questions =
    conversation?.messages.filter((m) => m.role === "user").length ?? 0;
  const answers =
    conversation?.messages.filter((m) => m.role === "assistant").length ?? 0;
  const duration = conversation
    ? formatDuration(conversation.updatedAt - conversation.createdAt)
    : "—";
  const date = conversation ? formatDate(conversation.createdAt) : "";

  const Tile = ({ n, label }: { n: string; label: string }) => (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="font-mono text-xl font-medium leading-none">{n}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-mono text-[11px] text-meta">
        <span>session</span>
        <span>{conversation ? `${date} · ${duration}` : ""}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Tile n={conversation ? String(questions) : "—"} label="questions" />
        <Tile n={conversation ? String(answers) : "—"} label="answers" />
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Build gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/components/SessionMetrics.tsx
git commit -m "feat(dashboard): SessionMetrics zone component"
```

---

## Task 3: `RecentSessions` component

**Files:**
- Create: `src/pages/dashboard/components/RecentSessions.tsx`

**Interfaces:**
- Consumes: `{ conversations: ChatConversation[] }`.
- Produces: `RecentSessions`.

- [ ] **Step 1: Write the component**

```tsx
import { ChatConversation } from "@/types/completion";
import { useNavigate } from "react-router-dom";

const formatRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
};

export const RecentSessions = ({
  conversations,
}: {
  conversations: ChatConversation[];
}) => {
  const navigate = useNavigate();
  const recent = conversations.slice(0, 6);

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="font-mono text-[11px] text-meta">sessions</div>
      {recent.length === 0 ? (
        <div className="font-mono text-xs text-meta">no sessions yet</div>
      ) : (
        <div className="space-y-1">
          {recent.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/chats/view/${c.id}`)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {c.title || "untitled"}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-meta">
                {formatRelative(c.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Build gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/components/RecentSessions.tsx
git commit -m "feat(dashboard): RecentSessions zone component"
```

---

## Task 4: `TranscriptFeed` component

**Files:**
- Create: `src/pages/dashboard/components/TranscriptFeed.tsx`

**Interfaces:**
- Consumes: `{ conversation: ChatConversation | null }`.
- Produces: `TranscriptFeed`.

- [ ] **Step 1: Write the component**

```tsx
import { ChatConversation } from "@/types/completion";
import { Markdown } from "@/components";

const formatClock = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const TranscriptFeed = ({
  conversation,
}: {
  conversation: ChatConversation | null;
}) => {
  const turns =
    conversation?.messages.filter((m) => m.role !== "system") ?? [];

  if (turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <span className="font-mono text-xs text-meta">
          no session yet · start capture from the overlay
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {turns.map((m) => (
        <div key={m.id} className="flex gap-3">
          <span className="min-w-[40px] pt-0.5 font-mono text-[11px] text-meta">
            {formatClock(m.timestamp)}
          </span>
          {m.role === "assistant" ? (
            <div className="min-w-0 flex-1 border-l-2 border-primary pl-3">
              <div className="mb-1 font-mono text-[11px] text-primary">
                answer
              </div>
              <div className="prose prose-sm max-w-none text-sm dark:prose-invert">
                <Markdown>{m.content}</Markdown>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="mb-1 font-mono text-[11px] text-muted-foreground">
                heard
              </div>
              <div className="text-sm leading-relaxed">{m.content}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Build gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/components/TranscriptFeed.tsx
git commit -m "feat(dashboard): TranscriptFeed zone component"
```

---

## Task 5: `StatusLine` component

**Files:**
- Create: `src/pages/dashboard/components/StatusLine.tsx`

**Interfaces:**
- Produces: `StatusLine` — no props; reads `useApp()`.

- [ ] **Step 1: Write the component**

```tsx
import { useApp } from "@/contexts";

export const StatusLine = () => {
  const { selectedAIProvider, selectedSttProvider } = useApp();
  const ai = selectedAIProvider.provider || "no model";
  const stt = selectedSttProvider.provider || "no stt";

  return (
    <div className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex size-5 items-center justify-center rounded border border-primary">
          <span className="size-1.5 rounded-sm bg-primary" />
        </div>
        <span className="text-sm font-medium">Assistant</span>
      </div>
      <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
        {/* Live-state seam: sub-project ④ replaces `idle` with `listening · MM:SS`. */}
        <span className="text-meta">idle</span>
        <span className="text-meta">|</span>
        <span>{ai}</span>
        <span className="text-meta">·</span>
        <span>{stt}</span>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Build gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/components/StatusLine.tsx
git commit -m "feat(dashboard): StatusLine with live-state seam for cross-window sync"
```

---

## Task 6: Dashboard page — fetch + compose

**Files:**
- Modify (full replace): `src/pages/dashboard/index.tsx`

**Interfaces:**
- Consumes: all five zone components (Tasks 1–5), `getAllConversations` from `@/lib`, `getCurrentWebviewWindow` from `@tauri-apps/api/webviewWindow`.
- Produces: default-exported `Dashboard` page (the routes file already imports `Dashboard` from `@/pages` — keep the default export shape identical).

- [ ] **Step 1: Verify the current export name**

Run: `grep -n "export default\|Dashboard" src/pages/index.ts`
Expected: confirms `/dashboard` route maps to this file's default export (currently `Welcome`). The replacement keeps a default export, so the barrel + route keep working.

- [ ] **Step 2: Replace `src/pages/dashboard/index.tsx`**

```tsx
import { useEffect, useState, useCallback } from "react";
import { getAllConversations } from "@/lib";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ChatConversation } from "@/types/completion";
import { StatusLine } from "./components/StatusLine";
import { TranscriptFeed } from "./components/TranscriptFeed";
import { SessionMetrics } from "./components/SessionMetrics";
import { RecentSessions } from "./components/RecentSessions";
import { ProviderStatus } from "./components/ProviderStatus";

const Dashboard = () => {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);

  const load = useCallback(async () => {
    try {
      const all = await getAllConversations();
      setConversations(all);
    } catch (error) {
      console.error("Failed to load conversations for dashboard:", error);
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The DB is the shared state bridge until sub-project ④ pushes live events:
  // reload when the dashboard window regains focus (e.g. after a session ends
  // in the overlay).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const win = getCurrentWebviewWindow();
        unlisten = await win.onFocusChanged(({ payload: focused }) => {
          if (focused) load();
        });
      } catch (error) {
        console.error("Failed to set up dashboard focus listener:", error);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [load]);

  const current = conversations[0] ?? null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <StatusLine />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-border">
          <TranscriptFeed conversation={current} />
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <SessionMetrics conversation={current} />
          <RecentSessions conversations={conversations} />
          <ProviderStatus />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
```

Note: this page does NOT use `PageLayout` (that wraps everything in one shared ScrollArea, which fights the independent-scroll zones). The drag region normally provided by `DashboardLayout` still sits above this via the layout's absolute drag strip, so window dragging is unaffected.

- [ ] **Step 3: Build gate**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. Any leftover unused imports from the old Welcome file are fully replaced (whole-file overwrite), so no `noUnusedLocals` orphans.

- [ ] **Step 4: Commit**

```bash
git add src/pages/dashboard/index.tsx
git commit -m "feat(dashboard): three-zone session view replacing Welcome launcher"
```

---

## Task 7: Point the dashboard window at `/dashboard`

**Files:**
- Modify: `src-tauri/src/window.rs` (`create_dashboard_window`, the `WebviewUrl::App("/chats".into())` line)

- [ ] **Step 1: Change the initial URL**

In `create_dashboard_window`, change:

```rust
    let base_builder =
        WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::App("/chats".into()));
```

to:

```rust
    let base_builder =
        WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::App("/dashboard".into()));
```

- [ ] **Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: compiles clean. (String literal change only.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/window.rs
git commit -m "feat(dashboard): open dashboard window on /dashboard route"
```

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 2: Visual review**

Run: `npm run tauri dev` (from this worktree). Press ⌘⇧D to open the dashboard.
Checklist:
- Three-zone layout renders: statusline top, transcript feed left (scrolls independently), session rail right.
- With existing chat history: feed shows real turns (mono `HH:MM` + `heard`/`answer`, answers with the blue left rule + markdown); metrics show real question/answer counts + date·duration; recent-sessions lists real conversations and each navigates to `/chats/view/:id`; provider/status shows real STT + model names with green `ok` dots.
- Fresh profile (or no history): each zone shows its mono empty state, no crash.
- Slate & signal holds: mono system voice, signal blue only on the answer rule + logo mark, hairline dividers, no off-palette colors.

- [ ] **Step 3: Off-palette grep gate**

Run:
```bash
grep -rn "bg-white\|bg-black\|text-white\|text-black\|backdrop-blur\|bg-gradient\|-red-[0-9]\|-green-[0-9]\|-emerald-[0-9]\|-violet-[0-9]\|-pink-[0-9]\|-cyan-[0-9]\|-blue-[0-9]\|-amber-[0-9]\|-orange-[0-9]\|-teal-[0-9]" src/pages/dashboard/
```
Expected: no output.

- [ ] **Step 4: Commit (only if fixes were needed)**

If the review surfaced a fix, apply it, re-run Step 1, and commit with a specific message. Otherwise no commit — ② is complete.

---

## Self-Review

**Spec coverage:** statusline → Task 5 (with the documented ④ seam); transcript feed w/ signal-rule answers + empty state → Task 4; session metrics (questions/answers, no speakers) + date·duration → Task 2; recent sessions → Task 3; provider status w/ ok dots → Task 1; page fetch via `getAllConversations` + focus refresh, replaces Welcome, custom layout → Task 6; window URL `/chats`→`/dashboard` → Task 7; verification + off-palette gate → Task 8. No gaps.

**Placeholders:** none — every component step carries complete code; no sample/fake data (all fields trace to `ChatConversation` or `useApp`).

**Type consistency:** all zone components consume `ChatConversation`/`ChatConversation[]` or nothing; `index.tsx` passes `current: ChatConversation | null` to `TranscriptFeed`/`SessionMetrics` and `conversations: ChatConversation[]` to `RecentSessions`, matching each component's declared props. `getAllConversations` imported from `@/lib` (confirmed export). `getCurrentWebviewWindow().onFocusChanged` matches the existing precedent in `useWindow.ts`.
