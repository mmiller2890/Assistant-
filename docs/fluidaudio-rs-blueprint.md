# FluidAudio-rs Integration Blueprint — In-Process Local STT

**Status:** Designed, not yet implemented. No deadline — execute when ready.
**Branch:** `feat/fluidaudio-rs` (isolated from `main`/`dev`)
**Date:** 2026-07-09
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
- **Swift 5.10+ toolchain** required at build time (the crate's `build.rs` runs `swift build`)
- **Linux/Windows**: not supported by fluidaudio-rs — existing cloud STT (Groq etc.) remains the path
- **First-run download**: ~500MB model, 20-30s CoreML compilation. Cached on subsequent loads (~1s)

## Existing patterns to follow

- **Tauri commands** registered in `src-tauri/src/lib.rs:55-84` via `invoke_handler![]`
- **App state** via `tauri::Manager` — `AudioState` at `src-tauri/src/lib.rs:17-22` holds `Arc<Mutex<...>>` fields
- **Audio capture pipeline** in `src-tauri/src/speaker/commands.rs` — VAD detects speech, emits `speech-start`, `speech-chunk`, `speech-detected` Tauri events with f32 samples (base64-encoded)
- **Frontend STT flow** in `src/hooks/useSystemAudio.ts` — listens to speech events, sends audio to STT provider, gets text back, calls AI
- **STT provider system** in `src/config/stt.constants.ts` + `src/contexts/app.context.tsx:112-115` — curl-template providers, `selectedSttProvider` state
- **Batch STT** in `src/lib/functions/stt.function.ts` — `fetchSTT()` sends audio to provider URL, parses response
- **Streaming STT** in `src/hooks/useSystemAudio.ts:136-220` — WebSocket to `ws://localhost:8001/v1/audio/stream`

## Architecture

```
Current flow (batch):
  Rust VAD → speech-detected event (wav base64) → JS → fetchSTT() → HTTP to provider → text → processWithAI()

Current flow (streaming):
  Rust VAD → speech-start/speech-chunk events → JS → WebSocket to localhost:8001 → Python MLX → partial text → processWithAI()

New flow (fluidaudio-rs, batch):
  Rust VAD → speech-detected → Rust transcribe_samples() → Tauri event with text → JS processWithAI()

New flow (fluidaudio-rs, streaming):
  Rust VAD → speech-start → Rust streaming_asr_start()
         → speech-chunk → Rust streaming_asr_feed(&f32_samples) → partial text Tauri event → JS
         → silence/end → Rust streaming_asr_finish() → final text Tauri event → JS processWithAI()
```

Key insight: **transcription moves from JS/Python into Rust**. The frontend no longer sends audio out for transcription — it receives already-transcribed text via Tauri events. The entire `fetchSTT()` / WebSocket-to-Python path is bypassed for the local provider.

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
| `src-tauri/Cargo.toml` | **Verify** | Confirm `thiserror` already a dep (it is: `thiserror = "1.0"` — check). If not, add it. |

Build verification: `cargo check --manifest-path src-tauri/Cargo.toml` must pass. This requires Swift 5.10+ installed. The crate's `build.rs` runs `swift build -c release` to compile the FFI bridge.

### Phase 2: Rust STT module

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/stt.rs` | **Create** | New module wrapping fluidaudio-rs for Tauri integration |

Module responsibilities:
- Hold a `FluidAudio` instance in app state (lazy-initialized, behind `Mutex<Option<FluidAudio>>`)
- Expose Tauri commands:
  - `stt_init()` — initializes ASR (downloads model on first run), emits `stt-ready` or `stt-error` event
  - `stt_init_streaming()` — initializes streaming ASR
  - `stt_transcribe_samples(samples: Vec<f32>)` → `{ text, confidence }` — batch transcription
  - `stt_streaming_start()`, `stt_streaming_feed(samples: Vec<f32>)` → `Option<String>`, `stt_streaming_finish()` → `String`
  - `stt_get_status()` → `{ asr_ready: bool, streaming_ready: bool, is_apple_silicon: bool, is_intel: bool }`
- All commands return `Result<T, String>` for easy frontend error handling
- On non-macOS or Intel Mac: commands return error → frontend falls back to cloud STT

```rust
// src-tauri/src/stt.rs (sketch)
use fluidaudio_rs::FluidAudio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub struct SttState {
    audio: Arc<Mutex<Option<FluidAudio>>>,
    asr_ready: Arc<Mutex<bool>>,
    streaming_ready: Arc<Mutex<bool>>,
}

impl Default for SttState {
    fn default() -> Self {
        Self {
            audio: Arc::new(Mutex::new(None)),
            asr_ready: Arc::new(Mutex::new(false)),
            streaming_ready: Arc::new(Mutex::new(false)),
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
        *state.asr_ready.lock().unwrap() = true;
        *state.audio.lock().unwrap() = Some(audio);
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
        let guard = state.audio.lock().unwrap();
        let audio = guard.as_ref().ok_or("STT not initialized")?;
        let result = audio.transcribe_samples(&samples).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "text": result.text, "confidence": result.confidence }))
    }
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

### Phase 4: Integrate batch STT into capture pipeline

Currently, `speaker/commands.rs` emits `speech-detected` with base64 WAV audio. The frontend receives this, calls `fetchSTT()` to send to the STT provider, gets text back.

Two integration options:

**Option A (simpler, recommended for first pass): Keep the event boundary, transcribe in Rust on the event.**
- Rust captures speech → emits `speech-detected` with f32 samples (not base64 WAV)
- Add a separate Tauri command `stt_transcribe_speech` that the frontend calls with the samples
- Frontend: when local STT provider is selected, `invoke("stt_transcribe_speech", { samples })` instead of `fetchSTT()`
- Minimal change to the capture pipeline

**Option B (deeper, better performance): Transcribe inside the capture loop.**
- In `run_vad_capture`, when speech segment completes, call `audio.transcribe_samples()` directly
- Emit `speech-transcribed` event with the text (not audio)
- Frontend just receives text, no `fetchSTT()` call needed
- Requires holding the `FluidAudio` instance accessible from the capture task

**Recommendation: Start with Option A** (less invasive, faster to ship). Migrate to Option B later for latency reduction.

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/speaker/commands.rs` | **Modify** | When local STT is active and batch mode: emit `speech-detected` with raw f32 samples (JSON array) instead of base64 WAV. Keep base64 WAV path for cloud providers. |
| `src/lib/functions/stt.function.ts` | **Modify** | Add branch: if provider is `local-fluidaudio`, `invoke("stt_transcribe_speech", { samples })` instead of HTTP fetch. |
| `src/config/stt.constants.ts` | **Modify** | Add new provider entry `local-fluidaudio` (marks it as in-process, no curl URL needed). |
| `src/contexts/app.context.tsx` | **Modify** | Change default STT from `local-parakeet` to `local-fluidaudio`. |

### Phase 5: Integrate streaming STT

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/speaker/commands.rs` | **Modify** | When streaming + local STT: on `speech-start`, call `stt_streaming_start()`. On each `speech-chunk`, call `stt_streaming_feed(&f32_samples)` and emit `stt-partial` event with partial text (if any). On silence/end, call `stt_streaming_finish()` and emit `stt-final` with full text. |
| `src/hooks/useSystemAudio.ts` | **Modify** | Replace WebSocket-to-localhost:8001 logic with Tauri event listeners for `stt-partial` and `stt-final`. Remove `openStreamingSocket()`, `wsRef`, WebSocket lifecycle. |
| `src-tauri/src/stt.rs` | **Modify** | Streaming commands call into `FluidAudio` streaming API. Hold streaming session state. |

### Phase 6: First-run UX

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useSttStatus.ts` | **Create** | Hook that calls `stt_get_status()` on mount, listens to `stt-ready`/`stt-error` events. Exposes `{ asrReady, streamingReady, isIntel, isSupported }`. |
| `src/components/SttInitOverlay.tsx` | **Create** | First-run overlay: "Downloading speech model (~500MB)..." while `stt_init()` runs. On error (Intel Mac, non-macOS): "Local STT unavailable — using cloud STT" with button to switch to Groq. |
| `src/pages/app/components/speech/index.tsx` | **Modify** | Show `SttInitOverlay` when local STT selected but not yet ready. |
| `src/contexts/app.context.tsx` | **Modify** | On app startup (macOS + Apple Silicon): auto-call `stt_init()`. Gate local STT selection on readiness. |

### Phase 7: Fallback & platform gating

| File | Action | Description |
|------|--------|-------------|
| `src/contexts/app.context.tsx` | **Modify** | On non-macOS or Intel Mac: if default is `local-fluidaudio`, auto-switch to `groq` and show a one-time toast "Local STT requires macOS Apple Silicon — switched to cloud STT". |
| `src/config/stt.constants.ts` | **Modify** | Mark `local-fluidaudio` as `platform: "macos-apple-silicon"` in provider metadata. Filter provider list by platform on first run. |

## Build sequence (checklist)

### Phase 1: Dependency & build verification
- [ ] Add `fluidaudio-rs = "0.1"` to `Cargo.toml` under macOS target deps
- [ ] Verify Swift 5.10+ is installed (`swift --version`)
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` — must pass (builds Swift bridge)
- [ ] If build fails: check Swift toolchain, Xcode command line tools

### Phase 2: Rust STT module
- [ ] Create `src-tauri/src/stt.rs` with `SttState`, `stt_init`, `stt_transcribe_samples`
- [ ] Add `mod stt;` to `lib.rs`
- [ ] Register `SttState` in `.manage()`
- [ ] Register commands in `invoke_handler![]`
- [ ] `cargo check` — must pass

### Phase 3: Wire batch STT
- [ ] Add `local-fluidaudio` provider to `stt.constants.ts`
- [ ] Change default STT to `local-fluidaudio` in `app.context.tsx`
- [ ] Add local STT branch to `fetchSTT()` or bypass it for `local-fluidaudio`
- [ ] Modify `speech-detected` event to carry f32 samples when local STT active
- [ ] Test: speak → VAD detects → transcribe_samples → text appears
- [ ] `npx tsc --noEmit` + `npm run build` + `cargo check` all green

### Phase 4: Wire streaming STT
- [ ] Add streaming commands to `stt.rs`: `stt_streaming_start/feed/finish`
- [ ] Modify `speaker/commands.rs`: on speech-start/chunk/end, call streaming API
- [ ] Emit `stt-partial` and `stt-final` Tauri events
- [ ] Replace WebSocket logic in `useSystemAudio.ts` with event listeners
- [ ] Test: speak continuously → partial text updates live → final text on silence
- [ ] All checks green

### Phase 5: First-run UX
- [ ] Create `useSttStatus` hook
- [ ] Create `SttInitOverlay` component
- [ ] Auto-call `stt_init()` on app startup (macOS + Apple Silicon)
- [ ] Show overlay during model download
- [ ] Test: fresh install → overlay → download → ready → transcription works
- [ ] All checks green

### Phase 6: Fallback & polish
- [ ] Platform gating: non-macOS/Intel → auto-switch to Groq + toast
- [ ] Error handling: `stt_init` failure → show error, offer cloud switch
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

After fluidaudio-rs is integrated, these become unnecessary:
- `mlx_asr_server.py` — no longer needed for default local STT (keep as advanced option)
- `whisper_server.py` — same
- WebSocket streaming logic in `useSystemAudio.ts` (`openStreamingSocket`, `wsRef`, `closeStreamingSocket`) — replaced by Tauri events
- `build_stt_bundle.sh` from the old blueprint — never needed
- Python venv packaging — never needed
- Sidecar process lifecycle — never needed
- `localhost:8001` capability in `capabilities/default.json` — can keep for advanced users, but not required for default

## Critical details

- **Build dependency**: Swift 5.10+ must be installed on any machine building the app (dev or CI). The crate's `build.rs` runs `swift build`. On macOS with Xcode, this is already present. CI needs `actions/setup-swift` or equivalent.
- **macOS minimum**: fluidaudio-rs requires macOS 14.0+. Set `minimumSystemVersion: "14.0"` in `tauri.conf.json`.
- **Intel Macs**: `is_intel_mac()` returns true → no ASR. Must gate in UI and fall back to cloud. Don't let the user select local STT on Intel.
- **Non-macOS**: fluidaudio-rs is macOS-only. On Windows/Linux, the `cfg(target_os = "macos")` gate makes the dependency absent. Cloud STT is the only option.
- **Model download**: first `init_asr()` call downloads ~500MB from HuggingFace and compiles CoreML models (20-30s). Must show UI during this. Subsequent loads: ~1s from cache.
- **Thread safety**: `FluidAudioBridge` is `Send + Sync` (per source). Safe to hold in `Arc<Mutex<Option<FluidAudio>>>` and call from Tauri commands.
- **VAD**: fluidaudio-rs includes Silero VAD (`vad_process_samples`). This could replace the hand-rolled RMS/peak VAD in `speaker/commands.rs:186-187`. This is a future enhancement, not required for first integration. The existing VAD works fine; FluidAudio's VAD is higher quality but swapping it is a separate task.
- **Code signing**: the built `.app` will contain the Swift-compiled `libFluidAudioBridge.a`. Apple Developer ID signing covers this — no special treatment needed beyond signing the app bundle.
- **Bundle size**: the Swift static library is small (~few MB). The 500MB model is downloaded at runtime, not bundled. Total app bundle stays small.
- **CI**: GitHub Actions macOS runners have Swift/Xcode pre-installed. `cargo build` will work. Windows/Linux CI builds skip the macOS-gated dependency.

## Prerequisites before starting implementation

- P1 #4: Bump version (`1.0.0-alpha.1` recommended)
- P1 #6: Add bundle metadata to `tauri.conf.json`
- P1 #7: Set `minimumSystemVersion: "14.0"` (fluidaudio-rs requirement)
- Verify `swift --version` is 5.10+ on the dev machine