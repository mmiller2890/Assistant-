# ④ Live dashboard: cross-window state + capture controls — design

**Date:** 2026-07-16 · **Status:** Approved · **Branch:** all work lands on `dev`

## Why

The final Slate & signal sub-project. The dashboard (②/③) shows persisted
sessions with a focus-refresh lag and has no way to run one. The user's
explicit requirement: **run sessions entirely from the dashboard, with or
without the pop-out** — live transcript/answers streaming in, and the full
capture control set on the dashboard itself.

## Approach

**Event mirror.** The engine stays in the overlay webview (always mounted since
③, hidden or not); the dashboard mirrors its state and remote-controls it over
the Tauri event bus (`@tauri-apps/api` 2.8 `emit`/`listen`, cross-window).
Rejected: moving the engine to the dashboard window (dashboard reloads would
kill live sessions; shortcuts/listeners all target the overlay) and a
Rust-owned session store (a rewrite this feature doesn't need).

## The wire — one typed contract file

`src/lib/live-session.ts` — single source of truth for event names and payload
types (no polarity-in-comments):

- `LIVE_SESSION_STATE = "live-session-state"` (overlay → broadcast):
  `LiveSessionSnapshot` = `{ capturing, isContinuousMode,
  isRecordingInContinuousMode, isProcessing, isAIProcessing, error,
  setupRequired, partialTranscription, isStreaming, lastAIResponse,
  conversation, sessionStartedAt, currentSpeaker, isLabelingSpeakers,
  sessionSummary, isSummarizing, audioLevel, noAudioDetected }`.
  (Every field exists in today's engine — verified against dev post-merge;
  `setupRequired` included so a permission denial renders identically in both
  windows.)
  The embedded `conversation.messages` is **capped to the most recent
  `LIVE_SNAPSHOT_MAX_MESSAGES` (50)** — the live feed shows the current
  session; deep history stays the DB's job.
- `LIVE_SESSION_REQUEST = "live-session-request"` (dashboard → overlay):
  publisher re-broadcasts immediately (fresh dashboard mount/focus gets a
  snapshot without waiting for a change).
- `LIVE_SESSION_COMMAND = "live-session-command"` (dashboard → overlay):
  `{ action: "start-capture" | "stop-capture" | "start-recording" |
  "stop-and-send" | "ignore-recording" | "answer-last" | "new-conversation" |
  "dismiss-summary" }`. Every action maps to an engine function that exists on
  dev today.
- Bonus: the file also types the existing `toggle-window-visibility` event
  (`TOGGLE_WINDOW_VISIBILITY`, payload documented as `isHidden: boolean`) and
  StatusLine's listener imports it — retiring the polarity-in-comments wart
  without touching the Rust emit. No `version` field: both windows ship from
  one bundle and cannot skew.

## Overlay side

- **`useLiveStatePublisher(snapshot)`** (new, `src/hooks/system-audio/`):
  called from `useSystemAudio` with the assembled snapshot. Emits on change
  with a **leading+trailing throttle at ≤10 Hz**: the first change in a quiet
  period emits immediately (button-state transitions like `capturing` flips
  never feel latent), high-frequency streams coalesce, and a trailing flush
  guarantees the final answer token and `capturing:false` always land. Also
  listens for `LIVE_SESSION_REQUEST` and re-emits the current snapshot
  (ref-backed).
- **Command listener** inside `useSystemAudio`: one `listen(LIVE_SESSION_COMMAND)`
  registered once, dispatching through a ref to the engine's own functions
  (`startCapture`, `stopCapture`, `startContinuousRecording`,
  `manualStopAndSend`, `ignoreContinuousRecording`, `answerLastUtterance`,
  `startNewConversation`, `dismissSummary`) — the same stale-closure-proof ref
  discipline as `processWithAIRef`. No behavioral fork: dashboard buttons run
  the identical code paths as overlay buttons.
- **`sessionStartedAt`** (new engine state): `Date.now()` set on successful
  `startCapture`, `null` on stop. In the snapshot; the dashboard computes the
  elapsed timer locally (no per-second events).

## Dashboard side

- **`useLiveSession()`** (new, `src/hooks/`): listens for
  `LIVE_SESSION_STATE`, emits one `LIVE_SESSION_REQUEST` on mount, exposes
  `{ snapshot | null, sendCommand(action) }`. Null snapshot ⇒ idle (no live
  session data yet) — every consumer falls back to current behavior.
- **Mirror-only discipline (rule, not convention):** the dashboard never
  renders optimistic UI state. Buttons emit commands; every rendered state
  comes from the snapshot. If a command fails, the snapshot simply never
  changes (plus the engine's `error` arrives) — no divergence is possible.
- **StatusLine**: the `idle` seam becomes live — `● listening · MM:SS`
  (signal-colored state word by the same priority ladder as the bar; timer from
  `sessionStartedAt`, ticked locally) and the **primary capture button**
  (`start capture` ⇄ `stop`, signal-styled) next to the pop-out toggle.
- **New `CaptureControls` component** (dashboard, under the statusline):
  visible when capturing in manual mode — `record` / `stop & send` / `ignore`;
  always available during a session — `answer last`, `new session`. Mono
  slate styling; keyboard hints shown (`⌘⇧M`, `⌘⇧⏎`).
- **TranscriptFeed**: when `snapshot?.capturing` (or a live conversation with
  messages exists), render the live conversation — including the streaming
  partial transcription (mono, italic) and the answer streaming cursor —
  else fall back to the existing DB conversation. Auto-scroll to the newest turn.
- **SessionMetrics**: live counts + duration from the snapshot during a
  session; DB otherwise.
- **Rail**: streaming `sessionSummary` with `isSummarizing` state and a
  dismiss button (sends `dismiss-summary`).

## Kept / unchanged

- DB-on-focus refresh remains the idle path. All overlay UI and behavior
  unchanged. `useSystemAudioType` unchanged except additive (`sessionStartedAt`).
- Both windows always exist (③); commands work with the overlay hidden.

## Error handling

Command failures inside the engine surface via the engine's existing `error`
state → arrives in the snapshot → StatusLine shows the mono error word (same
destructive styling as the bar). No separate command-ack protocol (YAGNI).

## Verification

- Gates: `cargo check`/`cargo test`, `tsc`, `vite build`, `vitest` green.
- Manual: with the overlay **hidden the whole time** — start capture from the
  dashboard, watch live transcript + streaming answer + timer, drive manual
  mode (record/stop/ignore), `answer last`, `new session`, dismiss the summary;
  then pop the overlay out and confirm both windows stay in sync (start from
  one, stop from the other). Kill/reopen the dashboard mid-session and confirm
  the snapshot recovers via `LIVE_SESSION_REQUEST`.

## Out of scope

- Engine relocation / Rust session store.
- Coding panel (future, unblocked by this).
- Removing the DB fallback.
