# useSystemAudio decomposition — design

**Date:** 2026-07-15 · **Status:** Approved, not yet implemented

## Why

`src/hooks/useSystemAudio.ts` is a 1,100-line god-hook: capture lifecycle, streaming STT, Tauri event listeners, AI response handling, conversation persistence, quick actions, context settings, VAD config, and overlay/keyboard UI are all welded together through ~7 shared refs. It's the recommended first step of the "Slate & signal" UI redesign (`docs/design/ui-redesign-slate-and-signal.md`, on `dev`): a dashboard-first layout and later cross-window state sync are both dramatically easier against small, focused hooks than against this one file.

This decomposition is scoped as a **pure, behavior-preserving split** — not a rewrite, and not the cross-window state work (that's a deliberate later step once the dashboard shell exists and forces the state-location decision anyway).

## Constraints

- **No behavior change.** `useSystemAudio()`'s return object keeps the exact same shape — same keys, same values, same semantics. Its three consumers (`src/hooks/useApp.ts`, `src/pages/app/components/speech/index.tsx` which spreads `useSystemAudioType` as props, and `src/pages/app/components/speech/SettingsPanel.tsx` which imports the `VadConfig` type) require zero changes.
- **No new tooling.** The project has no test runner (`grep` confirms zero `*.test.*`/`*.spec.*` files, no vitest/jest/testing-library in `package.json`). Verification is `tsc` + `vite build` (both already in `npm run build`) plus manual smoke testing — not a new test suite.
- **`useSystemAudioType = ReturnType<typeof useSystemAudio>`** stays exactly where it is and is the primary safety net: any return-shape drift breaks the typecheck immediately in the two files that consume the full type.

## File layout

```
src/hooks/system-audio/
  useQuickActions.ts              # CRUD-list + persistence, no engine deps
  useContextSettings.ts           # system prompt / context toggle + persistence
  useVadConfig.ts                 # VadConfig type + load/save/update
  useCaptureKeyboardShortcuts.ts  # scroll + recording keyboard sink
  useCaptureEngine.ts             # the ref-coupled core, relocated as-is
src/hooks/useSystemAudio.ts       # composition root (~60-80 lines)
```

`useSystemAudio.ts` stays at its current path so the `hooks/index.ts` barrel (`export * from "./useSystemAudio"`) and the `@/hooks/useSystemAudio` import path (used for the `VadConfig` type in `SettingsPanel.tsx`) keep working untouched. `VadConfig` is defined in `useVadConfig.ts` and re-exported from `useSystemAudio.ts`.

## Hook boundaries

The dividing line is coupling risk: four concerns (streaming socket, capture-event listeners, `processWithAI`, conversation state) are welded together through refs that exist specifically to dodge stale closures inside long-lived `listen()` callbacks. That cluster is relocated whole, not restructured. Everything with low coupling is extracted independently.

- **`useQuickActions()`** — independent. Returns `quickActions`, `addQuickAction`, `removeQuickAction`, `isManagingQuickActions`/setter, `showQuickActions`/setter, plus the load/save persistence effect. `handleQuickActionClick` is **not** here — it drives `processWithAI` and conversation state, so it stays with the engine.

- **`useContextSettings(systemPrompt: string)`** — independent except for the global `systemPrompt` (from `useApp()`), passed in as a parameter. Owns `useSystemPrompt`/`contextContent` state and persistence, plus a new stable `getEffectiveSystemPrompt(): string` (ref-backed, like the existing ref-sync pattern already used elsewhere in the hook: assign `ref.current = value` on every render, read only from callbacks).

  **Deliberate non-mechanical change:** the expression `useSystemPrompt ? systemPrompt || DEFAULT : contextContent || DEFAULT` is currently duplicated three times inline (streaming-socket handler, speech-detected listener, `handleQuickActionClick`). `getEffectiveSystemPrompt()` centralizes it into one function all three call sites use. The computed value is identical in every case — this is a dedup, not a behavior change.

- **`useVadConfig()`** — independent. Returns `vadConfig`, `updateVadConfiguration`, owns the load effect and the `VadConfig` interface/`DEFAULT_VAD_CONFIG`.

- **`useCaptureKeyboardShortcuts(params)`** — a *sink* hook, not a state owner. Takes the engine's already-computed values as arguments (`isPopoverOpen`, `isContinuousMode`, `isRecordingInContinuousMode`, `isProcessing`, `isAIProcessing`, `startContinuousRecording`, `manualStopAndSend`, `ignoreContinuousRecording`), owns the two `window.addEventListener("keydown", ...)` effects (arrow-key scroll, and Enter/Escape/Space recording shortcuts), returns `scrollAreaRef`.

- **`useCaptureEngine(...)`** — everything else, internals unchanged: streaming socket (`openStreamingSocket`/`closeStreamingSocket`/`buildStreamingUrl`), both Tauri `listen()` effects (continuous-recording events; `speech-start`/`speech-chunk`/`speech-detected`), `processWithAI`, conversation state + debounced SQLite persistence, `startCapture`/`stopCapture`/`startContinuousRecording`/`ignoreContinuousRecording`/`manualStopAndSend`/`handleSetup`/`handleQuickActionClick`/`startNewConversation`, the popover auto-open effect, the `vadConfig.enabled ↔ isContinuousMode` sync effect, and global-shortcut registration (`registerSystemAudioCallback`).

  Takes `getEffectiveSystemPrompt` (from `useContextSettings`) and `vadConfig` (from `useVadConfig`) as inputs; everything else it currently reads from `useApp()`/`useSttStatus()`/`useWindowResize()`/`useGlobalShortcuts()` directly, unchanged.

  **Why the popover auto-open effect and the VAD↔continuous-mode sync stay here rather than in their "natural" hook:** both read state that's now split across hooks and write engine-owned state (`isPopoverOpen`, `isContinuousMode`, `isRecordingInContinuousMode`). Extracting them would mean threading setters back across a hook boundary for no isolation benefit.

## Composition root

`useSystemAudio()` calls the five hooks above in order (`useQuickActions`, `useContextSettings`, `useVadConfig`, then `useCaptureEngine` wired with their outputs, then `useCaptureKeyboardShortcuts` wired with the engine's outputs), and returns the same ~40-key object as today — same names, same values, same order not required (object literal). No new keys, no removed keys, no renamed keys.

## Error handling

Unchanged. `error`/`setError` remains engine-owned (it's set from capture lifecycle, the STT/AI listeners, and `processWithAI` — all engine concerns) and returned as-is from the composition root.

## Verification

1. `tsc` (via `npm run build`) and `vite build` both green — catches any return-shape or type drift immediately via `useSystemAudioType`.
2. Manual smoke test covering: VAD-triggered capture (speech-detected → batch STT → AI answer), continuous/manual mode (start/stop/ignore via keyboard and buttons), streaming STT provider path, quick actions (add/remove/click), context settings toggle (system prompt vs. custom context — verify `getEffectiveSystemPrompt` produces identical output to the old inline expression in both states), VAD config changes, and the overlay keyboard shortcuts (arrow scroll, Enter/Escape/Space).
3. No new test tooling introduced.

## Out of scope

- Splitting `useCaptureEngine` further (streaming/listeners/AI/conversation as separate hooks) — deferred to when cross-window state work forces relocating this state anyway (design doc step 4).
- Any dashboard UI, theming, or window-model work.
- Moving state out of the React tree / into a shared store.
