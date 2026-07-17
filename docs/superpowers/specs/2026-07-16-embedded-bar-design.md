# Embedded bar — design

**Date:** 2026-07-16 · **Status:** Approved · **Branch:** all work lands on `dev`

## Why

The dashboard should *be* the app: the capture bar embedded and fully usable inside
it, with the screen-share-invisible pop-out as an on-demand mode. Sub-projects ③/④
built the opposite — a dashboard that *mirrors* a separate overlay via a standalone
control strip — which felt bolted-on and destabilized startup (③ hid the overlay and
the app failed to foreground). ③'s launch flip is already reverted (`e2f22b0`); this
replaces the dashboard's top region with an embedded bar and makes the dashboard a
proper foreground window.

## Locked decisions

1. **Detach model:** one bar, one place at a time. Embedded in the dashboard by
   default; pop out → it detaches into the floating panel; pop in → returns.
2. **Engine stays in the overlay window (`main`), unchanged.** The popped-out state is
   therefore the existing, proven, screen-share-invisible NSPanel bar — zero risk to
   the mission-critical feature. The dashboard's embedded bar is a mirror + command
   surface, reusing ④'s `useLiveSession` (verified working).
3. **Delete** the standalone `start capture` button and the separate `CaptureControls`
   strip — the embedded bar carries the controls.

## Two states

- **Popped in (default):** overlay window hidden (its webview + engine keep running).
  The dashboard's top region is the **embedded bar** — the instrument bar UI driven by
  the snapshot + `sendCommand`. Transcript/answers/metrics/summary stream below (④).
- **Popped out:** overlay window shown (the real always-on-top invisible bar, untouched).
  The dashboard's bar slot shows a quiet `popped out · ⌘\ to bring back` placeholder;
  the transcript/answer zones keep streaming. Toggle via the bar's pop button or ⌘\.

## Foregrounding fix (the piece ③ skipped)

When the overlay is hidden and the dashboard is the visible window, the app must
activate as a normal foreground app (menu bar, proper focus). Approach, in order:
1. `set_activation_policy(Regular)` (already invoked via `set_app_icon_visibility`) +
   `dashboard.show()` + `dashboard.set_focus()` on the reopen/pop-in path.
2. If that alone doesn't foreground on macOS (main is a non-activating NSPanel), call
   `NSApplication::sharedApplication().activateIgnoringOtherApps(true)` via
   `tauri_nspanel::cocoa::appkit` — already a crate dependency. Applied in the
   dashboard show path (`show_dashboard_window`) and the `RunEvent::Reopen` handler.
- On startup the overlay stays visible (current reverted state); pop-in is what hides
  it, and pop-in goes through the foregrounding path — so the app never lands in the
  un-foregrounded state that broke ③.

## Components

- **New `EmbeddedBar`** (`src/pages/dashboard/components/EmbeddedBar.tsx`): the
  dashboard's top region. Renders the instrument-bar layout (status word + timer,
  capture button, input, accessory cluster) from the `LiveSessionSnapshot` and calls
  `sendCommand(...)`; input submits via a `submit` command (see data flow). When
  `snapshot` shows the overlay is popped out, renders the placeholder instead.
- **Reuse:** the visual language of the overlay's two-band bar
  (`src/pages/app/index.tsx`) — extract its presentational pieces so both the overlay
  and the embedded bar share one look (avoids a third status-ladder copy; the
  `deriveSessionStatus` helper from ④ already centralizes the words).
- **Delete:** `CaptureControls.tsx`; remove the standalone capture button from
  `StatusLine.tsx` (StatusLine keeps only brand + provider readout + pop toggle, or is
  absorbed into `EmbeddedBar` — decided at plan time).
- **`index.tsx`:** top region becomes `EmbeddedBar`; zones below unchanged from ④.

## Data flow additions

- The embedded bar's **text input** needs to submit a prompt to the engine. Add one
  command to the ④ contract: `LIVE_SESSION_COMMAND` action `{ action: "submit",
  text: string }` (the action type becomes a discriminated union). The engine's
  command listener routes `submit` to the completion `submit()` path. All other
  controls already exist as commands.
- Pop in/out continues to use the existing `toggle_overlay` / `is_overlay_visible`
  commands and `toggle-window-visibility` event (now typed in `live-session.ts`).

## Error handling

Unchanged from ④: engine errors arrive in the snapshot and render on the bar's status
word. Foregrounding failures log and fall through to the next approach; worst case the
window still shows, just possibly unfocused (recoverable via dock click).

## Verification

- `cargo check`, `tsc`, `vite build`, `vitest` green.
- Manual (user-driven, their terminal): launch → overlay bar visible as now; open
  dashboard (⌘⇧D) → embedded bar present and the app has a menu bar / foregrounds;
  from the embedded bar start capture, type + submit, watch transcript/answers; click
  pop out → invisible floating bar appears, dashboard shows the placeholder but keeps
  streaming; pop in → bar returns, overlay hidden, dashboard still foreground. Confirm
  system audio still captured (headphone-output test) and the popped-out bar is absent
  from a screen recording.

## Out of scope (fast-follow, own spec)

- **Capture source toggle (mic vs system audio)** — the native `MicInput` already
  exists; a source selector on the bar + a `source` param on capture start. Small, next.
- Removing the ④ mirror entirely / moving the engine — explicitly rejected above.
