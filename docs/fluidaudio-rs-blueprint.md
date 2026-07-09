# FluidAudio-rs Integration Blueprint — In-Process Local STT

**Status:** Designed, not yet implemented. No deadline — execute when ready.
**Branch:** `feat/fluidaudio-rs` (isolated from `main`/`dev`)
**Date:** 2026-07-09 (revised — incorporates review feedback from GLM 5.2 + Kimi K2.7)
**Replaces:** `docs/path-a-stt-sidecar-blueprint.md` (Python sidecar approach — abandoned in favor of this)

## Goal

Zero-setup local STT on macOS. User installs the app, model downloads on first run, transcription works with no terminal, no Python, no sidecar process. Same Parakeet TDT v3 model, but via CoreML on the Apple Neural Engine instead of MLX/Python.

## Why fluidaudio-rs instead of the Python sidecar

| | fluidaudio-rs (this blueprint) | Python sidecar (abandoned) |
|---|---|---|
| Architecture | In-process Rust→Swift FFI | Sidecar Python process on localhost:8001 |
| Bundle size | ~500MB (model only, first-run download) | ~2.5GB (Python + venv + model) |
| Engineering effort | Days | Weeks |
| Process management | None (runs in Tauri backend) | Sidecar lifecycle, port conflicts, health checks |
| Audio path | Rust capture → Rust transcribe → Tauri event | Rust capture → Tauri event → JS WebSocket → Python → MLX → back |
| Model freezing | CoreML compiled models (Apple-supported) | Fragile MLX kernel freezing |
| Power | ANE (lower power, background-capable) | GPU/MPS |

## Requirements & constraints

- **macOS 14.0+** (CoreML requirement; was 13.5 for MLX)
- **Apple Silicon only** (M1/M2/M3/M4). Intel Macs get no ASR — `is_intel_mac()` gate → cloud fallback
- **Swift 5.10+ toolchain required at build time** (HARD prerequisite — the crate's `build.rs` runs `swift build -c release` to compile the FFI bridge). Any machine building the app (dev or CI) must have Xcode command line tools with Swift 5.10+. GitHub Actions macOS runners have this pre-installed. Windows/Linux builds skip the macOS-gated dependency entirely.
- **Linux/Windows**: not supported by fluidaudio-rs — existing cloud STT (Groq etc.) remains the path
- **First-run download**: ~500MB model, 20-30s CoreML compilation. Cached on subsequent loads (~1s)

## Existing patterns to follow

- **Tauri commands** registered in `src-tauri/src/lib.rs:55-84` via `invoke_handler![]`
- **App state** via `tauri::Manager` — `AudioState` at `src-tauri/src/lib.rs:17-22` holds `Arc<Mutex<...>>` fields
- **Audio capture pipeline** in `src-tauri/src/speaker/commands.rs` — VAD detects speech, emits `speech-start`, `speech-chunk`, `speech-detected` Tauri events with f32 samples (base64-encoded)
- **Frontend STT flow** in `src/hooks/useSystemAudio.ts` — listens to speech events, sends audio to STT provider, gets text back, calls AI. Now stabilized with refs (`capturingRef`, `selectedSttProviderRef`, `allSttProvidersRef`, `conversationMessagesRef`)
- **STT provider system** in `src/config/stt.constants.ts` + `src/contexts/app.context.tsx:112-115` — curl-template providers, `selectedSttProvider` state. Providers have `streamingUrl` field (added during bug fix phase)
- **Batch STT** in `src/lib/functions/stt.function.ts` — `fetchSTT()` sends audio to provider URL, parses response
- **Streaming STT** in `src/hooks/useSystemAudio.ts:136-220` — WebSocket to provider `streamingUrl` (configurable, no longer hardcoded)

## Architecture

```
Current flow (batch):
  Rust VAD → speech-detected event (base64 WAV) → JS → fetchSTT() → HTTP to provider → text → processWithAI()

Current flow (streaming, WebSocket providers):
  Rust VAD → speech-start/speech-chunk events → JS → WebSocket to provider URL → partial text → processWithAI()

New flow (fluidaudio-rs, batch):
  Rust VAD → speech-detected event (base64 WAV, unchanged) → JS decodes to f32 → invoke("stt_transcribe_speech", { samples }) → Rust transcribe_samples() → { text, confidence } → JS processWithAI()

New flow (fluidaudio-rs, streaming):
  Rust VAD → speech-start → JS calls invoke("stt_streaming_start")
          → speech-chunk → JS calls invoke("stt_streaming_feed", { samples }) → Rust returns partial text → JS updates UI
          → silence/end → JS calls invoke("stt_streaming_finish") → Rust returns final text → JS processWithAI()
```

Key insight: **the capture pipeline stays unchanged.** `speech-detected` still emits base64 WAV. The frontend decodes to f32 and passes samples to a Tauri command. This avoids changing the event payload shape (which would break custom providers) and keeps the integration additive. The base64→f32 round-trip adds ~5-10ms — negligible vs model inference time. Future optimization (Option B: transcribe directly in the Rust capture loop) can eliminate this cost later.

## fluidaudio-rs API surface (from source)

Relevant methods for this app:

```rust
// Init (downloads + compiles CoreML models on first call, ~20-30s)
audio.init_asr()                              // Parakeet TDT v3, batch mode
audio.init_streaming_asr()                    // Parakeet streaming, 99.5% less memory

// Batch transcription
audio.transcribe_samples(&[f32]) -> AsrResult // 16kHz mono, -1.0 to 1.0
audio.transcribe_file("path") -> AsrResult

// Streaming transcription (session-based)
audio.streaming_asr_start()
audio.streaming_asr_feed(&[f32])             // feed chunks as they arrive
audio.streaming_asr_finish() -> String        // get final text

// VAD (Silero model — could replace hand-rolled Rust VAD)
audio.init_vad(0.85)
audio.vad_process_samples(&[f32]) -> Vec<VadFrame>  // 4096-sample (256ms) chunks

// System checks
audio.is_apple_silicon() -> bool
audio.is_intel_mac() -> bool
audio.is_asr_available() -> bool
audio.is_streaming_asr_available() -> bool

// Result type
pub struct AsrResult { text: String, confidence: f32, duration: f64, processing_time: f64, rtfx: f32 }
pub struct VadFrame { probability: f32, is_voice_active: bool, processing_time: f64 }
```

## Implementation map

### Phase 1: Add dependency & verify build

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/Cargo.toml` | **Modify** | Add `fluidaudio-rs = "0.1"` under `[target.'cfg(target_os = "macos")'.dependencies]`. Gate to macOS only. |

**Build prerequisite:** Verify `swift --version` is 5.10+ on the dev machine before starting. The crate's `build.rs` runs `swift build -c release` — this will fail without the toolchain.

Build verification: `cargo check --manifest-path src-tauri/Cargo.toml` must pass.

### Phase 2: Rust STT module

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/stt.rs` | **Create** | New module wrapping fluidaudio-rs for Tauri integration |

Module responsibilities:
- Hold all mutable STT state in a **single `Mutex<SttInner>`** to avoid deadlock footguns from multiple separate locks:
```rust
struct SttInner {
    audio: Option<FluidAudio>,
    asr_ready: bool,
    streaming_ready: bool,
    is_streaming_active: bool,
}

pub struct SttState {
    inner: Arc<Mutex<SttInner>>,
}
```
- Expose Tauri commands:
  - `stt_init()` — initializes ASR (downloads model on first run), emits `stt-ready` or `stt-error` event
  - `stt_init_streaming()` — initializes streaming ASR
  - `stt_transcribe_samples(samples: Vec<f32>)` → `{ text, confidence }` — batch transcription
  - `stt_streaming_start()`, `stt_streaming_feed(samples: Vec<f32>)` → `Option<String>`, `stt_streaming_finish()` → `String`
  - `stt_get_status()` → `{ asr_ready: bool, streaming_ready: bool, is_streaming_active: bool, is_apple_silicon: bool, is_intel: bool }`
- All commands return `Result<T, String>` for easy frontend error handling
- All commands acquire **one lock** (`inner`), read/write, release — no multi-lock ordering concerns
- On non-macOS or Intel Mac: commands return error → frontend falls back to cloud STT
- `is_streaming_active` guards against double-start and feed-without-start. If the API ever supports session IDs, upgrade to a struct later.

```rust
// src-tauri/src/stt.rs (sketch)
use fluidaudio_rs::FluidAudio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

struct SttInner {
    audio: Option<FluidAudio>,
    asr_ready: bool,
    streaming_ready: bool,
    is_streaming_active: bool,
}

pub struct SttState {
    inner: Arc<Mutex<SttInner>>,
}

impl Default for SttState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SttInner {
                audio: None,
                asr_ready: false,
                streaming_ready: false,
                is_streaming_active: false,
            })),
        }
    }
}

#[tauri::command]
pub async fn stt_init(state: tauri::State<'_, SttState>, app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    return Err("Local STT requires macOS".into());

    #[cfg(target_os = "macos")]
    {
        let audio = FluidAudio::new().map_err(|e| e.to_string())?;
        if audio.is_intel_mac() {
            return Err("Local STT requires Apple Silicon".into());
        }
        audio.init_asr().map_err(|e| e.to_string())?;
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.asr_ready = true;
        inner.audio = Some(audio);
        let _ = app.emit("stt-ready", ());
        Ok(())
    }
}

#[tauri::command]
pub async fn stt_transcribe_samples(
    samples: Vec<f32>,
    state: tauri::State<'_, SttState>,
) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    return Err("Local STT requires macOS".into());

    #[cfg(target_os = "macos")]
    {
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        let audio = inner.audio.as_ref().ok_or("STT not initialized")?;
        let result = audio.transcribe_samples(&samples).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "text": result.text, "confidence": result.confidence }))
    }
}

#[tauri::command]
pub async fn stt_get_status(state: tauri::State<'_, SttState>) -> Result<serde_json::Value, String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "asr_ready": inner.asr_ready,
        "streaming_ready": inner.streaming_ready,
        "is_streaming_active": inner.is_streaming_active,
    }))
}
```

### Phase 3: Wire into app state & commands

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/lib.rs` | **Modify** | Add `mod stt;`, register `SttState` in `.manage()`, add STT commands to `invoke_handler![]` |

Changes to `lib.rs`:
- Line ~9: add `mod stt;`
- Line ~37: add `.manage(stt::SttState::default())`
- Lines 55-84: add to `invoke_handler![]`:
  - `stt::stt_init`
  - `stt::stt_init_streaming`
  - `stt::stt_transcribe_samples`
  - `stt::stt_streaming_start`
  - `stt::stt_streaming_feed`
  - `stt::stt_streaming_finish`
  - `stt::stt_get_status`

### Phase 4: Integrate batch STT

**Approach: Keep `speech-detected` payload unchanged (base64 WAV). Frontend decodes to f32 and invokes a Tauri command.**

This avoids changing the event shape (which would break custom/cloud providers) and keeps the capture pipeline untouched. The base64→f32 round-trip adds ~5-10ms — acceptable for first pass. Future optimization (Option B: transcribe directly in the Rust capture loop) can eliminate this.

| File | Action | Description |
|------|--------|-------------|
| `src/lib/functions/stt.function.ts` | **Modify** | Add branch: if provider is `local-fluidaudio`, decode base64 WAV → f32 and `invoke("stt_transcribe_speech", { samples })` instead of HTTP fetch. |
| `src/lib/functions/audio-utils.ts` | **Create** | Shared helper: `base64WavToF32(base64: string): Float32Array`. Used by both batch local STT and streaming chunk feed. Avoids duplicate decode logic. |
| `src/config/stt.constants.ts` | **Modify** | Add new provider entry `local-fluidaudio` (id, name, `localProvider: true` flag, no curl URL needed). |
| `src/types/provider.type.ts` | **Modify** | Add `localProvider?: boolean` to `TYPE_PROVIDER`. |
| `src/contexts/app.context.tsx` | **Modify** | Change default STT from `local-parakeet` to `local-fluidaudio`. |

**Frontend batch flow for `local-fluidaudio`:**
```typescript
// In speech-detected handler, when provider is local-fluidaudio:
const samples = base64WavToF32(base64Audio);
const result = await invoke<{ text: string; confidence: number }>(
  "stt_transcribe_samples", { samples: Array.from(samples) }
);
const transcription = result.text;
// ... proceed to processWithAI(transcription, ...)
```

**Cloud/custom providers:** unchanged — still use `fetchSTT()` with HTTP.

### Phase 5: Integrate streaming STT

**Approach: Provider-type branching. Two separate functions, top-level dispatcher.**

When `local-fluidaudio` is selected: use Rust streaming commands + Tauri events.
When any other streaming provider is selected: keep the existing WebSocket path (`openStreamingSocket`).

This keeps the WebSocket code alive for `local-parakeet` (advanced users running their own Python server) but unreachable when `local-fluidaudio` is selected. No half-wiring.

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useSystemAudio.ts` | **Modify** | Add `startLocalStreaming()` function that calls `invoke("stt_streaming_start")`, `invoke("stt_streaming_feed", { samples })`, `invoke("stt_streaming_finish")`. Add top-level dispatcher in `speech-start` listener: if provider is `local-fluidaudio` → `startLocalStreaming()`; else → `openStreamingSocket()`. Replace `speech-chunk` handler similarly. |
| `src-tauri/src/stt.rs` | **Modify** | Streaming commands call into `FluidAudio` streaming API. `stt_streaming_start` sets `is_streaming_active = true`. `stt_streaming_feed` returns `Option<String>` (partial text). `stt_streaming_finish` sets `is_streaming_active = false` and returns final text. Guard against feed-without-start and double-start. |
| `src-tauri/src/speaker/commands.rs` | **No change** | Capture pipeline stays the same. `speech-start`, `speech-chunk`, `speech-detected` events keep their current payload shapes. |

**Frontend streaming flow for `local-fluidaudio`:**
```typescript
// speech-start listener:
if (providerConfig.localProvider) {
  // Local: Rust streaming
  await invoke("stt_streaming_start");
} else if (providerConfig.streaming) {
  // WebSocket: existing path
  openStreamingSocket();
}

// speech-chunk listener:
if (providerConfig.localProvider) {
  const samples = base64WavToF32(base64Audio);
  const partial = await invoke<string | null>("stt_streaming_feed", { samples: Array.from(samples) });
  if (partial) setPartialTranscription(partial);
} else if (providerConfig.streaming) {
  // WebSocket: existing path (send binary to wsRef)
}

// speech-detected listener (or silence detected):
if (providerConfig.localProvider && streamingActive) {
  const finalText = await invoke<string>("stt_streaming_finish");
  setLastTranscription(finalText);
  // ... processWithAI(finalText, ...)
} else {
  // Batch fallback: existing speech-detected path
}
```

### Phase 6: First-run UX (lazy init)

**Approach: Initialize on first capture attempt, not on app startup.** Avoids cold-start penalty for users who never use STT.

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useSttStatus.ts` | **Create** | Hook that calls `stt_get_status()` on demand, listens to `stt-ready`/`stt-error` events. Exposes `{ asrReady, streamingReady, isIntel, isSupported, initStt }`. |
| `src/components/SttInitOverlay.tsx` | **Create** | Overlay: "Initializing local STT..." with spinner during `stt_init()`. On error: "Local STT unavailable — switched to cloud STT" with dismiss button. |
| `src/pages/app/components/speech/index.tsx` | **Modify** | Show `SttInitOverlay` when local STT selected but not yet ready. |
| `src/hooks/useSystemAudio.ts` | **Modify** | In `startCapture()`: check `stt_get_status()` before starting. If `!asr_ready` and provider is `local-fluidaudio`: show overlay, call `stt_init()`. |

**Lazy init error state machine (explicit sequence):**
```
startCapture() called
  → check stt_get_status()
    → if asr_ready: proceed with capture
    → if !asr_ready && provider is local-fluidaudio:
      1. Show "Initializing local STT..." overlay
      2. Call stt_init()
      3. On success: hide overlay, proceed with capture
      4. On failure (Intel/non-macOS/model download fails):
         a. Switch selected provider to cloud (Groq)
         b. Show toast: "Local STT unavailable — switched to cloud STT"
         c. Proceed with capture using cloud path
         d. Do NOT strand the user on an error screen
```

**Critical:** never block capture on init failure. Fall back to cloud and keep going. The user asked to capture audio — give them a working path.

### Phase 7: Fallback & platform gating

| File | Action | Description |
|------|--------|-------------|
| `src/contexts/app.context.tsx` | **Modify** | On non-macOS or Intel Mac: if default is `local-fluidaudio`, auto-switch to `groq` and show a one-time toast "Local STT requires macOS Apple Silicon — switched to cloud STT". |
| `src/config/stt.constants.ts` | **Modify** | Mark `local-fluidaudio` as `platform: "macos-apple-silicon"` in provider metadata. Filter provider list by platform on first run. |

## Build sequence (checklist)

### Phase 1: Dependency & build verification
- [ ] Verify `swift --version` is 5.10+ (HARD prerequisite — `cargo check` will fail without it)
- [ ] Add `fluidaudio-rs = "0.1"` to `Cargo.toml` under `[target.'cfg(target_os = "macos")'.dependencies]`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` — must pass (builds Swift bridge)
- [ ] If build fails: check Swift toolchain, Xcode command line tools

### Phase 2: Rust STT module
- [ ] Create `src-tauri/src/stt.rs` with `SttState` (single `Mutex<SttInner>`), `stt_init`, `stt_transcribe_samples`, `stt_get_status`
- [ ] Add `mod stt;` to `lib.rs`
- [ ] Register `SttState` in `.manage()`
- [ ] Register commands in `invoke_handler![]`
- [ ] `cargo check` — must pass

### Phase 3: Wire batch STT
- [ ] Add `localProvider?: boolean` to `TYPE_PROVIDER`
- [ ] Add `local-fluidaudio` provider to `stt.constants.ts` (with `localProvider: true`)
- [ ] Change default STT to `local-fluidaudio` in `app.context.tsx`
- [ ] Create `src/lib/functions/audio-utils.ts` with `base64WavToF32()` helper
- [ ] Add local STT branch to `fetchSTT()` or the `speech-detected` handler: if `localProvider`, decode to f32 and `invoke("stt_transcribe_samples")`
- [ ] Test: speak → VAD detects → transcribe_samples → text appears
- [ ] `npx tsc --noEmit` + `npm run build` + `cargo check` all green

### Phase 4: Wire streaming STT
- [ ] Add streaming commands to `stt.rs`: `stt_streaming_start/feed/finish` with `is_streaming_active` guard
- [ ] Add `startLocalStreaming()` function in `useSystemAudio.ts`
- [ ] Add provider-type dispatcher in `speech-start` and `speech-chunk` listeners
- [ ] Keep `openStreamingSocket()` for non-local streaming providers (WebSocket path)
- [ ] Test: speak continuously → partial text updates live → final text on silence
- [ ] All checks green

### Phase 5: First-run UX (lazy init)
- [ ] Create `useSttStatus` hook
- [ ] Create `SttInitOverlay` component
- [ ] Add `stt_get_status()` check + `stt_init()` call in `startCapture()` (lazy, not on startup)
- [ ] Implement error state machine: init failure → switch to cloud → toast → continue capture
- [ ] Test: fresh install → first capture → overlay → download → ready → transcription works
- [ ] Test: Intel Mac → first capture → error → auto-switch to Groq → capture works
- [ ] All checks green

### Phase 6: Fallback & polish
- [ ] Platform gating: non-macOS/Intel → auto-switch to Groq + toast
- [ ] Error handling: `stt_init` failure → cloud fallback, don't strand user
- [ ] Handle `stt_transcribe_samples` failure gracefully (don't crash capture)
- [ ] Remove or deprecate `mlx_asr_server.py` and `whisper_server.py` (or keep as advanced opt-in)
- [ ] Remove `local-parakeet`, `local-nemotron`, `local-whisper` from default providers (keep as custom provider options for users who run their own servers)
- [ ] Update `AGENTS.md` to reflect fluidaudio-rs as the local STT path
- [ ] Full verification: `tsc`, `build`, `cargo check`

### Phase 7: P1 items (can be done before or after)
- [ ] Bump version to `1.0.0-alpha.1`
- [ ] Set `minimumSystemVersion: "14.0"` (fluidaudio-rs requires macOS 14+)
- [ ] Add bundle metadata (publisher, copyright, category)
- [ ] Remove unused `TAURI_SIGNING_PRIVATE_KEY*` from `publish.yml`

## What gets removed/simplified

After fluidaudio-rs is integrated, these become unnecessary for the **default** local STT path:
- `mlx_asr_server.py` — no longer needed for default local STT (keep as advanced option for custom provider)
- `whisper_server.py` — same
- Python venv packaging — never needed
- Sidecar process lifecycle — never needed
- `build_stt_bundle.sh` from the old blueprint — never needed

**Kept alive (not removed):**
- WebSocket streaming logic in `useSystemAudio.ts` (`openStreamingSocket`, `wsRef`, `closeStreamingSocket`) — kept for `local-parakeet` and other custom streaming providers. Unreachable when `local-fluidaudio` is selected.
- `localhost:8001` capability in `capabilities/default.json` — kept for advanced users running their own servers.

## Latency notes

- **Batch base64 round-trip**: `speech-detected` emits base64 WAV → JS decodes to f32 → `invoke("stt_transcribe_samples")` → Rust transcribes. The decode + IPC adds ~5-10ms. Negligible vs model inference time (~50-200ms). Future Option B (transcribe directly in the Rust capture loop) can eliminate this.
- **Streaming chunk feed**: `speech-chunk` emits base64 f32 → JS decodes → `invoke("stt_streaming_feed")` → Rust returns partial. Same ~5-10ms overhead per chunk. Acceptable.

## Critical details

- **Build dependency (HARD prerequisite)**: Swift 5.10+ must be installed on any machine building the app (dev or CI). The crate's `build.rs` runs `swift build`. On macOS with Xcode, this is already present. CI needs `actions/setup-swift` or equivalent. This is called out prominently because `cargo check` will fail without it — not a soft recommendation.
- **macOS minimum**: fluidaudio-rs requires macOS 14.0+. Set `minimumSystemVersion: "14.0"` in `tauri.conf.json`.
- **Intel Macs**: `is_intel_mac()` returns true → no ASR. Must gate in UI and fall back to cloud. Don't let the user select local STT on Intel. Use `stt_get_status()` to check before capture starts.
- **Non-macOS**: fluidaudio-rs is macOS-only. On Windows/Linux, the `cfg(target_os = "macos")` gate makes the dependency absent. Cloud STT is the only option.
- **Model download**: first `init_asr()` call downloads ~500MB from HuggingFace and compiles CoreML models (20-30s). Must show UI during this. Subsequent loads: ~1s from cache. **Lazy init on first capture** (not app startup) avoids penalizing users who never use STT.
- **Thread safety**: `FluidAudioBridge` is `Send + Sync` (per source). Safe to hold inside `Mutex<SttInner>`.
- **Mutex design**: single `Mutex<SttInner>` holding all mutable state (`audio`, `asr_ready`, `streaming_ready`, `is_streaming_active`). Every command acquires one lock — no multi-lock ordering concerns, no deadlock risk.
- **VAD**: fluidaudio-rs includes Silero VAD (`vad_process_samples`). This could replace the hand-rolled RMS/peak VAD in `speaker/commands.rs:186-187`. **Not for first integration** — the existing VAD works fine and swapping it adds risk. Future enhancement only.
- **Code signing**: the built `.app` will contain the Swift-compiled `libFluidAudioBridge.a`. Apple Developer ID signing covers this — no special treatment needed beyond signing the app bundle.
- **Bundle size**: the Swift static library is small (~few MB). The 500MB model is downloaded at runtime, not bundled. Total app bundle stays small.
- **CI**: GitHub Actions macOS runners have Swift/Xcode pre-installed. `cargo build` will work. Windows/Linux CI builds skip the macOS-gated dependency.
- **Shared decode helper**: `base64WavToF32()` in `src/lib/functions/audio-utils.ts` is used by both batch local STT (speech-detected → transcribe) and streaming chunk feed (speech-chunk → feed). Don't duplicate decode logic.

## Prerequisites before starting implementation

- Verify `swift --version` is 5.10+ on the dev machine (HARD — build will fail without it)
- P1 #4: Bump version (`1.0.0-alpha.1` recommended)
- P1 #6: Add bundle metadata to `tauri.conf.json`
- P1 #7: Set `minimumSystemVersion: "14.0"` (fluidaudio-rs requirement)

## Revision history

- **2026-07-09 v1**: Initial blueprint
- **2026-07-09 v2**: Revised based on Kimi K2.7 review feedback:
  - Keep `speech-detected` payload as base64 WAV (don't change event shape) — additive integration, custom providers unaffected
  - Provider-type branching for streaming: keep WebSocket path alive behind a check, add separate local streaming path
  - Lazy init on first capture, not app startup — avoids cold-start penalty for non-STT users
  - Single `Mutex<SttInner>` instead of separate mutexes — eliminates deadlock risk
  - Explicit lazy-init error state machine: init failure → cloud fallback → continue capture, don't strand user
  - Shared `base64WavToF32` helper to avoid duplicate decode logic
  - `is_streaming_active` naming (clearer than `streaming_session`)
  - Swift toolchain called out as HARD prerequisite, not buried
  - Latency notes for base64 round-trip with pointer to future Option B optimization