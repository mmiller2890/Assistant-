# Dashboard-primary launch — design (sub-project ③)

**Date:** 2026-07-15 · **Status:** Approved · **Parent direction:** `docs/design/ui-redesign-slate-and-signal.md`

## Why

Sub-project ③: flip the app's default posture. Today the screen-share-invisible overlay bar is front-and-center on launch and the dashboard is a secondary window. After this, the **dashboard is the primary work view** shown on launch, and the overlay becomes an **opt-in pop-out** (the sleek floating pill). This is the "make the dashboard primary" step the direction doc calls "mostly wiring." No React engine changes.

## Decisions locked during brainstorming

1. **Launch:** dashboard shown + focused; overlay (`main`) starts hidden.
2. **Capture start while overlay is hidden:** via the ⌘⇧M global shortcut or by popping out the overlay. A dashboard-native "start capture" button drives the overlay engine cross-window and is deferred to ④.
3. **Close dashboard = hide** (existing hide-on-close), not quit — a stray ⌘W must not kill a live interview session. Dock click / ⌘⇧D restores it.
4. **Overlay summon** reuses the existing `handle_toggle_window` show path; a new dashboard pop-out button plus the existing ⌘\ shortcut both surface it.

## Current mechanics (verified)

- `setup()` in `src-tauri/src/lib.rs`: `setup_main_window(app)` positions the overlay; `init(app_handle)` (macOS) converts `main` into a non-activating NSPanel float; then the dashboard window is pre-created via `create_dashboard_window`.
- Overlay `main` in `tauri.conf.json`: `visible: true, focus: false`. It hosts the capture engine (React `useCaptureEngine`) in its webview.
- `handle_toggle_window` (`shortcuts.rs`) shows/hides `main` with correct NSPanel handling, tracks `WindowVisibility.is_hidden`, emits `toggle-window-visibility`. Bound to ⌘\. It is **not** currently exposed as an invokable command.
- `create_dashboard_window` (`window.rs`): macOS builder `visible(true)`, non-macOS `visible(false)`; hide-on-close handler already prevents destroy and hides instead.
- No system tray. Dock icon via activation policy. `builder.run(generate_context!())` has no custom `RunEvent` handler.

## Changes

### 1. Overlay starts hidden (`lib.rs` `setup`)
At the **end** of `setup()` — after `setup_main_window` and `init()` have realized the window, mounted its webview (engine mounts), and applied NSPanel behavior — hide the overlay and sync visibility state:
- `main.hide()`
- set `WindowVisibility.is_hidden = true` (so the first ⌘\ toggles to shown, staying consistent with `handle_toggle_window`'s toggle logic).

Rationale for hiding in `setup()` rather than `tauri.conf visible:false`: preserves all existing init ordering (positioning reads `outer_size`; panel conversion; webview/engine mount) and only changes the final visibility. Lower risk.

### 2. Dashboard shown + focused on launch
- `create_dashboard_window`: change the non-macOS builder from `visible(false)` to `visible(true)` for parity (macOS already `visible(true)`).
- In `setup()`, after the pre-create, `show()` + `set_focus()` the dashboard window so it is the focused primary on launch.
- (The dashboard initial URL is already `/dashboard` from sub-project ②.)

### 3. `show_overlay` command + dashboard pop-out button
- Add `#[tauri::command] window::show_overlay(app)` that mirrors `handle_toggle_window`'s **show** branch: show `main`, on macOS re-show the panel, set `WindowVisibility.is_hidden = false`, emit `toggle-window-visibility(false)`. Extract the shared show logic so `handle_toggle_window` and `show_overlay` do not diverge.
- Register `window::show_overlay` in the `invoke_handler!` list in `lib.rs`.
- Add a **pop-out button** to `src/pages/dashboard/components/StatusLine.tsx`: mono label `pop out` (or an icon), `invoke("show_overlay")` on click. Slate & signal styling (steel chip, hairline, signal only on hover/active). Matches the mockup's "pop-out — on top, invisible to screen share" element.

### 4. Dock re-activation (macOS)
- Change `builder.run(tauri::generate_context!())` to `let app = builder.build(tauri::generate_context!()).expect(...)` then `app.run(|app_handle, event| { ... })`.
- Handle `tauri::RunEvent::Reopen { .. }` (macOS dock click): show + focus the `dashboard` window (create it via `show_dashboard_window` if somehow absent). Keeps other event behavior default.

## Out of scope
- Dashboard-native "start/stop capture" controls (cross-window engine control) → ④.
- Live state streaming into the dashboard → ④.
- Any change to the capture engine, hooks, or React state model.
- Single-reshaping-window model (rejected earlier in favor of multi-window + sync).

## Error handling
- Every window lookup already returns `Option`; keep the existing `if let Some(...)` / `eprintln!` on failure pattern. A failed overlay-hide or dashboard-focus logs and continues (non-fatal — app still runs).

## Verification
- `cd src-tauri && cargo check` compiles clean.
- `npm run build` green (StatusLine change).
- Manual (`npm run tauri dev`, fresh):
  - On launch: dashboard window is focused and primary; overlay bar is **not** visible.
  - Dashboard pop-out button → overlay appears (floating, screen-share-invisible); ⌘\ toggles it too.
  - ⌘⇧M starts capture with the overlay hidden; transcripts land in the DB and the dashboard reflects them on focus (② behavior).
  - Close the dashboard (⌘W / red X) → it hides; macOS dock click → it returns focused; ⌘⇧D also toggles it.
