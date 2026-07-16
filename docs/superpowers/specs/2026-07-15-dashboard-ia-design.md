# Dashboard IA — design (sub-project ②)

**Date:** 2026-07-15 · **Status:** Approved · **Parent direction:** `docs/design/ui-redesign-slate-and-signal.md`

## Why

Sub-project ② of the Slate & signal direction: the structural overhaul. Increment ① reskinned the *existing* surfaces (color/type/hairlines/signal) but left the app structurally a "movable bar + popover dropdown." This replaces the `/dashboard` Welcome launcher with the mockup's **three-zone session dashboard** (statusline · transcript feed · session rail), so the app reads as a work instrument, not a re-skinned overlay.

## Decisions locked during brainstorming

1. **Data source: real, from the SQLite conversation store** — not placeholders. Zones render the most-recent persisted conversation. True token-by-token streaming + the live `listening` timer are sub-project ④ (cross-window sync); this increment reflects real sessions with a small refresh lag.
2. **Replace `/dashboard`** (the Welcome launcher) rather than add a route — its nav shortcuts duplicate the sidebar.
3. **No engine/behavior changes.** Read-only against the DB and `useApp`. `useSystemAudio` and all hooks untouched.

## Data reality (constrains the zones)

Persisted shape: `ChatConversation { id, title, messages[], createdAt, updatedAt }`, `ChatMessage { id, role: "user"|"assistant"|"system", content, timestamp }`. **No speaker/diarization data exists** — so the mockup's "speakers" tile and per-speaker tags are dropped. `getAllConversations()` returns all conversations sorted `updated_at DESC`; `conversations[0]` is the current/most-recent session.

## Layout

Two-mode note: this builds the **dashboard** view. The overlay pop-out is unchanged. Full dashboard-primary-on-launch (demoting the overlay) is sub-project ③.

**Grid:** statusline across the top; below it a two-column grid `minmax(0,1.65fr) minmax(0,1fr)` — transcript feed left, session rail right. Hairline (`border-border`) divider between columns, matching the mockup.

### Statusline (`components/StatusLine.tsx`)
Mono, `bg-sidebar`, hairline bottom border. Shows provider/model from `useApp`: `{aiProviderId} · {sttProviderId}` with green `ok` dots when configured, `text-meta` when not. A left slot holds a **state indicator** that in v1 renders a resting `idle` (mono) — this is the documented seam where ④ injects the live `listening · MM:SS` state. No live timer in v1.

### Transcript feed (`components/TranscriptFeed.tsx`)
Renders `conversations[0].messages` as a vertical turn feed:
- Each turn: mono `HH:MM` timestamp (from `message.timestamp`) in `text-meta`, left-aligned min-width column.
- **User turns** (`role === "user"` — the transcribed capture): mono `heard` tag in `text-muted-foreground`, content in sans body.
- **Assistant turns** (`role === "assistant"`): the signal treatment — `border-l-2 border-primary pl-3`, mono `answer` label in `text-primary`, content rendered through the existing `Markdown` component.
- `system` role turns are skipped (not user-facing content).
- Empty state (no conversations, or the session has no messages): centered mono `no session yet · start capture from the overlay` in `text-meta`.

### Session rail (right, three stacked components)
- **`components/SessionMetrics.tsx`** — a session header line (mono: session date + duration `updatedAt − createdAt` formatted `MM:SS` or `Hh Mm`) plus a 2-col tile grid: **questions** (count of `user` messages) and **answers** (count of `assistant` messages). Tiles are `bg-panel` hairline cards, big mono number + small sans label, per the mockup. Empty state: dashes in the tiles.
- **`components/RecentSessions.tsx`** — mono `sessions` heading; a list of up to 6 conversations (`conversations.slice(0, 6)`): title (sans, truncated) + relative time (mono `text-meta`). Each row links to `/chats/view/:id` via `navigate`. Empty state: mono `no sessions yet`.
- **`components/ProviderStatus.tsx`** — mono `status` heading; rows for on-device STT and AI model from `useApp`, values mono, green `ok` dot when connected/configured, `text-meta` dot otherwise. Matches the mockup's provider block exactly (fully real data).

### Page (`pages/dashboard/index.tsx`)
Replaces the current Welcome component. Responsibilities: fetch state + compose zones. Fetching:
- Local state `conversations: ChatConversation[]`, loaded via `getAllConversations()` in an effect on mount.
- Refresh on window focus: a `getCurrentWindow().onFocusChanged` (Tauri) or `window` `focus` listener calls the loader again, so ending a session in the overlay and switching to the dashboard shows the updated data. (This is the "DB is the shared state" bridge; ④ replaces it with event push.)
- No use of the heavy `useHistory` hook — a focused direct call to the `getAllConversations()` lib function keeps the page's dependencies minimal.

## Window wiring
Change the dashboard window's initial URL in `src-tauri/src/window.rs` (`create_dashboard_window`) from `/chats` to `/dashboard`, so ⌘⇧D lands on the new view. Nothing else in the window model changes (that's ③).

## Error / empty handling
- DB read failure: catch, log, treat as empty (each zone shows its empty state). No crash, no error UI in v1 (read-only, non-critical surface).
- Every zone has an explicit empty state (above) so a fresh install with no history renders cleanly.

## Verification
- `npx tsc --noEmit` + `npm run build` green.
- Visual review in `npm run tauri dev`: ⌘⇧D opens the three-zone dashboard; with existing chat history the feed/metrics/recent-sessions populate; provider/status shows real names + ok dots; empty states render on a fresh profile.
- Slate & signal conventions hold: mono system voice, signal blue only on the answer rule + live/actionable, hairline structure, no off-palette colors.

## Out of scope (later sub-projects)
- Token-by-token live streaming into the zones + live `listening` timer (④, cross-window event sync).
- Dashboard-primary on launch / overlay demoted to opt-in pop-out (③).
- LLM-generated bullet summary of a session (future).
- Coding panel (future).
