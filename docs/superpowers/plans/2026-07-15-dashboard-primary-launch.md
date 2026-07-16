# Dashboard-primary Launch Implementation Plan (sub-project ③)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard the focused primary window on launch and demote the overlay bar to an opt-in pop-out, with a dock re-activation path and a dashboard pop-out control.

**Architecture:** Pure window/launch wiring in `src-tauri` plus one React button. Add a `show_overlay` command mirroring the existing toggle's show branch; hide the overlay + show/focus the dashboard at the end of `setup()`; add a macOS `RunEvent::Reopen` handler; add a pop-out button to the dashboard StatusLine. No capture-engine or hook changes.

**Tech Stack:** Tauri v2 (Rust: `setup`, `RunEvent`, `WindowVisibility` state, `tauri_nspanel` panel), React + `@tauri-apps/api/core` `invoke`.

## Global Constraints

- **No React engine / hook / capture changes.** Only `src-tauri/src/{shortcuts.rs,lib.rs,window.rs}` and `src/pages/dashboard/components/StatusLine.tsx`.
- **Overlay stays screen-share-invisible** — reuse the existing NSPanel show path (`get_webview_panel("main")`); do not rebuild panel behavior.
- **`is_hidden` (WindowVisibility)** is authoritative only on Windows toggling; still set it on launch-hide for cross-platform consistency.
- **Close dashboard = hide** (existing handler unchanged); dock click / ⌘⇧D restores.
- **Verification:** `cd src-tauri && cargo check` for Rust tasks; `npx tsc --noEmit && npm run build` for the React task; manual launch check at the end.
- Commit after every task.

---

## File structure

```
src-tauri/src/shortcuts.rs   # + show_overlay command (standalone, mirrors toggle show branch)
src-tauri/src/lib.rs         # register command; setup() launch flip; RunEvent::Reopen handler
src-tauri/src/window.rs      # non-macOS create_dashboard_window visible(true)
src/pages/dashboard/components/StatusLine.tsx  # + pop-out button (invoke show_overlay)
```

---

## Task 1: `show_overlay` command

**Files:**
- Modify: `src-tauri/src/shortcuts.rs` (add command near `handle_toggle_window`)
- Modify: `src-tauri/src/lib.rs` (register in `invoke_handler!`)

**Interfaces:**
- Produces: `#[tauri::command] shortcuts::show_overlay(app)` — invokable from the frontend as `invoke("show_overlay")`.

- [ ] **Step 1: Add the command to `shortcuts.rs`**

Add immediately after the `handle_toggle_window` function. It mirrors the toggle's **show** branch (macOS/Linux) and the Windows show path, and always marks the overlay shown:

```rust
/// Show and focus the overlay (main) window. Used by the dashboard pop-out
/// control; mirrors the show branch of `handle_toggle_window` so the two do
/// not diverge, without touching that platform-forked function.
#[tauri::command]
pub fn show_overlay(app: AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    {
        let state = app.state::<WindowVisibility>();
        if let Ok(mut is_hidden) = state.is_hidden.lock() {
            *is_hidden = false;
        }
    }

    if let Err(e) = window.show() {
        eprintln!("Failed to show overlay: {}", e);
    }
    if let Err(e) = window.set_focus() {
        eprintln!("Failed to focus overlay: {}", e);
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(panel) = app.get_webview_panel("main").ok() {
            panel.show();
        }
    }

    if let Err(e) = window.emit("toggle-window-visibility", false) {
        eprintln!("Failed to emit toggle-window-visibility: {}", e);
    }
}
```

Note on the macOS panel accessor: `handle_toggle_window` calls `app.get_webview_panel("main").unwrap()`. Use the non-panicking `.ok()` form here. If `get_webview_panel` is not in scope in the file, it is provided by the same `tauri_nspanel` import that `handle_toggle_window` relies on — confirm the trait is imported at the top of `shortcuts.rs` (it must be, since `handle_toggle_window` compiles). `AppHandle`, `Manager` (for `.state()`/`.get_webview_window()`), `Runtime`, and `Emitter` (for `.emit()`) are already used in this file.

- [ ] **Step 2: Register the command in `lib.rs`**

In the `tauri::generate_handler![ ... ]` list, add after `shortcuts::exit_app,`:

```rust
            shortcuts::show_overlay,
```

- [ ] **Step 3: Rust check**

Run: `cd src-tauri && cargo check`
Expected: compiles clean. If `get_webview_panel` errors as unknown, add the same nspanel trait import `handle_toggle_window`'s show branch uses (search the file for how the panel type/trait is brought in) — do not change `handle_toggle_window`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/shortcuts.rs src-tauri/src/lib.rs
git commit -m "feat(window): add show_overlay command for dashboard pop-out"
```

---

## Task 2: Launch flip — hide overlay, show + focus dashboard

**Files:**
- Modify: `src-tauri/src/lib.rs` (`setup` closure, right after the dashboard pre-create block)

- [ ] **Step 1: Insert the launch-flip block**

In `setup()`, the current pre-create block is:

```rust
            let app_handle = app.handle();
            if app_handle.get_webview_window("dashboard").is_none() {
                if let Err(e) = window::create_dashboard_window(&app_handle) {
                    eprintln!("Failed to pre-create dashboard window on startup: {}", e);
                }
            }
```

Immediately **after** that `if` block, add:

```rust
            // Dashboard-primary launch: the dashboard is the focused primary
            // window; the overlay starts hidden and is summoned on demand
            // (⌘\ or the dashboard pop-out button). Runs after setup_main_window
            // + init() so the overlay is fully realized and its capture engine
            // has mounted before we hide it.
            if let Some(dashboard) = app_handle.get_webview_window("dashboard") {
                let _ = dashboard.show();
                let _ = dashboard.set_focus();
            }
            if let Some(main) = app_handle.get_webview_window("main") {
                let _ = main.hide();
                let state = app_handle.state::<shortcuts::WindowVisibility>();
                if let Ok(mut is_hidden) = state.is_hidden.lock() {
                    *is_hidden = true;
                }
            }
```

`app_handle.state::<...>()` requires `Manager` in scope — already imported (`use tauri::{AppHandle, Manager, WebviewWindow};`).

- [ ] **Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(window): dashboard-primary on launch; overlay starts hidden"
```

---

## Task 3: Non-macOS dashboard window visible on create

**Files:**
- Modify: `src-tauri/src/window.rs` (`create_dashboard_window`, non-macOS builder)

- [ ] **Step 1: Flip non-macOS visibility**

In `create_dashboard_window`, the non-macOS builder ends with `.visible(false)`. Change it to `.visible(true)` so the dashboard shows on launch on all platforms (macOS is already `visible(true)`):

```rust
    #[cfg(not(target_os = "macos"))]
    let base_builder = base_builder
        .title("Assistant - Dashboard")
        .center()
        .decorations(true)
        .inner_size(800.0, 600.0)
        .min_inner_size(800.0, 600.0)
        .content_protected(true)
        .visible(true);
```

- [ ] **Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/window.rs
git commit -m "feat(window): show dashboard window on launch (non-macOS parity)"
```

---

## Task 4: macOS dock re-activation (`RunEvent::Reopen`)

**Files:**
- Modify: `src-tauri/src/lib.rs` (the final `builder.run(...)` call)

- [ ] **Step 1: Replace `run` with `build` + `run(closure)`**

The current tail of `run()` is:

```rust
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

Replace with:

```rust
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // macOS dock click with the dashboard hidden: bring it back focused.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Err(e) = window::show_dashboard_window(app_handle) {
                eprintln!("Failed to reopen dashboard on dock activation: {}", e);
            }
        }
        // Silence unused warnings on non-macOS where the arm is compiled out.
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, &event);
        }
    });
```

`window::show_dashboard_window(&AppHandle)` already exists and is `pub`. The `run` closure passes `app_handle: &AppHandle`, matching its signature.

- [ ] **Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: compiles clean. If a `RunEvent` variant match warns about non-exhaustive, the `{ .. }` binding + single `if let` avoids it (no `match` used).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(window): restore dashboard on macOS dock re-activation"
```

---

## Task 5: Dashboard pop-out button

**Files:**
- Modify: `src/pages/dashboard/components/StatusLine.tsx`

- [ ] **Step 1: Add the pop-out button**

Replace the file with (adds `invoke` import, a lucide icon, and a pop-out button on the right of the statusline before the provider group):

```tsx
import { useApp } from "@/contexts";
import { invoke } from "@tauri-apps/api/core";
import { PictureInPicture2 } from "lucide-react";

export const StatusLine = () => {
  const { selectedAIProvider, selectedSttProvider } = useApp();
  const ai = selectedAIProvider.provider || "no model";
  const stt = selectedSttProvider.provider || "no stt";

  const popOut = () => {
    invoke("show_overlay").catch((e) =>
      console.error("Failed to show overlay:", e)
    );
  };

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
        <button
          onClick={popOut}
          title="Pop out the overlay — on top, invisible to screen share"
          className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-input hover:text-primary"
        >
          <PictureInPicture2 className="size-3" />
          pop out
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/dashboard/components/StatusLine.tsx
git commit -m "feat(dashboard): pop-out button to summon the overlay"
```

---

## Task 6: Full verification

**Files:** none.

- [ ] **Step 1: Full compile**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit && npm run build`
Expected: all clean.

- [ ] **Step 2: Manual launch check**

Run: `npm run tauri dev` (fresh, from this worktree).
Checklist:
- On launch: the **dashboard** window is focused and primary; the overlay bar is **not** visible.
- Click the statusline **pop out** button → the overlay appears (floating, always-on-top). Press ⌘\ → it toggles hidden/shown too.
- With the overlay hidden, press ⌘⇧M → capture starts; speak → a transcript lands; switch focus to the dashboard → the feed/metrics reflect the session (② focus-refresh).
- Close the dashboard (⌘W or red X) → it hides (app stays running). Click the dock icon → the dashboard returns focused. ⌘⇧D also toggles it.
- Overlay remains screen-share-invisible (unchanged NSPanel behavior).

- [ ] **Step 3: Commit (only if a fix was needed)**

If manual testing surfaced a fix, apply it, re-run Step 1, commit with a specific message. Otherwise ③ is complete.

---

## Self-Review

**Spec coverage:** show_overlay command + register → Task 1; overlay-hidden + dashboard show/focus on launch → Task 2; non-macOS visible parity → Task 3; RunEvent::Reopen dock restore → Task 4; StatusLine pop-out button → Task 5; verification incl. capture-with-overlay-hidden and close/reopen → Task 6. Decisions 1–4 from the spec all map to tasks. No gaps.

**Placeholders:** none — every step carries exact before/after code and exact commands.

**Type consistency:** `show_overlay` is registered as `shortcuts::show_overlay` (module placement noted; frontend calls it by the bare command name `show_overlay`, which is placement-independent). `window::show_dashboard_window(&AppHandle)` signature matches the `run` closure's `app_handle`. StatusLine keeps its existing no-props/`useApp` shape; only adds `invoke` + a button.
