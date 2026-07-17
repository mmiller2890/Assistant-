# Native mic dictation — design

**Date:** 2026-07-16 · **Status:** Approved · **Branch:** all work lands on `dev`

## Why

The mic/dictation button (`AutoSpeechVad.tsx`) runs `@ricky0123/vad-react`, which at
runtime fetches Silero + ONNX wasm from jsdelivr — including an **unpinned
`@latest`** URL. For a privacy-first, local-only app that is a supply-chain
exposure and an offline breakage, and it duplicates a VAD the app already runs
natively (Rust Silero in `speaker/commands.rs`). Bundling the JS assets instead
would add ~19 MB to every installer to keep a redundant stack.

## Decisions locked

1. **Route mic dictation through the native Rust Silero pipeline** (not asset bundling).
2. **macOS-only for v1** — mirrors the STT default (fluidaudio is macOS-only).
   Windows/Linux keep the JS path for now, loaded lazily so macOS never touches it.
3. `@ricky0123/vad-react` stays in package.json until Win/Linux consolidate (follow-up).

## Verified foundations

- `resample_linear` (tested) already converts device-rate → 16 kHz for Silero.
- `silero_is_speech` hysteresis + `get_silero_vad_probability` are reusable as-is.
- `NSMicrophoneUsageDescription` already present in `src-tauri/info.plist`.
- `cpal 0.15.3` already a dependency; `selectedAudioDevices.input` already in app context.
- Downstream of dictation is unchanged: `fetchSTT → submit()` into the completion input.

## Architecture

### Rust (`src-tauri/src/speaker/`)

- **`mic.rs` (new):** `MicInput::new(device_name: Option<String>)` builds a cpal
  input stream on the named device (match by cpal device name; fall back to
  default input). cpal callback downmixes to mono f32 and sends into an
  `std::sync::mpsc` → bridged to a `tokio::sync::mpsc` consumed async (cpal
  streams stay on their own thread, mirroring the Linux SpeakerStream pattern).
  Exposes the device sample rate.
- **`commands.rs`:** new commands
  - `start_mic_dictation(app, device_id: Option<String>) -> Result<(), String>`
  - `stop_mic_dictation(app) -> Result<(), String>`
  plus a `run_mic_dictation` loop: hop-buffer → `resample_linear` to 16 kHz →
  `get_silero_vad_probability` → `silero_is_speech` hysteresis → buffer the
  utterance (with the same pre-speech padding constants as the tap path) → on
  utterance end, `normalize_audio_level` + `samples_to_wav_b64` → emit
  **`dictation-detected`** with payload `{ audio: <b64 wav> }`. No session
  audio, no timestamps (dictation has no session timeline — field absent, not 0.0),
  no streaming socket, no summary.
- **State:** its own task slot (`MicDictationState { task: Mutex<Option<JoinHandle>> }`)
  managed separately in `lib.rs` — dictation and system-audio capture must not
  share a slot, so neither can kill the other. Both may run simultaneously.
- **Silero availability:** dictation requires the fluidaudio Silero (macOS).
  `start_mic_dictation` errors clearly if STT/Silero isn't initialized; the
  frontend surfaces it on the button (existing error styling).

### Frontend

- **`src/hooks/useMicDictation.ts` (new):** state machine
  `idle | starting | listening | transcribing | error(message)`. `start()` invokes
  `start_mic_dictation` with `selectedAudioDevices.input.id`; listens for
  `dictation-detected`; on event runs the exact current `onSpeechEnd` body
  (provider checks → `fetchSTT` → `submit(transcription)`); `stop()` invokes
  `stop_mic_dictation`. Cleanup on unmount (stop + unlisten). Errors from
  invoke/listen land in `error` state.
- **`Audio.tsx`:** keeps its Popover config-warning wrapper and platform-splits
  the configured child: macOS → new `MicDictationButton` (same icon states as
  today: mic / spinner-loading / pulsing mic-off listening / spinner-transcribing
  / red mic + tooltip on error, click-to-reset); non-macOS → existing
  `AutoSpeechVAD`, now loaded via `React.lazy(() => import(...))` so
  vad-react's module (and any CDN side effects) never load on macOS.
- The completion `micOpen`/`enableVAD` gating from the invisible-pane fix is
  unchanged; the mac button manages listening state internally.

## Error handling

- cpal device missing/permission denied → command returns Err → button error
  state with the message (mirrors existing surfaced-error pattern).
- Silero not ready → clear Err from start command ("voice detection not ready").
- STT fetch failures → existing catch → completion `state.error` (unchanged).

## Testing / verification

- Rust unit tests where logic is pure (mono downmix helper; utterance
  hysteresis loop if extractable) alongside the existing `resample_linear` tests.
- `cargo check`, `npx tsc --noEmit`, `npm run build`, `npx vitest run` all green.
- Manual on macOS: mic button → listening state; speak → text lands in the
  input box; **zero requests to `jsdelivr.net`** in the webview network panel;
  system-audio capture and dictation can run simultaneously; stop works; cold
  start with STT uninitialized shows a clear button error, not a hang.

## Out of scope

- Windows/Linux native mic path (follow-up; JS path remains there).
- Removing `@ricky0123/vad-react` from package.json (done with the follow-up).
- Any change to the system-audio capture path.
