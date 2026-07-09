# FluidAudio-rs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate fluidaudio-rs as the default in-process local STT provider on macOS Apple Silicon, replacing the Python sidecar while keeping custom/HTTP providers working.

**Architecture:** Add a macOS-gated `fluidaudio-rs` dependency and a Rust `stt` module that holds a `FluidAudio` instance behind a single mutex. Expose Tauri commands for batch and streaming ASR. The frontend branches in `fetchSTT()` and `useSystemAudio.ts`: `local-fluidaudio` uses Rust commands/Tauri events; all other providers keep the existing HTTP/WebSocket paths.

**Tech Stack:** TypeScript 5.8 + React 19, Tauri 2 + Rust, fluidaudio-rs 0.14.1, Swift 5.10+.

---

## Files touched

- Create: `src-tauri/src/stt.rs`
- Create: `src/hooks/useSttStatus.ts`
- Create: `src/components/SttInitOverlay.tsx`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/speaker/commands.rs`
- Modify: `src/lib/functions/stt.function.ts`
- Modify: `src/lib/functions/common.function.ts` (add WAV decode helper)
- Modify: `src/config/stt.constants.ts`
- Modify: `src/contexts/app.context.tsx`
- Modify: `src/hooks/useSystemAudio.ts`
- Modify: `src/pages/app/components/speech/index.tsx`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `AGENTS.md`
- Modify: `docs/path-a-stt-sidecar-blueprint.md`

---

## Task 1: Add dependency and verify Rust build

**Files:**
- Modify: `src-tauri/Cargo.toml:52-55`
- Test: `cargo check --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 1: Add macOS-gated dependency**

In `[target.'cfg(target_os = "macos")'.dependencies]` add:

```toml
fluidaudio-rs = "0.14.1"
```

- [ ] **Step 2: Verify Swift is installed**

```bash
swift --version
```

Expected: Swift 5.10+ on macOS.

- [ ] **Step 3: Run Rust check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: passes (will build Swift bridge on first run).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps(stt): add fluidaudio-rs macOS dependency"
```

---

## Task 2: Create Rust STT module

**Files:**
- Create: `src-tauri/src/stt.rs`

- [ ] **Step 1: Write module with state and commands**

Content:

```rust
#[cfg(target_os = "macos")]
use fluidaudio_rs::FluidAudio;
use serde_json;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct SttInner {
    #[cfg(target_os = "macos")]
    audio: Option<FluidAudio>,
    asr_ready: bool,
    streaming_ready: bool,
    is_streaming_active: bool,
}

impl Default for SttInner {
    fn default() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            audio: None,
            asr_ready: false,
            streaming_ready: false,
            is_streaming_active: false,
        }
    }
}

#[derive(Default)]
pub struct SttState {
    inner: Arc<Mutex<SttInner>>,
}

fn not_supported() -> String {
    "Local STT requires macOS Apple Silicon".to_string()
}

#[tauri::command]
pub async fn stt_init(state: State<'_, SttState>, app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    return Err(not_supported());

    #[cfg(target_os = "macos")]
    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        if guard.asr_ready {
            return Ok(());
        }

        let audio = FluidAudio::new().map_err(|e| e.to_string())?;
        if audio.is_intel_mac() {
            return Err(not_supported());
        }

        audio.init_asr().map_err(|e| e.to_string())?;
        guard.asr_ready = true;
        guard.audio = Some(audio);

        let _ = app.emit("stt-ready", ());
        Ok(())
    }
}

#[tauri::command]
pub async fn stt_init_streaming(state: State<'_, SttState>, app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    return Err(not_supported());

    #[cfg(target_os = "macos")]
    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        if guard.streaming_ready {
            return Ok(());
        }
        if guard.audio.is_none() {
            let audio = FluidAudio::new().map_err(|e| e.to_string())?;
            if audio.is_intel_mac() {
                return Err(not_supported());
            }
            guard.audio = Some(audio);
        }
        let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
        audio.init_streaming_asr().map_err(|e| e.to_string())?;
        guard.streaming_ready = true;
        let _ = app.emit("stt-streaming-ready", ());
        Ok(())
    }
}

#[tauri::command]
pub async fn stt_transcribe_speech(
    samples: Vec<f32>,
    state: State<'_, SttState>,
) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    return Err(not_supported());

    #[cfg(target_os = "macos")]
    {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
        if !guard.asr_ready {
            return Err("ASR not ready".to_string());
        }
        let result = audio.transcribe_samples(&samples).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({
            "text": result.text,
            "confidence": result.confidence,
            "duration": result.duration,
            "processing_time": result.processing_time,
        }))
    }
}

#[tauri::command]
pub async fn stt_streaming_start(state: State<'_, SttState>) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    return Err(not_supported());

    #[cfg(target_os = "macos")]
    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        if !guard.streaming_ready {
            return Err("Streaming ASR not ready".to_string());
        }
        let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
        audio.streaming_asr_start().map_err(|e| e.to_string())?;
        guard.is_streaming_active = true;
        Ok(())
    }
}

#[tauri::command]
pub async fn stt_streaming_feed(
    samples: Vec<f32>,
    state: State<'_, SttState>,
    app: AppHandle,
) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "macos"))]
    return Err(not_supported());

    #[cfg(target_os = "macos")]
    {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        if !guard.is_streaming_active {
            return Err("No active streaming session".to_string());
        }
        let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
        let partial = audio.streaming_asr_feed(&samples).map_err(|e| e.to_string())?;
        Ok(partial)
    }
}

#[tauri::command]
pub async fn stt_streaming_finish(
    state: State<'_, SttState>,
) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    return Err(not_supported());

    #[cfg(target_os = "macos")]
    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        if !guard.is_streaming_active {
            return Err("No active streaming session".to_string());
        }
        let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
        let text = audio.streaming_asr_finish().map_err(|e| e.to_string())?;
        guard.is_streaming_active = false;
        Ok(text)
    }
}

#[tauri::command]
pub async fn stt_get_status(state: State<'_, SttState>) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Ok(serde_json::json!({
            "asr_ready": false,
            "streaming_ready": false,
            "is_apple_silicon": false,
            "is_intel": false,
            "is_supported": false,
        }));
    }

    #[cfg(target_os = "macos")]
    {
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        let (is_intel, is_apple_silicon) = match guard.audio.as_ref() {
            Some(audio) => (audio.is_intel_mac(), audio.is_apple_silicon()),
            None => {
                // Construct a temporary instance only to check platform; cheap and stateless.
                match FluidAudio::new() {
                    Ok(audio) => (audio.is_intel_mac(), audio.is_apple_silicon()),
                    Err(_) => (false, false),
                }
            }
        };
        Ok(serde_json::json!({
            "asr_ready": guard.asr_ready,
            "streaming_ready": guard.streaming_ready,
            "is_apple_silicon": is_apple_silicon,
            "is_intel": is_intel,
            "is_supported": is_apple_silicon && !is_intel,
        }))
    }
}
```

- [ ] **Step 2: Run Rust check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/stt.rs
git commit -m "feat(stt): add fluidaudio-rs Rust module with batch and streaming commands"
```

---

## Task 3: Wire STT module into lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs:9`, `src-tauri/src/lib.rs:37-44`, `src-tauri/src/lib.rs:73-84`

- [ ] **Step 1: Add module import and state**

Add `mod stt;` near other mods. Add `.manage(stt::SttState::default())` after `AudioState`. Register commands in `invoke_handler![]`.

- [ ] **Step 2: Run Rust check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(stt): register SttState and commands in Tauri app"
```

---

## Task 4: Add frontend WAV-to-f32 helper

**Files:**
- Modify: `src/lib/functions/common.function.ts`

- [ ] **Step 1: Add helper function**

```typescript
export async function wavBase64ToF32Samples(base64: string): Promise<Float32Array> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "audio/wav" });
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: 16000,
  });
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const channel = audioBuffer.getChannelData(0);
  // Resample to 16kHz mono if needed. decodeAudioData already returns 16kHz because we requested it;
  // if it doesn't, do a simple linear resample.
  if (audioBuffer.sampleRate === 16000) {
    return channel;
  }
  const ratio = audioBuffer.sampleRate / 16000;
  const targetLength = Math.floor(channel.length / ratio);
  const resampled = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    resampled[i] = channel[Math.floor(i * ratio)];
  }
  return resampled;
}
```

Note: using `AudioContext` inside a Tauri webview is allowed and avoids writing a manual WAV parser. If this creates issues, fall back to a manual parser.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/functions/common.function.ts
git commit -m "feat(stt): add wav base64 to f32 samples helper"
```

---

## Task 5: Add local-fluidaudio provider and batch path

**Files:**
- Modify: `src/config/stt.constants.ts`
- Modify: `src/contexts/app.context.tsx`
- Modify: `src/lib/functions/stt.function.ts`

- [ ] **Step 1: Add provider entry**

In `SPEECH_TO_TEXT_PROVIDERS` add:

```typescript
{
  id: "local-fluidaudio",
  name: "Local FluidAudio (macOS Apple Silicon, CoreML)",
  curl: "", // in-process; not used for HTTP
  responseContentPath: "text",
  streaming: true,
  streamingUrl: "", // not used; streaming goes through Tauri events
  platform: "macos-apple-silicon",
},
```

Update `TYPE_PROVIDER` to allow `platform?: string`.

- [ ] **Step 2: Change default STT provider**

In `app.context.tsx`:

```typescript
const [selectedSttProvider, setSelectedSttProvider] = useState({
  provider: "local-fluidaudio",
  variables: { MODEL: "mlx-community/parakeet-tdt-0.6b-v3" },
});
```

Also update the fallback in `loadData`.

- [ ] **Step 3: Branch fetchSTT for local-fluidaudio**

In `fetchSTT`, early in the function:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { wavBase64ToF32Samples } from "./common.function";

export async function fetchSTT(params: STTParams): Promise<string> {
  const { provider, selectedProvider, audio, signal } = params;

  if (!provider) throw new Error("Provider not provided");

  if (provider.id === "local-fluidaudio") {
    if (audio.size === 0) throw new Error("Audio file is empty");
    const base64 = await blobToBase64(audio);
    const wavBase64 = base64.split(",")[1] ?? "";
    const samples = await wavBase64ToF32Samples(wavBase64);
    const result = await invoke<{ text: string }>("stt_transcribe_speech", { samples: Array.from(samples) });
    return result.text.trim();
  }

  // existing HTTP path continues unchanged
  ...
}
```

- [ ] **Step 4: Run typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/config/stt.constants.ts src/contexts/app.context.tsx src/lib/functions/stt.function.ts src/types/provider.type.ts
git commit -m "feat(stt): add local-fluidaudio provider and batch path"
```

---

## Task 6: Integrate streaming via Rust events

**Files:**
- Modify: `src-tauri/src/speaker/commands.rs`
- Modify: `src-tauri/src/stt.rs`
- Modify: `src/hooks/useSystemAudio.ts`

- [ ] **Step 1: Modify capture pipeline to support local streaming**

In `run_vad_capture`, branch when emitting speech events. For `local-fluidaudio`, call Rust streaming commands directly from the capture task and emit `stt-partial` / `stt-final`. For custom streaming providers, keep emitting `speech-start` / `speech-chunk` / `speech-detected`.

Because the capture task needs access to `SttState` and the selected provider, add `provider_id` to the VAD config or pass it into `start_system_audio_capture`. The simplest approach: pass `selected_provider_id` as a new argument to `start_system_audio_capture` and store it in `AudioState`.

Extend `AudioState`:

```rust
pub struct AudioState {
    stream_task: Arc<Mutex<Option<JoinHandle<()>>>,
    vad_config: Arc<Mutex<VadConfig>>,
    is_capturing: Arc<Mutex<bool>>,
    selected_stt_provider: Arc<Mutex<Option<String>>,
}
```

Update `start_system_audio_capture` signature to accept `selectedSttProvider: Option<String>`. Store it before spawning.

In `run_vad_capture`, when `config.emit_chunks` is true:
- If selected provider is `local-fluidaudio`: on speech-start call `stt_streaming_start`, on chunk decode base64 to f32 and call `stt_streaming_feed`, emit `stt-partial` if partial text returned, on silence/end call `stt_streaming_finish` and emit `stt-final`.
- Else: emit `speech-start` / `speech-chunk` as today.

- [ ] **Step 2: Update frontend to listen for local streaming events**

In `useSystemAudio.ts`, add listeners for `stt-partial` and `stt-final`. When selected provider is `local-fluidaudio`, these replace the WebSocket path.

The WebSocket path (`openStreamingSocket`) should only be used when `selectedSttProvider.provider` is a streaming provider that is **not** `local-fluidaudio`.

- [ ] **Step 3: Run Rust check and build**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
npm run build
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/speaker/commands.rs src-tauri/src/stt.rs src/hooks/useSystemAudio.ts
git commit -m "feat(stt): integrate local-fluidaudio streaming via Tauri events"
```

---

## Task 7: Lazy init overlay and platform fallback

**Files:**
- Create: `src/hooks/useSttStatus.ts`
- Create: `src/components/SttInitOverlay.tsx`
- Modify: `src/hooks/useSystemAudio.ts`
- Modify: `src/contexts/app.context.tsx`
- Modify: `src/pages/app/components/speech/index.tsx`

- [ ] **Step 1: Create useSttStatus hook**

```typescript
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface SttStatus {
  asrReady: boolean;
  streamingReady: boolean;
  isSupported: boolean;
  isInitializing: boolean;
  error: string | null;
}

export function useSttStatus() {
  const [status, setStatus] = useState<SttStatus>({
    asrReady: false,
    streamingReady: false,
    isSupported: false,
    isInitializing: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<{
        asr_ready: boolean;
        streaming_ready: boolean;
        is_supported: boolean;
      }>("stt_get_status");
      setStatus((prev) => ({
        ...prev,
        asrReady: result.asr_ready,
        streamingReady: result.streaming_ready,
        isSupported: result.is_supported,
      }));
      return result.is_supported;
    } catch (e) {
      setStatus((prev) => ({ ...prev, isSupported: false, error: String(e) }));
      return false;
    }
  }, []);

  const init = useCallback(async () => {
    setStatus((prev) => ({ ...prev, isInitializing: true, error: null }));
    try {
      await invoke("stt_init");
      await refresh();
      setStatus((prev) => ({ ...prev, isInitializing: false }));
      return true;
    } catch (e) {
      setStatus((prev) => ({
        ...prev,
        isInitializing: false,
        error: String(e),
        asrReady: false,
      }));
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    let unlistenReady: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const setup = async () => {
      unlistenReady = await listen("stt-ready", () => {
        setStatus((prev) => ({ ...prev, asrReady: true, isInitializing: false }));
      });
      unlistenError = await listen("stt-error", (event) => {
        setStatus((prev) => ({
          ...prev,
          error: String(event.payload),
          isInitializing: false,
        }));
      });
    };

    setup();

    return () => {
      if (unlistenReady) unlistenReady();
      if (unlistenError) unlistenError();
    };
  }, [refresh]);

  return { ...status, refresh, init };
}
```

- [ ] **Step 2: Create SttInitOverlay component**

Simple overlay showing spinner + "Preparing local speech model..." when `isInitializing` is true.

- [ ] **Step 3: Wire lazy init into useSystemAudio startCapture**

In `startCapture`, before invoking `start_system_audio_capture`, if selected provider is `local-fluidaudio`:

```typescript
const { isSupported, asrReady, isInitializing, init } = useSttStatus();

if (selectedSttProvider.provider === "local-fluidaudio") {
  if (!isSupported) {
    // Auto-switch to groq
    onSetSelectedSttProvider({ provider: "groq", variables: {} });
    setError("Local STT requires macOS Apple Silicon — switched to cloud STT");
    // continue with cloud provider
  } else if (!asrReady && !isInitializing) {
    await init();
  }
}
```

This requires `useSttStatus` to be called inside `useSystemAudio` and `onSetSelectedSttProvider` to be available from `useApp`.

- [ ] **Step 4: Platform gating in app.context**

On mount, check platform. If macOS Apple Silicon and default is `local-fluidaudio`, keep it. Otherwise switch default to `groq` and show toast. Use `invoke("stt_get_status")` to determine support.

- [ ] **Step 5: Show overlay in speech panel**

Pass `isInitializing` from `useSttStatus` into `SystemAudio` component and render `SttInitOverlay` when initializing.

- [ ] **Step 6: Run checks**

```bash
npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSttStatus.ts src/components/SttInitOverlay.tsx src/hooks/useSystemAudio.ts src/contexts/app.context.tsx src/pages/app/components/speech/index.tsx
git commit -m "feat(stt): add lazy init overlay and platform fallback for fluidaudio"
```

---

## Task 8: Bundle metadata and docs

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `AGENTS.md`
- Modify: `docs/path-a-stt-sidecar-blueprint.md`

- [ ] **Step 1: Set macOS minimum version**

In `tauri.conf.json` set `tauri.windows.minimumSystemVersion` or `bundle.macOS.minimumSystemVersion` to `"14.0"` depending on Tauri v2 config schema.

- [ ] **Step 2: Update AGENTS.md**

Replace references to Python sidecar / MLX local STT with fluidaudio-rs. Keep mention of custom local servers as advanced options.

- [ ] **Step 3: Mark sidecar blueprint abandoned**

Add a header to `docs/path-a-stt-sidecar-blueprint.md` saying it is superseded by `docs/fluidaudio-rs-blueprint.md`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json AGENTS.md docs/path-a-stt-sidecar-blueprint.md
git commit -m "docs(stt): update bundle metadata and AGENTS.md for fluidaudio-rs"
```

---

## Task 9: Final verification and push

- [ ] **Step 1: Run all checks**

```bash
npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

Expected: all pass.

- [ ] **Step 2: Push to origin**

```bash
git push origin feat/fluidaudio-rs
```

---

## Notes and blockers

- The `fluidaudio-rs` crate is available at version 0.14.1 and Swift 6.3.2 is installed, so Phase 1 should build.
- If `decodeAudioData` is unavailable in the Tauri webview context, replace `wavBase64ToF32Samples` with a manual WAV parser.
- If `fluidaudio-rs` API differs from the blueprint (e.g., method names, result fields), adjust the Rust module and frontend accordingly and commit the corrections.
