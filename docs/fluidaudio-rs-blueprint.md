# FluidAudio-rs Integration Blueprint — In-Process Local STT

**Status:** Designed, not yet implemented. No deadline — execute when ready.
**Branch:** `feat/fluidaudio-rs` (isolated from `main`/`dev`)
**Date:** 2026-07-09
**Replaces:** `docs/path-a-stt-sidecar-blueprint.md` (Python sidecar approach — abandoned in favor of this)

## Goal

Zero-setup local STT on macOS. User installs the app, model downloads on first capture, transcription works with no terminal, no Python, no sidecar process. Same Parakeet TDT v3 model, but via CoreML on the Apple Neural Engine instead of MLX/Python.

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
- **Swift 5.10+ toolchain** required at build time (the crate's `build.rs` runs `swift build`)
- **Linux/Windows**: not supported by fluidaudio-rs — existing cloud STT (Groq etc.) remains the path
- **First-run download**: ~500MB model, 20-30s CoreML compilation. Cached on subsequent loads (~1s)
- **Hard build prerequisite**: any machine building the app (dev or CI) must have Swift/Xcode. GitHub Actions macOS runners have this; Windows/Linux CI builds skip the macOS-gated dependency.

## Existing patterns to follow

- **Tauri commands** registered in `src-tauri/src/lib.rs:55-84` via `invoke_handler![]`
- **App state** via `tauri::Manager` — `AudioState` at `src-tauri/src/lib.rs:17-22` holds `Arc<Mutex<...>>` fields
- **Audio capture pipeline** in `src-tauri/src/speaker/commands.rs` — VAD detects speech, emits `speech-start`, `speech-chunk`, `speech-detected` Tauri events
- **Frontend STT flow** in `src/hooks/useSystemAudio.ts` — listens to speech events, sends audio to STT provider, gets text back, calls AI
- **STT provider system** in `src/config/stt.constants.ts` + `src/contexts/app.context.tsx:112-115` — curl-template providers, `selectedSttProvider` state
- **Batch STT** in `src/lib/functions/stt.function.ts` — `fetchSTT()` sends audio to provider URL, parses response
- **Streaming STT** in `src/hooks/useSystemAudio.ts` — WebSocket to custom streaming providers (kept for `local-parakeet` advanced users)

## Architecture

### New flows

```
Batch (local-fluidaudio):
  Rust VAD → speech-detected (base64 WAV) → JS decode to f32
                                    → invoke("stt_transcribe_speech", { samples })
                                    → Rust transcribe_samples() → Tauri event stt-final → JS processWithAI()

Batch (cloud provider):
  Rust VAD → speech-detected (base64 WAV) → JS fetchSTT() → HTTP to provider → text → processWithAI()

Streaming (local-fluidaudio):
  Rust VAD → speech-start → Rust stt_streaming_start()
         → speech-chunk → Rust stt_streaming_feed(&f32_samples) → Tauri event stt-partial → JS
         → silence/end → Rust stt_streaming_finish() → Tauri event stt-final → JS processWithAI()

Streaming (custom provider, e.g. local-parakeet):
  Rust VAD → speech-start/speech-chunk events → JS WebSocket to provider URL → partial text → processWithAI()
```

Key insight: **transcription moves from JS/Python into Rust only for the local-fluidaudio provider**. The frontend branches by provider type. The capture pipeline's event shape (`speech-detected` carrying base64 WAV) stays unchanged, so cloud and custom providers keep working untouched.

## fluidaudio-rs API surface

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

// VAD (Silero model — future enhancement, not used on first pass)
audio.init_vad(0.85)
audio.vad_process_samples(&[f32]) -> Vec<VadFrame>

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
| `src-tauri/Cargo.toml` | **Modify** | Add `fluidaudio-rs = "0.14.1"` under `[target.'cfg(target_os = "macos")'.dependencies]`. |
| `src-tauri/Cargo.toml` | **Verify** | `thiserror` already a dep (`thiserror = "1.0"`). |

Build verification: `cargo check --manifest-path src-tauri/Cargo.toml` must pass. Requires Swift 5.10+.

### Phase 2: Rust STT module

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/stt.rs` | **Create** | New module wrapping fluidaudio-rs for Tauri integration |

Module responsibilities:
- Hold `FluidAudio` instance in app state, lazy-initialized behind a single `Mutex<SttInner>`.
- Expose Tauri commands:
  - `stt_init()` — initializes ASR (downloads model on first call), emits `stt-ready` or `stt-error`
  - `stt_init_streaming()` — initializes streaming ASR
  - `stt_transcribe_speech(samples: Vec<f32>)` → `{ text, confidence }` — batch transcription
  - `stt_streaming_start()`, `stt_streaming_feed(samples: Vec<f32>)` → `Option<String>`, `stt_streaming_finish()` → `String`
  - `stt_get_status()` → `{ asr_ready: bool, streaming_ready: bool, is_apple_silicon: bool, is_intel: bool, is_supported: bool }`
- All commands return `Result<T, String>` for easy frontend error handling.
- On non-macOS or Intel Mac: commands return clear errors → frontend falls back to cloud STT.

```rust
use fluidaudio_rs::FluidAudio;
use serde_json;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub struct SttInner {
    audio: Option<FluidAudio>,
    asr_ready: bool,
    streaming_ready: bool,
    is_streaming_active: bool,
}

#[derive(Default)]
pub struct SttState {
    inner: Arc<Mutex<SttInner>>,
}

impl Default for SttInner {
    fn default() -> Self {
        Self {
            audio: None,
            asr_ready: false,
            streaming_ready: false,
            is_streaming_active: false,
        }
    }
}
```

Single `Mutex<SttInner>` eliminates deadlock risk between `audio`, readiness flags, and streaming session state.

### Phase 3: Wire into app state & commands

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/lib.rs` | **Modify** | Add `mod stt;`, register `SttState` in `.manage()`, add STT commands to `invoke_handler![]` |

### Phase 4: Integrate batch STT

| File | Action | Description |
|------|--------|-------------|
| `src/lib/functions/stt.function.ts` | **Modify** | Add branch: if provider is `local-fluidaudio`, invoke `stt_transcribe_speech` with f32 samples instead of HTTP fetch. |
| `src/config/stt.constants.ts` | **Modify** | Add new provider entry `local-fluidaudio` (in-process, no curl URL). |
| `src/contexts/app.context.tsx` | **Modify** | Change default STT from `local-parakeet` to `local-fluidaudio`. |
| `src/hooks/useSystemAudio.ts` | **Modify** | When `speech-detected` fires, decode base64 WAV to f32 samples and pass them to `fetchSTT()`. `fetchSTT()` internally branches for `local-fluidaudio`. |

Design notes:
- Keep `speech-detected` payload as base64 WAV — zero changes to the capture pipeline.
- Add a shared frontend helper `wavBase64ToF32Samples(base64: string): Float32Array` for decoding. Used by both batch local path and streaming feed path.
- The base64 WAV → f32 round-trip adds latency vs. transcribing inside the capture loop. Accept this for first pass; document as a future optimization.

### Phase 5: Integrate streaming STT

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/speaker/commands.rs` | **Modify** | When streaming + local-fluidaudio active: on `speech-start`, call `stt_streaming_start()`. On each `speech-chunk`, decode chunk to f32 and call `stt_streaming_feed`. On silence/end, call `stt_streaming_finish()` and emit `stt-final` with full text. |
| `src-tauri/src/speaker/commands.rs` | **Modify** | When streaming + custom provider active: keep existing `speech-chunk` Tauri event (base64 raw f32) so the frontend WebSocket path keeps working. |
| `src/hooks/useSystemAudio.ts` | **Modify** | Replace WebSocket-to-localhost logic with Tauri event listeners for `stt-partial` and `stt-final` when selected provider is `local-fluidaudio`. For other streaming providers, keep the existing WebSocket path. |
| `src-tauri/src/stt.rs` | **Modify** | Streaming commands call into `FluidAudio` streaming API, guarded by `is_streaming_active`. |

### Phase 6: First-run UX and platform fallback

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useSttStatus.ts` | **Create** | Hook that calls `stt_get_status()` on mount, listens to `stt-ready`/`stt-error` events. Exposes `{ asrReady, streamingReady, isSupported, isInitializing, error }`. |
| `src/components/SttInitOverlay.tsx` | **Create** | Overlay shown during lazy init: "Preparing local speech model...". |
| `src/hooks/useSystemAudio.ts` | **Modify** | In `startCapture()`: if selected provider is `local-fluidaudio`, call `stt_get_status()`. If not ready, trigger lazy `stt_init()` and show overlay. On failure, auto-switch selected provider to cloud STT (e.g., `groq`) and show a one-time toast. |
| `src/contexts/app.context.tsx` | **Modify** | On non-macOS or Intel Mac: if default is `local-fluidaudio`, auto-switch to `groq` and show toast "Local STT requires macOS Apple Silicon — switched to cloud STT". |
| `src/config/stt.constants.ts` | **Modify** | Mark `local-fluidaudio` with `platform: "macos-apple-silicon"` in provider metadata. Filter provider list by platform on first run. |

Lazy init happens on first capture attempt, not app startup, so users who never use STT never pay the model-download cost.

### Phase 7: Bundle metadata & docs

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/tauri.conf.json` | **Modify** | Set `minimumSystemVersion: "14.0"`. |
| `AGENTS.md` | **Modify** | Update local STT path from MLX/Python sidecar to fluidaudio-rs. |
| `docs/path-a-stt-sidecar-blueprint.md` | **Modify** | Mark as abandoned in favor of this blueprint. |

## Build sequence (checklist)

### Phase 1: Dependency & build verification
- [ ] Add `fluidaudio-rs = "0.14.1"` to `Cargo.toml` under macOS target deps
- [ ] Verify Swift 5.10+ is installed (`swift --version`)
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` — must pass (builds Swift bridge)

### Phase 2: Rust STT module
- [ ] Create `src-tauri/src/stt.rs` with `SttInner`, `SttState`, `stt_init`, `stt_transcribe_speech`, `stt_get_status`
- [ ] Add `mod stt;` to `lib.rs`
- [ ] Register `SttState` in `.manage()`
- [ ] Register commands in `invoke_handler![]`
- [ ] `cargo check` — must pass

### Phase 3: Wire batch STT
- [ ] Add `local-fluidaudio` provider to `stt.constants.ts`
- [ ] Change default STT to `local-fluidaudio` in `app.context.tsx`
- [ ] Add `wavBase64ToF32Samples` helper in frontend
- [ ] Add local STT branch to `fetchSTT()` invoking `stt_transcribe_speech`
- [ ] Test: speak → VAD detects → transcribe_samples → text appears
- [ ] `npx tsc --noEmit` + `npm run build` + `cargo check` all green

### Phase 4: Wire streaming STT
- [ ] Add streaming commands to `stt.rs`: `stt_streaming_start/feed/finish`
- [ ] Modify `speaker/commands.rs`: on speech-start/chunk/end, branch by provider and call streaming API for local-fluidaudio
- [ ] Emit `stt-partial` and `stt-final` Tauri events from Rust
- [ ] Replace WebSocket logic in `useSystemAudio.ts` for local-fluidaudio; keep WebSocket path for other streaming providers
- [ ] Test: speak continuously → partial text updates live → final text on silence
- [ ] All checks green

### Phase 5: First-run UX
- [ ] Create `useSttStatus` hook
- [ ] Create `SttInitOverlay` component
- [ ] Lazy init on first `startCapture()` for local-fluidaudio
- [ ] Show overlay during model download
- [ ] Test: fresh install → start capture → overlay → download → ready → transcription works
- [ ] All checks green

### Phase 6: Fallback & polish
- [ ] Platform gating: non-macOS/Intel → auto-switch to Groq + toast
- [ ] Error handling: `stt_init` failure → show error, offer cloud switch
- [ ] Handle `stt_transcribe_speech` failure gracefully
- [ ] Deprecate `mlx_asr_server.py` and `whisper_server.py` as default (keep as advanced opt-in)
- [ ] Update `AGENTS.md`
- [ ] Full verification: `tsc`, `build`, `cargo check`

### Phase 7: Release metadata
- [ ] Bump version to `1.0.0-alpha.1`
- [ ] Set `minimumSystemVersion: "14.0"`
- [ ] Add bundle metadata (publisher, copyright, category)
- [ ] Remove unused `TAURI_SIGNING_PRIVATE_KEY*` from `publish.yml`

## Known limitations

- **No live partial transcription for Parakeet streaming.** `fluidaudio-rs` 0.14.1's `streaming_asr_feed()` returns `Result<(), String>` and accumulates audio internally; partial text is only available after `streaming_asr_finish()` returns. The frontend `stt-final` event delivers the full transcript on silence. The "Listening" indicator shows, but no partial words appear. Custom providers (e.g., `local-parakeet`) still show partials via the WebSocket path. Qwen3 streaming in fluidaudio-rs exposes partials and could be adopted later if live preview is required.

## What gets removed/simplified

After fluidaudio-rs is integrated:
- `mlx_asr_server.py` — no longer needed for default local STT (keep as advanced option)
- `whisper_server.py` — same
- WebSocket streaming logic in `useSystemAudio.ts` for `local-fluidaudio` — replaced by Tauri events
- Python venv packaging — never needed
- Sidecar process lifecycle — never needed
- `localhost:8001` capability not required for default path, but kept for advanced users running their own MLX server

## Critical details

- **Build dependency**: Swift 5.10+ must be installed on any machine building the app. The crate's `build.rs` runs `swift build`. On macOS with Xcode this is already present. CI needs `actions/setup-swift` or equivalent on non-macOS if ever cross-compiling.
- **macOS minimum**: `minimumSystemVersion: "14.0"` in `tauri.conf.json`.
- **Intel Macs**: `is_intel_mac()` returns true → no ASR. Gate in UI and fall back to cloud.
- **Non-macOS**: fluidaudio-rs is macOS-only. `cfg(target_os = "macos")` gate removes the dependency on Windows/Linux.
- **Model download**: first `init_asr()` call downloads ~500MB from HuggingFace and compiles CoreML models (20-30s). Cached afterwards.
- **Thread safety**: `FluidAudioBridge` is `Send + Sync`. `SttState` uses a single `Mutex<SttInner>` to avoid deadlock between state fields.
- **VAD**: keep hand-rolled RMS/peak VAD for first integration. FluidAudio Silero VAD is a future enhancement.
- **Code signing**: the built `.app` contains the Swift static library. Apple Developer ID signing covers it.
- **Bundle size**: Swift library is small; 500MB model is downloaded at runtime, not bundled.
