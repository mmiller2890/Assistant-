# useSystemAudio Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1,100-line `src/hooks/useSystemAudio.ts` god-hook into focused hooks under `src/hooks/system-audio/`, with `useSystemAudio` reduced to a thin composition root that returns the identical object.

**Architecture:** Extract the three independent leaf concerns (VAD config, quick actions, context settings) and the keyboard-shortcut sink into their own hooks one at a time, each wired back into `useSystemAudio` and verified green before the next. The ref-coupled core (streaming socket + Tauri listeners + `processWithAI` + conversation store + capture lifecycle) is moved wholesale into `useCaptureEngine` last, its internals unchanged. Behavior is preserved exactly; the public return shape never changes.

**Tech Stack:** React (hooks), TypeScript (strict, `noEmit`, `noUnusedLocals`/`noUnusedParameters`), Tauri IPC (`@tauri-apps/api`), Vite.

## Global Constraints

- **No behavior change.** The `useSystemAudio()` return object keeps identical keys, values, and semantics. Consumers (`src/hooks/useApp.ts`, `src/pages/app/components/speech/index.tsx`, `src/pages/app/components/speech/SettingsPanel.tsx`) require zero edits.
- **`useSystemAudio.ts` stays at its current path** and must keep re-exporting `VadConfig` (SettingsPanel imports `VadConfig` from `@/hooks/useSystemAudio`).
- **`useSystemAudioType = ReturnType<typeof useSystemAudio>`** stays defined in `useSystemAudio.ts` and is unchanged.
- **No new test tooling.** Per-task verification gate is `npx tsc --noEmit` (must be clean — `noUnusedLocals`/`noUnusedParameters` catch leftover refs/imports/params). Final gate is `npm run build` + manual smoke.
- **Preserve the raw-vs-persisting `setUseSystemPrompt` distinction** (see Task 3): `startNewConversation` uses the non-persisting raw setter; the public API exposes the persisting updater.
- **Commit after every task** with `tsc` green.

---

## File structure

```
src/hooks/system-audio/
  useVadConfig.ts                  # VadConfig type + DEFAULT_VAD_CONFIG + state/load/update
  useQuickActions.ts               # quick-action list state + persistence + CRUD
  useContextSettings.ts            # system-prompt/context toggle + persistence + getEffectiveSystemPrompt
  useCaptureKeyboardShortcuts.ts   # scroll + recording keydown effects; owns scrollAreaRef
  useCaptureEngine.ts              # relocated ref-coupled core (unchanged internals)
src/hooks/useSystemAudio.ts        # composition root; re-exports VadConfig; defines useSystemAudioType
```

---

## Task 1: Extract `useVadConfig`

**Files:**
- Create: `src/hooks/system-audio/useVadConfig.ts`
- Modify: `src/hooks/useSystemAudio.ts` (remove VAD state/type/load/update; call the new hook; re-export `VadConfig`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `useVadConfig(): { vadConfig: VadConfig; updateVadConfiguration: (config: VadConfig) => Promise<void> }` and `export interface VadConfig`.

Notes for the implementer:
- The current combined load effect at `useSystemAudio.ts:243-266` loads **both** the system-audio context **and** `vad_config`. In this task, move **only** the `vad_config` portion (`useSystemAudio.ts:257-265`) into `useVadConfig`. Leave the context-loading portion (`useSystemAudio.ts:243-256`) where it is — Task 3 relocates it.
- The `vadConfig.enabled ↔ isContinuousMode` sync effect (`useSystemAudio.ts:976-984`) and the popover auto-open effect stay in `useSystemAudio` (they belong to the engine). They read `vadConfig` — that keeps working because `useSystemAudio` now holds `vadConfig` from the new hook.

- [ ] **Step 1: Create `src/hooks/system-audio/useVadConfig.ts`**

```ts
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { safeLocalStorage } from "@/lib";

export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
  emit_chunks?: boolean;
  chunk_interval_ms?: number;
}

const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012,
  peak_threshold: 0.035,
  silence_chunks: 45,
  min_speech_chunks: 7,
  pre_speech_chunks: 12,
  noise_gate_threshold: 0.003,
  max_recording_duration_secs: 180,
  emit_chunks: false,
  chunk_interval_ms: 1000,
};

export function useVadConfig() {
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);

  useEffect(() => {
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
      } catch (error) {
        console.error("Failed to load VAD config:", error);
      }
    }
  }, []);

  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  return { vadConfig, updateVadConfiguration };
}
```

- [ ] **Step 2: Edit `useSystemAudio.ts` — remove the moved code**

Delete from `useSystemAudio.ts`:
- The `VadConfig` interface (`28-40`) and `DEFAULT_VAD_CONFIG` (`42-54`).
- The `vadConfig` state declaration (`90`).
- The `vad_config` half of the load effect (`257-265`) — keep lines `243-256` and the effect's `}, []);` closing.
- The `updateVadConfiguration` callback (`966-974`).

Add near the other hook calls (top of `useSystemAudio`):

```ts
const { vadConfig, updateVadConfiguration } = useVadConfig();
```

Add the import at the top:

```ts
import { useVadConfig, type VadConfig } from "./system-audio/useVadConfig";
```

Add a re-export so `@/hooks/useSystemAudio` still resolves `VadConfig` (place after imports):

```ts
export type { VadConfig };
```

Leave the `return { ... vadConfig, updateVadConfiguration ... }` keys exactly as they are.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no output). A leftover reference to the removed `DEFAULT_VAD_CONFIG`/local `vadConfig` state, or an unused import, will surface here as an error — fix before committing.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/system-audio/useVadConfig.ts src/hooks/useSystemAudio.ts
git commit -m "refactor(system-audio): extract useVadConfig from useSystemAudio"
```

---

## Task 2: Extract `useQuickActions`

**Files:**
- Create: `src/hooks/system-audio/useQuickActions.ts`
- Modify: `src/hooks/useSystemAudio.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  ```ts
  useQuickActions(): {
    quickActions: string[];
    addQuickAction: (action: string) => void;
    removeQuickAction: (action: string) => void;
    isManagingQuickActions: boolean;
    setIsManagingQuickActions: React.Dispatch<React.SetStateAction<boolean>>;
    showQuickActions: boolean;
    setShowQuickActions: React.Dispatch<React.SetStateAction<boolean>>;
  }
  ```

Notes:
- `handleQuickActionClick` is **not** part of this hook — it drives `processWithAI`/conversation and stays in the engine (Task 5). It reads `quickActions`? No — it takes `action` as a parameter, so it does not depend on this hook's state.

- [ ] **Step 1: Create `src/hooks/system-audio/useQuickActions.ts`**

```ts
import { useState, useEffect, useCallback } from "react";
import { safeLocalStorage } from "@/lib";
import { DEFAULT_QUICK_ACTIONS, STORAGE_KEYS } from "@/config";

export function useQuickActions() {
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);

  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
  );

  return {
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
  };
}
```

- [ ] **Step 2: Edit `useSystemAudio.ts` — remove the moved code**

Delete from `useSystemAudio.ts`:
- State declarations for `quickActions`, `isManagingQuickActions`, `showQuickActions` (`86-89`).
- The quick-actions load effect (`268-283`).
- `saveQuickActions` (`517-526`), `addQuickAction` (`528-537`), `removeQuickAction` (`539-546`).

Add near the other hook calls:

```ts
const {
  quickActions,
  addQuickAction,
  removeQuickAction,
  isManagingQuickActions,
  setIsManagingQuickActions,
  showQuickActions,
  setShowQuickActions,
} = useQuickActions();
```

Add the import:

```ts
import { useQuickActions } from "./system-audio/useQuickActions";
```

If `DEFAULT_QUICK_ACTIONS` is now unused in `useSystemAudio.ts`, remove it from the `@/config` import (tsc will flag it). Leave `STORAGE_KEYS` and `DEFAULT_SYSTEM_PROMPT` imports — still used. Leave the `return { ... }` keys unchanged.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/system-audio/useQuickActions.ts src/hooks/useSystemAudio.ts
git commit -m "refactor(system-audio): extract useQuickActions from useSystemAudio"
```

---

## Task 3: Extract `useContextSettings` and centralize the effective-prompt expression

**Files:**
- Create: `src/hooks/system-audio/useContextSettings.ts`
- Modify: `src/hooks/useSystemAudio.ts`

**Interfaces:**
- Consumes: the global `systemPrompt: string` (from `useApp()`, already in scope in `useSystemAudio`).
- Produces:
  ```ts
  useContextSettings(systemPrompt: string): {
    useSystemPrompt: boolean;
    setUseSystemPrompt: (value: boolean) => void;   // persisting (updateUseSystemPrompt)
    contextContent: string;
    setContextContent: (content: string) => void;   // persisting (updateContextContent)
    getEffectiveSystemPrompt: () => string;          // stable, ref-backed
    resetUseSystemPrompt: () => void;                // raw setter (NON-persisting) for startNewConversation
  }
  ```

**Critical behavior note:** `startNewConversation` currently calls the *raw* `setUseSystemPrompt(true)` (`useSystemAudio.ts:963`), which does **not** write to localStorage. The public API exposes the *persisting* `updateUseSystemPrompt` under the key `setUseSystemPrompt` (`useSystemAudio.ts:1077`). Preserve both: `resetUseSystemPrompt` is the raw, non-persisting setter used only by the engine's `startNewConversation`; the returned `setUseSystemPrompt` is the persisting one.

- [ ] **Step 1: Create `src/hooks/system-audio/useContextSettings.ts`**

```ts
import { useState, useEffect, useRef, useCallback } from "react";
import { safeLocalStorage } from "@/lib";
import { DEFAULT_SYSTEM_PROMPT, STORAGE_KEYS } from "@/config";

export function useContextSettings(systemPrompt: string) {
  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");

  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
      } catch (error) {
        console.error("Failed to load system audio context:", error);
      }
    }
  }, []);

  const saveContextSettings = useCallback(
    (usePrompt: boolean, content: string) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings)
        );
      } catch (error) {
        console.error("Failed to save context settings:", error);
      }
    },
    []
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(value, contextContent);
    },
    [contextContent, saveContextSettings]
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(useSystemPrompt, content);
    },
    [useSystemPrompt, saveContextSettings]
  );

  // Ref-backed so the returned getter is stable ([] deps) yet always reads
  // current values — matches the ref pattern the engine's listeners rely on.
  const useSystemPromptRef = useRef(useSystemPrompt);
  const systemPromptRef = useRef(systemPrompt);
  const contextContentRef = useRef(contextContent);
  useSystemPromptRef.current = useSystemPrompt;
  systemPromptRef.current = systemPrompt;
  contextContentRef.current = contextContent;

  const getEffectiveSystemPrompt = useCallback(() => {
    return useSystemPromptRef.current
      ? systemPromptRef.current || DEFAULT_SYSTEM_PROMPT
      : contextContentRef.current || DEFAULT_SYSTEM_PROMPT;
  }, []);

  const resetUseSystemPrompt = useCallback(() => {
    setUseSystemPrompt(true);
  }, []);

  return {
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    getEffectiveSystemPrompt,
    resetUseSystemPrompt,
  };
}
```

- [ ] **Step 2: Edit `useSystemAudio.ts` — remove moved code and rewire prompt call sites**

Delete from `useSystemAudio.ts`:
- State declarations `useSystemPrompt`/`contextContent` (`104-105`).
- The context half of the load effect (`243-256` — the whole first `useEffect` now that Task 1 already removed its VAD half; delete the entire effect).
- Refs `useSystemPromptRef`, `systemPromptRef`, `contextContentRef` and their `.current =` assignments (`143-145`, `150-152`).
- `saveContextSettings` (`483-499`), `updateUseSystemPrompt` (`501-507`), `updateContextContent` (`509-515`).

Add near the other hook calls (must come after `systemPrompt` is destructured from `useApp()`):

```ts
const {
  useSystemPrompt,
  setUseSystemPrompt,
  contextContent,
  setContextContent,
  getEffectiveSystemPrompt,
  resetUseSystemPrompt,
} = useContextSettings(systemPrompt);
```

Add the import:

```ts
import { useContextSettings } from "./system-audio/useContextSettings";
```

Replace the three duplicated effective-prompt expressions with `getEffectiveSystemPrompt()`:
1. In `openStreamingSocket`'s final-message handler (`200-202`):
   ```ts
   const effectiveSystemPrompt = getEffectiveSystemPrompt();
   ```
2. In the `speech-detected` listener (`431-433`):
   ```ts
   const effectiveSystemPrompt = getEffectiveSystemPrompt();
   ```
3. In `handleQuickActionClick` (`551-553`):
   ```ts
   const effectiveSystemPrompt = getEffectiveSystemPrompt();
   ```

In `startNewConversation`, replace the raw `setUseSystemPrompt(true);` (`963`) with:

```ts
resetUseSystemPrompt();
```

Update the `return { ... }` block: the keys `setUseSystemPrompt: updateUseSystemPrompt` (`1077`) and `setContextContent: updateContextContent` (`1079`) become plain `setUseSystemPrompt` and `setContextContent` (they now come from the hook already mapped to the persisting updaters). Keys `useSystemPrompt` and `contextContent` stay. **Net public shape is unchanged.**

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If `DEFAULT_SYSTEM_PROMPT` is still used elsewhere in `useSystemAudio.ts` keep its import; tsc flags it if now unused. Any leftover `useSystemPromptRef`/`systemPromptRef`/`contextContentRef` reference will error here.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/system-audio/useContextSettings.ts src/hooks/useSystemAudio.ts
git commit -m "refactor(system-audio): extract useContextSettings; centralize effective-prompt"
```

---

## Task 4: Extract `useCaptureKeyboardShortcuts`

**Files:**
- Create: `src/hooks/system-audio/useCaptureKeyboardShortcuts.ts`
- Modify: `src/hooks/useSystemAudio.ts`

**Interfaces:**
- Consumes: engine-owned values, passed as a params object (all still defined inline in `useSystemAudio` at this point):
  ```ts
  useCaptureKeyboardShortcuts(params: {
    isPopoverOpen: boolean;
    isContinuousMode: boolean;
    isRecordingInContinuousMode: boolean;
    isProcessing: boolean;
    isAIProcessing: boolean;
    startContinuousRecording: () => Promise<void> | void;
    manualStopAndSend: () => Promise<void> | void;
    ignoreContinuousRecording: () => Promise<void> | void;
  }): { scrollAreaRef: React.RefObject<HTMLDivElement> }
  ```
- Produces: `scrollAreaRef` for the `return`.

- [ ] **Step 1: Create `src/hooks/system-audio/useCaptureKeyboardShortcuts.ts`**

```ts
import { useEffect, useRef } from "react";

interface Params {
  isPopoverOpen: boolean;
  isContinuousMode: boolean;
  isRecordingInContinuousMode: boolean;
  isProcessing: boolean;
  isAIProcessing: boolean;
  startContinuousRecording: () => Promise<void> | void;
  manualStopAndSend: () => Promise<void> | void;
  ignoreContinuousRecording: () => Promise<void> | void;
}

export function useCaptureKeyboardShortcuts({
  isPopoverOpen,
  isContinuousMode,
  isRecordingInContinuousMode,
  isProcessing,
  isAIProcessing,
  startContinuousRecording,
  manualStopAndSend,
  ignoreContinuousRecording,
}: Params) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  useEffect(() => {
    const handleRecordingShortcuts = (e: KeyboardEvent) => {
      if (!isPopoverOpen || !isContinuousMode) return;
      if (isProcessing || isAIProcessing) return;

      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!isRecordingInContinuousMode) {
          startContinuousRecording();
        } else {
          manualStopAndSend();
        }
      }

      if (e.key === "Escape" && isRecordingInContinuousMode) {
        e.preventDefault();
        ignoreContinuousRecording();
      }

      if (
        e.key === " " &&
        !isRecordingInContinuousMode &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        startContinuousRecording();
      }
    };

    window.addEventListener("keydown", handleRecordingShortcuts);
    return () =>
      window.removeEventListener("keydown", handleRecordingShortcuts);
  }, [
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    isProcessing,
    isAIProcessing,
    startContinuousRecording,
    manualStopAndSend,
    ignoreContinuousRecording,
  ]);

  return { scrollAreaRef };
}
```

- [ ] **Step 2: Edit `useSystemAudio.ts` — remove the moved code**

Delete from `useSystemAudio.ts`:
- The `scrollAreaRef` declaration (`121`).
- The arrow-key scroll effect (`986-1009`).
- The recording-shortcuts effect (`1011-1055`).

Add (after the engine functions it references are defined — i.e. near the bottom, before `return`):

```ts
const { scrollAreaRef } = useCaptureKeyboardShortcuts({
  isPopoverOpen,
  isContinuousMode,
  isRecordingInContinuousMode,
  isProcessing,
  isAIProcessing,
  startContinuousRecording,
  manualStopAndSend,
  ignoreContinuousRecording,
});
```

Add the import:

```ts
import { useCaptureKeyboardShortcuts } from "./system-audio/useCaptureKeyboardShortcuts";
```

Leave `scrollAreaRef` in the `return { ... }` unchanged.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/system-audio/useCaptureKeyboardShortcuts.ts src/hooks/useSystemAudio.ts
git commit -m "refactor(system-audio): extract useCaptureKeyboardShortcuts"
```

---

## Task 5: Move the ref-coupled core into `useCaptureEngine`; reduce `useSystemAudio` to a composition root

**Files:**
- Create: `src/hooks/system-audio/useCaptureEngine.ts`
- Modify: `src/hooks/useSystemAudio.ts`

**Interfaces:**
- Consumes:
  ```ts
  useCaptureEngine(deps: {
    vadConfig: VadConfig;
    getEffectiveSystemPrompt: () => string;
    resetUseSystemPrompt: () => void;
  })
  ```
- Produces: an object with every remaining engine key used by the composition root's `return` (see list in Step 3). `handleQuickActionClick: (action: string) => Promise<void>` is part of this.

This task is a **wholesale move**, not a rewrite. Everything not already extracted in Tasks 1–4 moves into `useCaptureEngine` with its internals byte-identical. Do not restructure the streaming socket, the `listen()` effects, `processWithAI`, the conversation store, or the capture-lifecycle callbacks.

- [ ] **Step 1: Create `src/hooks/system-audio/useCaptureEngine.ts` with the moved core**

Create the file with this skeleton, then move the remaining bodies from `useSystemAudio.ts` into it verbatim:

```ts
import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from "..";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import { fetchSTT, fetchAIResponse } from "@/lib/functions";
import { useSttStatus } from "../useSttStatus";
import { DEFAULT_SYSTEM_PROMPT, STORAGE_KEYS } from "@/config";
import {
  safeLocalStorage,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
  isMacOS,
  isWindows,
} from "@/lib";
import { deepVariableReplacer } from "@/lib/functions/common.function";
import curl2Json from "@bany/curl-to-json";
import { TYPE_PROVIDER } from "@/types";
import { Message } from "@/types/completion";
import type { VadConfig } from "./useVadConfig";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface CaptureEngineDeps {
  vadConfig: VadConfig;
  getEffectiveSystemPrompt: () => string;
  resetUseSystemPrompt: () => void;
}

export function useCaptureEngine({
  vadConfig,
  getEffectiveSystemPrompt,
  resetUseSystemPrompt,
}: CaptureEngineDeps) {
  // ... moved bodies (see Step 2) ...
}
```

Move into the body, unchanged from `useSystemAudio.ts`:
- All remaining `useState` (`capturing`, `isProcessing`, `isAIProcessing`, `lastTranscription`, `lastAIResponse`, `partialTranscription`, `isStreaming`, `error`, `setupRequired`, `recordingProgress`, `isContinuousMode`, `isRecordingInContinuousMode`, `conversation`) — `useSystemAudio.ts:77-102` minus the ones already moved.
- The `useApp()` and `useSttStatus()` destructures (`107-117`), `useWindowResize()` and `useGlobalShortcuts()` (`74-75`).
- All remaining refs (`118-153`) except the three prompt refs removed in Task 3.
- `buildStreamingUrl` (`127-138`), `openStreamingSocket` (`155-232`), `closeStreamingSocket` (`234-241`).
- Both `listen()` effects (`285-341`, `343-481`).
- `handleQuickActionClick` (`548-583`), `startContinuousRecording` (`585-613`), `ignoreContinuousRecording` (`615-628`), `processWithAI` (`630-708`), `startCapture` (`710-794`), `stopCapture` (`796-827`), `manualStopAndSend` (`829-845`), `handleSetup` (`847-867`), `startNewConversation` (`948-964`).
- The popover auto-open + resize effect (`869-887`), the global-shortcut registration effect (`889-897`), the unmount cleanup effect (`899-906`), the conversation save-debounce effect (`908-946`), and the `vadConfig.enabled ↔ isContinuousMode` sync effect (`976-984`).

Wiring changes inside the moved code (only these):
- Replace the three `effectiveSystemPrompt = ...` expressions with `getEffectiveSystemPrompt()` — **already done in Task 3**, they move as-is.
- `startNewConversation` calls `resetUseSystemPrompt()` — **already done in Task 3**, moves as-is.
- `startContinuousRecording`, `startCapture`, and the sync effect read `vadConfig` — now the destructured `vadConfig` **param**, not local state. No code change needed; the identifier resolves to the param.

Return from `useCaptureEngine` every value the composition root needs (Step 3 lists them): `capturing, isProcessing, isAIProcessing, lastTranscription, lastAIResponse, partialTranscription, isStreaming, error, setupRequired, startCapture, stopCapture, handleSetup, isPopoverOpen, setIsPopoverOpen, conversation, setConversation, processWithAI, startNewConversation, resizeWindow, handleQuickActionClick, isContinuousMode, isRecordingInContinuousMode, recordingProgress, manualStopAndSend, startContinuousRecording, ignoreContinuousRecording`.

(`isPopoverOpen`/`setIsPopoverOpen` state at `76`, `resizeWindow` from `useWindowResize()`.)

- [ ] **Step 2: Rewrite `useSystemAudio.ts` as the composition root**

Replace the entire file with:

```ts
import { useCaptureEngine } from "./system-audio/useCaptureEngine";
import { useVadConfig, type VadConfig } from "./system-audio/useVadConfig";
import { useQuickActions } from "./system-audio/useQuickActions";
import { useContextSettings } from "./system-audio/useContextSettings";
import { useCaptureKeyboardShortcuts } from "./system-audio/useCaptureKeyboardShortcuts";
import { useApp } from "@/contexts";

export type { VadConfig };

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const { systemPrompt } = useApp();

  const { vadConfig, updateVadConfiguration } = useVadConfig();
  const {
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
  } = useQuickActions();
  const {
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    getEffectiveSystemPrompt,
    resetUseSystemPrompt,
  } = useContextSettings(systemPrompt);

  const engine = useCaptureEngine({
    vadConfig,
    getEffectiveSystemPrompt,
    resetUseSystemPrompt,
  });

  const { scrollAreaRef } = useCaptureKeyboardShortcuts({
    isPopoverOpen: engine.isPopoverOpen,
    isContinuousMode: engine.isContinuousMode,
    isRecordingInContinuousMode: engine.isRecordingInContinuousMode,
    isProcessing: engine.isProcessing,
    isAIProcessing: engine.isAIProcessing,
    startContinuousRecording: engine.startContinuousRecording,
    manualStopAndSend: engine.manualStopAndSend,
    ignoreContinuousRecording: engine.ignoreContinuousRecording,
  });

  return {
    capturing: engine.capturing,
    isProcessing: engine.isProcessing,
    isAIProcessing: engine.isAIProcessing,
    lastTranscription: engine.lastTranscription,
    lastAIResponse: engine.lastAIResponse,
    partialTranscription: engine.partialTranscription,
    isStreaming: engine.isStreaming,
    error: engine.error,
    setupRequired: engine.setupRequired,
    isSttInitializing: engine.isSttInitializing,
    startCapture: engine.startCapture,
    stopCapture: engine.stopCapture,
    handleSetup: engine.handleSetup,
    isPopoverOpen: engine.isPopoverOpen,
    setIsPopoverOpen: engine.setIsPopoverOpen,
    conversation: engine.conversation,
    setConversation: engine.setConversation,
    processWithAI: engine.processWithAI,
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    startNewConversation: engine.startNewConversation,
    resizeWindow: engine.resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick: engine.handleQuickActionClick,
    vadConfig,
    updateVadConfiguration,
    isContinuousMode: engine.isContinuousMode,
    isRecordingInContinuousMode: engine.isRecordingInContinuousMode,
    recordingProgress: engine.recordingProgress,
    manualStopAndSend: engine.manualStopAndSend,
    startContinuousRecording: engine.startContinuousRecording,
    ignoreContinuousRecording: engine.ignoreContinuousRecording,
    scrollAreaRef,
  };
}
```

**`isSttInitializing`:** it was destructured from `useSttStatus()` in the original return. It's part of the STT status, consumed inside the engine (`startCapture`). Return it from `useCaptureEngine` as `isSttInitializing` (add to the engine's return; it comes from `useSttStatus()`'s `isInitializing`, aliased exactly as in the original `useSystemAudio.ts:116`). The composition root reads `engine.isSttInitializing`.

- [ ] **Step 3: Verify the return shape matches exactly**

Compare the composition root's returned keys against the original 40-key return object (`useSystemAudio.ts:1057-1099` in git history — `git show HEAD~4:src/hooks/useSystemAudio.ts`). Every key must be present with the same name. `tsc` enforces value types via the two consumers of `useSystemAudioType`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Common failures to fix here: a return key missing (breaks `speech/index.tsx`), an unused import in `useCaptureEngine.ts` (from Tasks 1–4 concerns that no longer live there), or a `noUnusedParameters` error if `resetUseSystemPrompt`/`getEffectiveSystemPrompt` ends up unreferenced (means a Task 3 rewire was missed).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/system-audio/useCaptureEngine.ts src/hooks/useSystemAudio.ts
git commit -m "refactor(system-audio): move core into useCaptureEngine; useSystemAudio is now a composition root"
```

---

## Task 6: Full build + manual smoke verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full production typecheck + build**

Run: `npm run build`
Expected: `tsc` clean, then `vite build` succeeds with no errors.

- [ ] **Step 2: Launch the app**

Run: `npm run tauri dev` (or the project's usual dev launch).
Expected: app boots, overlay appears, no console errors on startup.

- [ ] **Step 3: Manual smoke — exercise each moved concern**

Verify behavior is unchanged:
- **VAD capture path:** start capture, speak; confirm speech-detected → transcription appears → AI answer streams in.
- **Continuous/manual mode:** with VAD disabled, start capture; use Enter (start recording), Space (start), Enter again (stop & send), Escape (ignore) — confirm each behaves as before.
- **Streaming STT path:** with a streaming STT provider selected, confirm partial transcription updates live and finalizes into an AI answer (no double-processing).
- **Quick actions:** open the manage panel, add and remove an action, click a quick action; confirm it drives an AI response using the last transcription.
- **Context settings:** toggle "use system prompt" off, enter custom context, run a capture; confirm the effective prompt is the custom context. Toggle on; confirm it uses the system prompt. (This validates `getEffectiveSystemPrompt` matches the old inline expression in both states.)
- **New conversation reset:** trigger a new conversation; confirm `useSystemPrompt` resets to on **and** that this reset is NOT persisted (reopen — a prior explicit off setting saved via the toggle should still be what's persisted, not the transient reset).
- **VAD config:** change a VAD setting in the settings panel; confirm it persists across restart and is sent to the backend.
- **Overlay keyboard:** arrow-key scroll in the popover works.
- **Global shortcut:** the system-audio start/stop shortcut toggles capture.

- [ ] **Step 4: Commit (only if any fix was required)**

If smoke testing surfaced a regression, fix it, re-run `npm run build`, and commit:

```bash
git add -A
git commit -m "fix(system-audio): <specific regression fixed during smoke test>"
```

If no fixes were needed, no commit — the decomposition is complete.

---

## Self-Review

**Spec coverage:**
- File layout (spec §File layout) → Tasks 1–5 create exactly the five files.
- `useQuickActions` boundary, `handleQuickActionClick` stays in engine → Task 2 + Task 5.
- `useContextSettings` + `getEffectiveSystemPrompt` dedup → Task 3.
- `useVadConfig` + `VadConfig` re-export → Task 1.
- `useCaptureKeyboardShortcuts` sink → Task 4.
- `useCaptureEngine` wholesale move, popover/sync effects stay in engine → Task 5.
- Composition root returns identical shape → Task 5 Step 2/3.
- Verification = tsc + build + manual smoke, no new tooling → per-task tsc gate + Task 6.
- Raw-vs-persisting `setUseSystemPrompt` distinction (spec constraint) → Task 3 `resetUseSystemPrompt`.

**Placeholder scan:** No TBD/TODO. The one non-transcribed body (the engine core in Task 5) is an explicit line-referenced *move* of existing verbatim code, not new code to invent — appropriate, since rewriting 600 unchanged lines invites copy errors.

**Type consistency:** `getEffectiveSystemPrompt: () => string`, `resetUseSystemPrompt: () => void`, `useCaptureEngine({ vadConfig, getEffectiveSystemPrompt, resetUseSystemPrompt })`, and `useCaptureKeyboardShortcuts(params)` names/signatures match across Tasks 3–5 and the composition root. `VadConfig` is defined once (Task 1) and imported by type elsewhere.
