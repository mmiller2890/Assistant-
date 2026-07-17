# Live Dashboard Implementation Plan (sub-project ④)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the overlay engine's live session state into the dashboard and add a full dashboard capture-control set, so sessions run entirely from the dashboard with or without the pop-out.

**Architecture:** Typed contract file (`src/lib/live-session.ts`) defines the three events and the snapshot/command types. A `useLiveStatePublisher` inside `useSystemAudio` broadcasts a capped snapshot (leading+trailing 10 Hz throttle) and answers snapshot requests; a once-registered ref-backed command listener dispatches to the engine's own functions. `useLiveSession` consumes on the dashboard; StatusLine/controls/feed/metrics/rail render mirror-only.

**Tech Stack:** `@tauri-apps/api` 2.8 event bus (`emit`/`listen`), React 18, existing engine functions on dev.

## Global Constraints

- All work lands on **`dev`**.
- **Mirror-only discipline:** dashboard buttons emit commands; rendered state comes only from the snapshot.
- Snapshot `conversation.messages` capped at `LIVE_SNAPSHOT_MAX_MESSAGES = 50`.
- Publisher: leading emit on first change, ≤10 Hz coalescing, trailing flush.
- No engine behavior changes beyond additive `sessionStartedAt`.
- Gates per task: `npx tsc --noEmit`; final `npm run build` + `npx vitest run` + `cargo check` untouched-but-verified.

---

## Task 1: contract file `src/lib/live-session.ts`

**Produces:** `LIVE_SESSION_STATE`, `LIVE_SESSION_REQUEST`, `LIVE_SESSION_COMMAND`, `TOGGLE_WINDOW_VISIBILITY` constants; `LiveSessionSnapshot`, `LiveSessionCommandAction`, `LiveSessionCommand` types; `LIVE_SNAPSHOT_MAX_MESSAGES = 50`; `deriveSessionStatus(snapshot)` → `{ word, cls, dot }` (single ladder for dashboard rendering).

Code: see implementation (types over `ChatConversation` from `@/types/completion`; ladder priority error > answering > transcribing > recording/listening > armed > idle, slate token classes).

Gate: `npx tsc --noEmit`. Commit: `feat(live): typed live-session event contract`.

## Task 2: publisher + command listener in the engine

**Files:** create `src/hooks/system-audio/useLiveStatePublisher.ts`; modify `src/hooks/useSystemAudio.ts`.

- `useLiveStatePublisher(snapshot: LiveSessionSnapshot)`: keeps `snapshotRef` fresh; effect on snapshot identity → if >100ms since last emit, emit now (leading), else schedule trailing timer for the remainder; on `LIVE_SESSION_REQUEST` re-emit immediately. Cleanup clears timer.
- `useSystemAudio`: add `sessionStartedAt` state (`Date.now()` beside `setCapturing(true)` at ~901; `null` beside `setCapturing(false)` at ~994); assemble snapshot via `useMemo` (cap messages: `{...conversation, messages: conversation.messages.slice(0, LIVE_SNAPSHOT_MAX_MESSAGES)}` — state is newest-first, slice keeps the newest); call publisher; add once-registered `listen(LIVE_SESSION_COMMAND)` dispatching via `commandHandlersRef` (mirrors latest `startCapture`, `stopCapture`, `startContinuousRecording`, `manualStopAndSend`, `ignoreContinuousRecording`, `answerLastUtterance`, `startNewConversation`, `dismissSummary`); return `sessionStartedAt` (additive).

Gate: `npx tsc --noEmit`. Commit: `feat(live): engine publishes live snapshots and accepts dashboard commands`.

## Task 3: dashboard consumer `src/hooks/useLiveSession.ts`

`useLiveSession(): { snapshot: LiveSessionSnapshot | null, sendCommand(action) }` — listens for `LIVE_SESSION_STATE`, emits one `LIVE_SESSION_REQUEST` on mount, `sendCommand` wraps `emit(LIVE_SESSION_COMMAND, { action })`.

Gate: `npx tsc --noEmit`. Commit: `feat(live): useLiveSession dashboard consumer`.

## Task 4: dashboard UI wiring

**Files:** modify `src/pages/dashboard/index.tsx`, `components/StatusLine.tsx`, `components/TranscriptFeed.tsx`, `components/SessionMetrics.tsx`; create `components/CaptureControls.tsx`, `components/SessionSummaryCard.tsx`.

- `index.tsx`: `const { snapshot, sendCommand } = useLiveSession()`; `liveConversation = snapshot && snapshot.conversation.messages.length > 0 ? snapshot.conversation : null`; feed/metrics get `liveConversation ?? current` plus live props; render `CaptureControls` under StatusLine when `snapshot?.capturing`; `SessionSummaryCard` in the rail when summary or summarizing; pass `snapshot`+`sendCommand` to StatusLine.
- `StatusLine`: props `{ snapshot, sendCommand }`. Replaces static `idle` with `deriveSessionStatus` word+dot; `· MM:SS` timer (local 1s interval while capturing, from `sessionStartedAt`); **capture button** `start capture` ⇄ `stop` → `sendCommand("start-capture"|"stop-capture")` (mirror-only: label from snapshot). Typed `TOGGLE_WINDOW_VISIBILITY` import replaces the string literal.
- `CaptureControls`: mono strip — manual mode (`isContinuousMode`): `record`/`stop & send` (by `isRecordingInContinuousMode`) + `ignore`; always: `answer last`, `new session`. Buttons disabled while `isProcessing || isAIProcessing` (matching overlay keyboard rules).
- `TranscriptFeed`: new optional props `{ partialTranscription?, isAIProcessing?, live? }` — renders streaming partial as an italic mono `hearing…` turn and a `bg-primary` cursor on the streaming answer; auto-scrolls to newest turn when live.
- `SessionMetrics`: optional `liveDurationMs` (from `sessionStartedAt`) overrides `updatedAt-createdAt` while capturing.
- `SessionSummaryCard`: mono `summary` heading, streamed markdown-ish text, `isSummarizing` spinner word, dismiss → `sendCommand("dismiss-summary")`.

Gate: `npx tsc --noEmit && npm run build`. Commit: `feat(live): dashboard renders live sessions with full capture controls`.

## Task 5: gates + manual verification + push

`tsc` + build + `vitest` + `cargo check` green → push `dev`. Manual (user): overlay hidden throughout — start from dashboard, live transcript/answer/timer, manual-mode controls, answer-last, new session, dismiss summary; pop out and confirm both windows track each other; close/reopen dashboard mid-session (snapshot recovers via request).

## Self-Review

Spec coverage: contract+typed visibility (T1), publisher throttle semantics + request + `sessionStartedAt` + command refs (T2), consumer (T3), StatusLine seam/button + control strip + live feed/metrics/summary + mirror-only (T4), verification incl. hidden-overlay flow (T5). No placeholders — full code lands in implementation with tsc gates. Types: all event names/types sourced from `live-session.ts` only.
