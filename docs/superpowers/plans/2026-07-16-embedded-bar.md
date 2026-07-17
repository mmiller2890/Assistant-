# Embedded Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's top region with an embedded, fully usable capture bar (driven by ④'s proven mirror/command channel), delete the standalone capture button + control strip, and make the dashboard a proper foreground window.

**Architecture:** Engine stays in the overlay window; the dashboard's `EmbeddedBar` renders from the `LiveSessionSnapshot` and drives the engine via `sendCommand`. Pop-out shows the untouched overlay NSPanel. Text input submits via a new `submit` command handled in the overlay's `useCompletion`. A Rust foregrounding fix makes the dashboard activate as a normal window when the overlay is hidden.

**Tech Stack:** React 18 + `@tauri-apps/api` 2.8 events, Tauri v2 (Rust window/activation), `tauri_nspanel::cocoa::appkit` for the AppKit fallback.

## Global Constraints

- All work on **`dev`**. Engine stays in the overlay (`main`) — not moved.
- Detach model: one bar, one place at a time. Popped-out surface is the existing overlay NSPanel, unchanged.
- Reuse ④: `useLiveSession`, `deriveSessionStatus`, the live feed/metrics/summary.
- Delete `CaptureControls.tsx` and the standalone capture button; `EmbeddedBar` replaces `StatusLine` as the dashboard top region.
- Per-task gate: `npx tsc --noEmit`; Rust tasks `cargo check`; final `npm run build` + `vitest` + manual.

---

## File structure

```
src/lib/live-session.ts                           # + "submit" command (union with text)
src/hooks/useCompletion.ts                        # listen for submit command → submit()
src/pages/dashboard/components/EmbeddedBar.tsx    # NEW: the dashboard's embedded bar
src/pages/dashboard/index.tsx                     # top region = EmbeddedBar; drop strip/StatusLine
src/pages/dashboard/components/StatusLine.tsx     # DELETED (folded into EmbeddedBar)
src/pages/dashboard/components/CaptureControls.tsx# DELETED
src-tauri/src/window.rs                           # foreground the dashboard on show
src-tauri/src/lib.rs                              # Reopen handler foregrounds via AppKit fallback
```

---

## Task 1: `submit` command in the contract

**Files:** modify `src/lib/live-session.ts`.

**Interfaces:** produces the extended `LiveSessionCommand` union.

- [ ] **Step 1:** Change the command types so `submit` carries text, others don't:

```ts
export type LiveSessionCommandAction =
  | "start-capture"
  | "stop-capture"
  | "start-recording"
  | "stop-and-send"
  | "ignore-recording"
  | "answer-last"
  | "new-conversation"
  | "dismiss-summary"
  | "submit";

export type LiveSessionCommand =
  | { action: Exclude<LiveSessionCommandAction, "submit"> }
  | { action: "submit"; text: string };
```

- [ ] **Step 2:** `npx tsc --noEmit` — expect errors at the two existing consumers (engine listener, `useLiveSession.sendCommand`) because the union changed. Fix in Tasks 2–3; for now confirm the errors are only those. Commit after Task 3 compiles (this file alone doesn't build standalone). **Do not commit yet.**

## Task 2: route `submit` + fix command consumers

**Files:** modify `src/hooks/useSystemAudio.ts` (command listener), `src/hooks/useLiveSession.ts` (sendCommand signature), `src/hooks/useCompletion.ts` (new submit listener).

- [ ] **Step 1:** In `useSystemAudio.ts`, the `liveCommandHandlersRef` map covers the non-submit actions; `submit` is handled by `useCompletion`, so exclude it from the map’s dispatch. Change the listener body:

```ts
    const unlisten = listen<LiveSessionCommand>(
      LIVE_SESSION_COMMAND,
      (event) => {
        const action = event.payload?.action;
        if (!action || action === "submit") return; // submit handled in useCompletion
        const handler = liveCommandHandlersRef.current[action];
        if (handler) handler();
      }
    );
```

And type the ref map as `Record<Exclude<LiveSessionCommandAction, "submit">, () => void>` (drop the `submit` key it never had).

- [ ] **Step 2:** In `useLiveSession.ts`, widen `sendCommand` to carry the union so the bar can submit text:

```ts
  const sendCommand = useCallback((command: LiveSessionCommand) => {
    emit(LIVE_SESSION_COMMAND, command).catch((e) =>
      console.error("Failed to send live-session command:", e)
    );
  }, []);
```

(Import `LiveSessionCommand`; drop the old `LiveSessionCommandAction` param.) Update ④'s existing callers in Task 5.

- [ ] **Step 3:** In `useCompletion.ts`, add a listener that submits typed prompts arriving from the dashboard bar. Near the other effects:

```ts
  useEffect(() => {
    const unlisten = listen<LiveSessionCommand>(
      LIVE_SESSION_COMMAND,
      (event) => {
        if (event.payload?.action === "submit" && event.payload.text.trim()) {
          submit(event.payload.text.trim());
        }
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [submit]);
```

Import `listen` from `@tauri-apps/api/event` and `LIVE_SESSION_COMMAND`, `LiveSessionCommand` from `@/lib/live-session`. (`submit` is `useCompletion`'s existing submit function.)

- [ ] **Step 4:** `npx tsc --noEmit` (Task 5 fixes the StatusLine/CaptureControls callers; expect only those errors). Once Task 5 lands, commit together. Interim: verify no NEW errors beyond the known callers.

## Task 3: `EmbeddedBar` component

**Files:** create `src/pages/dashboard/components/EmbeddedBar.tsx`.

**Interfaces:** consumes `{ snapshot, sendCommand, overlayVisible, onTogglePopOut }`.

- [ ] **Step 1:** Write the component — two-band instrument look (mirrors the overlay), driven by the snapshot. Popped-out → placeholder.

```tsx
import { useEffect, useState } from "react";
import { useApp } from "@/contexts";
import {
  CircleStopIcon,
  AudioLinesIcon,
  MicIcon,
  MicOffIcon,
  CornerDownLeftIcon,
  PictureInPicture2,
  SparklesIcon,
  RotateCcwIcon,
} from "lucide-react";
import {
  LiveSessionSnapshot,
  LiveSessionCommand,
  deriveSessionStatus,
} from "@/lib/live-session";

const formatElapsed = (startedAt: number, now: number): string => {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const EmbeddedBar = ({
  snapshot,
  sendCommand,
  overlayVisible,
  onTogglePopOut,
}: {
  snapshot: LiveSessionSnapshot | null;
  sendCommand: (command: LiveSessionCommand) => void;
  overlayVisible: boolean;
  onTogglePopOut: () => void;
}) => {
  const { selectedAIProvider, selectedSttProvider } = useApp();
  const status = deriveSessionStatus(snapshot);
  const capturing = snapshot?.capturing ?? false;
  const manualMode = snapshot?.isContinuousMode ?? false;
  const recording = snapshot?.isRecordingInContinuousMode ?? false;
  const busy = (snapshot?.isProcessing || snapshot?.isAIProcessing) ?? false;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!capturing) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [capturing]);

  const [text, setText] = useState("");
  const submitText = () => {
    const t = text.trim();
    if (!t) return;
    sendCommand({ action: "submit", text: t });
    setText("");
  };

  return (
    <div
      data-tauri-drag-region
      className="relative z-[60] flex flex-col gap-1 border-b border-border bg-sidebar px-4 pb-2.5 pt-2"
    >
      {/* Status band */}
      <div className="flex items-center justify-between font-mono text-[10px] pointer-events-none">
        <span className={`inline-flex items-center gap-1.5 ${status.cls}`}>
          <span
            className={`size-1.5 rounded-full ${status.dot} ${
              status.word !== "idle" ? "animate-pulse" : ""
            }`}
          />
          {status.word}
          {capturing && snapshot?.sessionStartedAt ? (
            <span className="text-muted-foreground">
              · {formatElapsed(snapshot.sessionStartedAt, now)}
            </span>
          ) : null}
        </span>
        <span className="text-meta">
          {selectedAIProvider.provider || "no model"} ·{" "}
          {selectedSttProvider.provider || "no stt"}
        </span>
      </div>

      {overlayVisible ? (
        <div className="flex h-9 items-center justify-between rounded-md border border-border bg-secondary px-3 font-mono text-xs text-meta">
          <span>popped out · bar is floating (invisible to screen share)</span>
          <button
            onClick={onTogglePopOut}
            className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-primary"
          >
            <PictureInPicture2 className="size-3" /> pop in
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() =>
              sendCommand({
                action: capturing ? "stop-capture" : "start-capture",
              })
            }
            title={capturing ? "Stop capture" : "Start capturing system audio"}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 font-mono text-xs transition-colors ${
              capturing
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                : "border-border bg-secondary text-muted-foreground hover:border-input hover:text-primary"
            }`}
          >
            {capturing ? (
              <CircleStopIcon className="size-3.5" />
            ) : (
              <AudioLinesIcon className="size-3.5" />
            )}
            {capturing ? "stop" : "capture"}
          </button>

          {capturing && manualMode && (
            <button
              onClick={() =>
                sendCommand({
                  action: recording ? "stop-and-send" : "start-recording",
                })
              }
              disabled={busy}
              title={recording ? "Stop & send" : "Record"}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-secondary px-3 font-mono text-xs text-muted-foreground transition-colors hover:text-primary disabled:opacity-40"
            >
              {recording ? (
                <MicOffIcon className="size-3.5 text-primary" />
              ) : (
                <MicIcon className="size-3.5" />
              )}
              {recording ? "send" : "record"}
            </button>
          )}
          {capturing && manualMode && recording && (
            <button
              onClick={() => sendCommand({ action: "ignore-recording" })}
              className="inline-flex h-9 items-center rounded-md border border-border bg-secondary px-3 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              ignore
            </button>
          )}

          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitText();
              }
            }}
            placeholder="Ask a question…"
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-input"
          />
          <button
            onClick={submitText}
            disabled={!text.trim()}
            title="Send"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:text-primary disabled:opacity-40"
          >
            <CornerDownLeftIcon className="size-3.5" />
          </button>

          <button
            onClick={() => sendCommand({ action: "answer-last" })}
            title="Answer the last thing heard"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:text-primary"
          >
            <SparklesIcon className="size-3.5" />
          </button>
          <button
            onClick={() => sendCommand({ action: "new-conversation" })}
            title="New session"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:text-primary"
          >
            <RotateCcwIcon className="size-3.5" />
          </button>
          <button
            onClick={onTogglePopOut}
            title="Pop out the bar (invisible to screen share)"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:text-primary"
          >
            <PictureInPicture2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2:** `npx tsc --noEmit` — this file compiles against the Task 1 contract. (Dashboard wiring in Task 5.)

## Task 4: foreground the dashboard (Rust)

**Files:** modify `src-tauri/src/window.rs` (`show_dashboard_window`), `src-tauri/src/lib.rs` (Reopen handler).

- [ ] **Step 1:** In `show_dashboard_window`, after `show()` + `set_focus()`, force app activation on macOS:

```rust
        #[cfg(target_os = "macos")]
        {
            use tauri_nspanel::cocoa::appkit::NSApplication;
            use tauri_nspanel::cocoa::base::nil;
            unsafe {
                let app: tauri_nspanel::cocoa::base::id =
                    NSApplication::sharedApplication(nil);
                app.activateIgnoringOtherApps_(true);
            }
        }
```

Apply in **both** branches (existing window / newly created). If the exact `cocoa` re-export path differs, match the import already used at `lib.rs:16` (`tauri_nspanel::cocoa::appkit::...`).

- [ ] **Step 2:** Ensure the pop-in path calls `show_dashboard_window` (or the same activation) so hiding the overlay always co-occurs with foregrounding the dashboard. The pop toggle is `toggle_overlay` in `shortcuts.rs`; when it **hides** the overlay, also call `window::show_dashboard_window(&app)`. Add to the hide branch of `toggle_overlay`.

- [ ] **Step 3:** `cd src-tauri && cargo check` — clean.

- [ ] **Step 4:** Commit T1–T4 together (they interlock):

```bash
git add src/lib/live-session.ts src/hooks/useSystemAudio.ts src/hooks/useLiveSession.ts src/hooks/useCompletion.ts src/pages/dashboard/components/EmbeddedBar.tsx src-tauri/src/window.rs src-tauri/src/lib.rs
git commit -m "feat(embedded-bar): submit command, EmbeddedBar, dashboard foregrounding"
```

## Task 5: wire dashboard; delete strip + StatusLine

**Files:** modify `src/pages/dashboard/index.tsx`; delete `StatusLine.tsx`, `CaptureControls.tsx`.

- [ ] **Step 1:** Rewrite `index.tsx` top region. `EmbeddedBar` replaces `StatusLine`; drop the `CaptureControls` block. Manage overlay visibility here (query `is_overlay_visible`, listen `TOGGLE_WINDOW_VISIBILITY`, `toggle_overlay` on pop):

```tsx
  const [overlayVisible, setOverlayVisible] = useState(false);
  useEffect(() => {
    invoke<boolean>("is_overlay_visible").then(setOverlayVisible).catch(() => {});
    const un = listen<boolean>(TOGGLE_WINDOW_VISIBILITY, (e) => {
      if (typeof e.payload === "boolean") setOverlayVisible(!e.payload);
    });
    return () => { un.then((f) => f()); };
  }, []);
  const togglePopOut = () =>
    invoke<boolean>("toggle_overlay").then(setOverlayVisible).catch(() => {});
```

Render: `<EmbeddedBar snapshot={snapshot} sendCommand={sendCommand} overlayVisible={overlayVisible} onTogglePopOut={togglePopOut} />` in place of `<StatusLine/>`; remove the `{snapshot?.capturing && <CaptureControls .../>}` line. Zones below unchanged. (Imports: `invoke` from `@tauri-apps/api/core`, `listen` from `@tauri-apps/api/event`, `TOGGLE_WINDOW_VISIBILITY` from `@/lib/live-session`.)

- [ ] **Step 2:** `git rm src/pages/dashboard/components/StatusLine.tsx src/pages/dashboard/components/CaptureControls.tsx`.

- [ ] **Step 3:** `npx tsc --noEmit` — resolves the Task 2 pending caller errors (nothing imports the deleted files; `sendCommand` now takes the union everywhere).

- [ ] **Step 4:** Commit:

```bash
git add src/pages/dashboard/
git commit -m "feat(embedded-bar): dashboard top region is the embedded bar; remove strip + statusline"
```

## Task 6: gates + manual verification + push

- [ ] `npx tsc --noEmit && npm run build && npx vitest run && (cd src-tauri && cargo check)` — all green.
- [ ] Manual (user, their terminal): overlay bar visible on launch; ⌘⇧D → dashboard has the embedded bar AND a macOS menu bar (foregrounds); from the embedded bar: start capture (headphone-output test), type + Enter to ask, watch transcript/answers; manual-mode record/send/ignore; answer-last; new session; pop out → floating invisible bar, dashboard shows the placeholder but keeps streaming; pop in → bar returns, dashboard still foreground. Screen-record check: popped-out bar absent.
- [ ] `git push origin dev`.

---

## Self-Review

**Spec coverage:** detach two-state → EmbeddedBar (T3) + index wiring (T5); engine-in-overlay reuse of ④ → sendCommand/useLiveSession untouched except union widen (T2); delete standalone button + strip → T5; foregrounding fix (Regular already set; AppKit activate) → T4; `submit` command → T1–T2; verification → T6. Source toggle correctly out of scope.

**Placeholders:** none — full component code, exact Rust snippet with the import-path caveat pinned to `lib.rs:16`.

**Type consistency:** `LiveSessionCommand` union defined once (T1), consumed by `sendCommand` (T2), `EmbeddedBar` (T3), engine + useCompletion listeners (T2). `deriveSessionStatus`, `TOGGLE_WINDOW_VISIBILITY`, `is_overlay_visible`/`toggle_overlay` all reused from ④/③ with identical names.
