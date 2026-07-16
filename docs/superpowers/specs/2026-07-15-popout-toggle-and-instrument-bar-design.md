# Pop-out toggle + instrument bar — design (sub-project ③b)

**Date:** 2026-07-15 · **Status:** Approved ("make the placement as unique as possible and then proceed") · **Parent:** ③ dashboard-primary launch

## Why

Two user findings from testing ③:
1. The pop-out should be a **true toggle** — press to pop out, press again to pop back in — and the overlay must never surface uninvited (⌘⇧M currently force-shows it). The dashboard is the app's center of gravity.
2. The overlay bar still **reads as a Pluely fork** — same `[buttons][input][buttons]` pill. The user asked for placement "as unique as possible."

## A. Toggle semantics

1. **`toggle_overlay` command** (`shortcuts.rs`): wraps the existing `handle_toggle_window` (battle-tested show/hide incl. NSPanel), then returns the overlay's new visibility as `bool`. Replaces `show_overlay` (delete it — nothing else uses it; registration list updated).
2. **`is_overlay_visible` query command**: returns `main.is_visible()` for the button's initial state.
3. **Visibility event on all platforms**: `handle_toggle_window`'s macOS/Linux branches emit `toggle-window-visibility` (currently Windows-only) so the dashboard button stays honest when ⌘\ is used. Emit via the app handle (broadcast), value = new visibility (`false` = hidden). Note the event's existing Windows semantics are `is_hidden` (true = hidden) — keep that polarity everywhere to avoid breaking the overlay's `useAppLifecycle` listener.
4. **StatusLine button** becomes `pop out` ⇄ `pop in`: initial state from `is_overlay_visible`, updates from the `toggle_overlay` return value and the `toggle-window-visibility` event listener.
5. **⌘⇧M stops surfacing the overlay**: remove the ensure-visible block from `handle_system_audio_shortcut` — capture toggles headless. **Deliberately kept:** ⌘⇧A (voice input) and ⌘⇧I (focus input) still show the overlay; those are explicit "bring me the overlay" gestures.

## B. Instrument bar (maximally distinct layout)

Replace the fork's single-row pill with a **two-band miniature instrument panel**:

```
┌──────────────────────────────────────────────────────────────┐
│ ● idle                              ⌘⇧M capture · ⌘\ hide     │  ← status band (mono, drag region)
│ [◧] [🎧]  input………………………………………  │ [mic][shot][files]         │  ← control row
└──────────────────────────────────────────────────────────────┘
```

- **Top status band** (~14px, `font-mono text-[9px]`): left — state word with dot (`● idle` in text-meta; `● listening`/`transcribing`/`answering` with signal/status colors, derived from the same systemAudio props `StatusIndicator` uses); right — kbd hints `⌘⇧M capture · ⌘\ hide` in `text-meta`. The band carries `data-tauri-drag-region` and **replaces the `DragButton` grip entirely** (no grip handle = one less fork tell; the whole band drags).
- **Bottom control row** (h-7 controls): `[logo mark → dashboard]` `[capture button]` hairline `border-l` separator, `[Input flex-1]`, separator, `[voice][screenshot][files]` accessory cluster right. The logo mark is the same bordered-square-with-signal-dot as the dashboard StatusLine and **clicks through to the dashboard** (replaces the ✨ Sparkles button).
- **While capturing**: control row swaps to `[logo][capture][AudioVisualizer flex][StatusIndicator]` (existing behavior, new placement); status band shows the live state word.
- **Bar height 54 → 64px** to fit two bands: `tauri.conf.json` window height and `useWindow.ts:22` collapsed constant (the only two definitions).
- `Updater` stays (conditional chip, unchanged). `CustomCursor` unchanged.
- Components are **reordered/rewrapped, not rewritten**: `SystemAudio`, `Completion`'s children (`Audio`, `Input`, `Screenshot`, `Files`), `AudioVisualizer`, `StatusIndicator` keep their internals; `Completion` is restructured so `Input` and the accessory cluster can be placed separately (split render, same `useCompletion()` instance).

## Out of scope
- Dashboard capture controls & live state (④ — remembered).
- Any capture-engine/hook changes.

## Error handling
Unchanged patterns: command failures `eprintln!`/console.error; the button falls back to optimistic local state if the query fails.

## Verification
- `cargo check`, `tsc`, `vite build` green.
- Manual: button toggles out/in with label flipping; ⌘\ also flips the label; ⌘⇧M starts capture **without** showing the overlay; popped-out bar shows the two-band layout, drags by the status band, logo opens dashboard, input + accessories work, capture swaps to visualizer; bar fits at 64px with no clipping.
