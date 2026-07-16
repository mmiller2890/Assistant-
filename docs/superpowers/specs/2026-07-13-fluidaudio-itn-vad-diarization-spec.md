# FluidAudio Feature Enhancement Spec — ITN, Silero VAD, Speaker Diarization

**Date:** 2026-07-13
**Status:** Approved for implementation
**Branch strategy:**
- `dev` — ITN only (quick, cherry-pick everywhere)
- `feat/fluidaudio-vad-diarization` — Silero VAD + speaker diarization only

## Overview

Unlock three already-compiled FluidAudio capabilities that the app currently does not use:

1. **ITN (Inverse Text Normalization)** — clean up spoken-form ASR output before sending it to the AI.
2. **Silero VAD** — replace the hand-rolled RMS/peak threshold VAD with a neural model for more accurate speech detection.
3. **Speaker diarization** — label transcript turns with speaker IDs after a capture session ends.

All three APIs are exposed by `fluidaudio-rs` 0.14.1 with its default features (`asr`, `vad`, `diarization`), so no new Cargo dependencies are required. TTS and streaming ASR are explicitly out of scope for this spec.

## Part A: ITN (all branches)

### Goal
Run `itn_normalize_sentence` on every `local-fluidaudio` transcription so spoken-form text becomes written-form before it reaches the AI: "two hundred fifty dollars" → "$250", "period" → ".", "three thirty pm" → "3:30 PM".

### Why
It is a post-processing function that runs in milliseconds, requires no model download beyond the already-loaded ASR model, and improves the quality of every downstream AI response.

### API
```rust
let raw = audio.transcribe_samples(&samples)?.text;
let normalized = audio.itn_normalize_sentence(&raw)?;
```

### Implementation
In `src-tauri/src/stt.rs`, after `audio.transcribe_samples(samples)` returns, normalize the result text. Fall back to the raw text if normalization fails so transcription is never blocked.

### Files
| File | Change |
|------|--------|
| `src-tauri/src/stt.rs` | Add ITN call inside `transcribe_samples()` |

### Verification
- `cargo check` passes.
- Speaking "I paid two hundred dollars" returns "I paid $200".

### Commit message
```
feat(stt): add ITN post-processing to transcribe_samples
```

## Part B: Silero VAD (feature branch only)

### Goal
Replace the threshold-based VAD decision in `run_vad_capture` with Silero VAD from `fluidaudio-rs`, while keeping the existing RMS/peak fallback for non-macOS platforms, Intel Macs, or Silero init failures.

### Current architecture
`src-tauri/src/speaker/commands.rs:181-182` decides speech per 1024-sample hop:
```rust
let (rms, peak) = calculate_audio_metrics(&mono);
let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;
```
The surrounding buffer management, pre-speech buffering, silence tracking, and WAV emission stays useful.

### Silero VAD API
- `audio.init_vad(threshold: f32)` — initialize the Silero model.
- `audio.vad_process_samples(&[f32]) -> Vec<VadFrame>` — returns per-chunk results.
- `VadFrame { probability: f32, is_voice_active: bool, processing_time: f64 }`.

`vad_process_samples` processes audio in **4096-sample (256 ms) chunks**, not 1024.

### Design decision
Use Silero inside the existing `run_vad_capture` loop (Option A). The buffer management and emission logic stay the same; only the speech/no-speech decision changes.

Because Silero wants 4096 samples and the loop uses 1024-sample hops, accumulate 4 hops into a 4096-sample Silero input, then use `is_voice_active` for that quarter-second window as the speech decision for the next 4 iterations. Keep the fallback threshold check when Silero is unavailable.

### Implementation

#### Rust: `src-tauri/src/stt.rs`
1. Add `vad_ready: bool` to `SttInner`.
2. Add `init_vad_inner(inner, threshold)` (spawn-blocking, idempotent).
3. Add `SttState::vad_process_samples(&self, samples)`.
4. Add Tauri command `stt_init_vad(threshold: f32)`.
5. Add `vad_ready` to `stt_get_status` response.

#### Rust: `src-tauri/src/lib.rs`
Register `stt::stt_init_vad` in `invoke_handler!`.

#### Rust: `src-tauri/src/speaker/commands.rs`
1. Add a rolling `vad_accumulator: Vec<f32>` to `run_vad_capture`.
2. On every 1024-sample hop, append the noise-gated chunk to the accumulator.
3. When the accumulator reaches 4096 samples:
   - Call `SttState::vad_process_samples(&accumulator)`.
   - Use `frames.iter().any(|f| f.is_voice_active)` as the speech decision for the next 4 hop iterations.
   - Clear the accumulator.
4. If Silero is not initialized or the call fails, fall back to the old `(rms, peak)` check.
5. Keep the existing pre-speech, silence, and emission logic.

#### TypeScript: `src/hooks/useSystemAudio.ts`
In `startCapture()`, for `local-fluidaudio`, call `stt_init_vad` after `stt_init`/`initStt` succeeds. Log and continue on failure (fallback VAD will still work).

#### UI: `src/components/SttInitOverlay.tsx`
Change singular text to plural: "Preparing local speech models…" and "First run may take 20–50 seconds".

### Files
| File | Change |
|------|--------|
| `src-tauri/src/stt.rs` | Add `vad_ready`, init, process, command, status field |
| `src-tauri/src/lib.rs` | Register `stt_init_vad` |
| `src-tauri/src/speaker/commands.rs` | Replace VAD decision with Silero + fallback |
| `src/hooks/useSystemAudio.ts` | Call `stt_init_vad` in `startCapture` |
| `src/components/SttInitOverlay.tsx` | Update loading copy for multiple models |

### Verification
- `cargo check`, `npx tsc --noEmit`, `npm run build` all pass.
- Keyboard typing during capture does not trigger false speech.
- Quiet speech is detected.
- Background music does not trigger false speech.
- Non-macOS / Intel Mac still uses threshold VAD.

### Commit message
```
feat(stt): replace threshold VAD with Silero, keep fallback
```

## Part C: Speaker diarization (feature branch only)

### Goal
After a capture session ends, run offline speaker diarization on the full session audio and label each transcription turn with the dominant speaker for that utterance.

### Constraint
`fluidaudio-rs` only exposes offline diarization: `diarize_file(path)`. There is no streaming diarization in the Rust API. Therefore speaker labels appear **after the session stops**, not live during capture.

### Architecture
1. During `run_vad_capture`, append every processed sample chunk to a `session_audio: Vec<f32>` buffer and record `session_start: Instant`.
2. On capture stop, write the session buffer to a temp WAV file.
3. Emit a new event `capture-stopped-with-audio` carrying the temp path and session duration.
4. For each `speech-detected` utterance, include `start_time` and `end_time` relative to `session_start`.
5. On the frontend, when `capture-stopped-with-audio` fires, call `stt_diarize_file(path)`.
6. Correlate diarization segments with utterance timestamps and store speaker labels per message.
7. Display speaker labels in `ResultsSection` and conversation history.

### Implementation

#### Rust: `src-tauri/src/stt.rs`
1. Add `diarization_ready: bool` to `SttInner`.
2. Add `init_diarization_inner(inner, threshold)` (spawn-blocking, idempotent).
3. Add `SttState::diarize_file(&self, path)`.
4. Add Tauri commands `stt_init_diarization(threshold: f64)` and `stt_diarize_file(path: String)`.
5. Add `diarization_ready` to `stt_get_status` response.

#### Rust: `src-tauri/src/lib.rs`
Register `stt::stt_init_diarization` and `stt::stt_diarize_file` in `invoke_handler!`.

#### Rust: `src-tauri/src/speaker/commands.rs`
1. In `run_vad_capture`:
   - Add `session_audio: Vec<f32>` and `session_start: Instant`.
   - Append every `mono` chunk to `session_audio`.
   - Track utterance start time at `speech-start` and utterance end time at speech-end.
   - Change `speech-detected` payload from a plain base64 string to an object: `{ audio: string, start_time: f32, end_time: f32 }`.
   - On stream end, write `session_audio` to `temp_dir/assistant-session-{uuid}.wav`.
   - Emit `capture-stopped-with-audio { path, sample_rate, duration_seconds }`.
   - Clean up the temp file after a short delay or on app exit.
2. In `run_continuous_capture`:
   - No VAD segmentation; still accumulate audio, emit the same stop event, and skip diarization labeling (or label the whole recording as one speaker).

#### TypeScript: `src/hooks/useSystemAudio.ts`
1. Add state:
   ```typescript
   const [speakerSegments, setSpeakerSegments] = useState<Array<{
     speaker_id: string;
     start_time: number;
     end_time: number;
   }>>([]);
   ```
2. Add `utteranceTimestampsRef` to store `{ start_time, end_time }` for each transcription.
3. In `speech-detected` handler, extract `audio`, `start_time`, `end_time` from the payload and push to the ref.
4. In `stopCapture()`:
   - If `selectedSttProvider.provider === "local-fluidaudio"`, listen once for `capture-stopped-with-audio`.
   - Call `stt_init_diarization` if not ready, then `stt_diarize_file({ path })`.
   - Set `speakerSegments` from the result.
5. Add `getSpeakerForUtterance(start, end)` that returns the speaker segment with the greatest overlap.
6. When appending a new user message, tag it with the dominant speaker.

#### TypeScript: `src/pages/app/components/speech/ResultsSection.tsx`
1. Accept `speakerSegments` and `utteranceTimestamps` props.
2. Show a small speaker badge (e.g., "Speaker 0", "Speaker 1") above each transcription and historical user message.
3. While diarization is running, show "Labeling speakers…".

### Files
| File | Change |
|------|--------|
| `src-tauri/src/stt.rs` | Add diarization init/process/commands/status |
| `src-tauri/src/lib.rs` | Register diarization commands |
| `src-tauri/src/speaker/commands.rs` | Accumulate session audio, emit timestamps + stop event, temp WAV cleanup |
| `src/hooks/useSystemAudio.ts` | Run diarization on stop, correlate segments, store labels |
| `src/pages/app/components/speech/ResultsSection.tsx` | Display speaker labels |

### Model download impact
| Model | Size | First-run time |
|-------|------|----------------|
| ASR (Parakeet TDT v3) | ~500 MB | 20–30 s |
| VAD (Silero) | ~10 MB | 2–5 s |
| Diarization | ~100–200 MB | 5–15 s |
| **Total** | **~610–710 MB** | **27–50 s** |

### Verification
- `cargo check`, `npx tsc --noEmit`, `npm run build` all pass.
- Two-person conversation → distinct speaker labels appear after stop.
- Single speaker → all utterances share one label.
- Diarization init fails → unlabeled transcripts, no crash.
- Non-macOS → no diarization, no errors.

### Commit message
```
feat(stt): add offline speaker diarization for local-fluidaudio
```

## Out of scope

- **TTS** — does not fit the stealth meeting use case and requires enabling the non-default `tts` feature.
- **Streaming ASR** — the existing Parakeet TDT streaming API returned empty text in previous testing; Qwen3 streaming is a separate future provider decision.
- **Real-time speaker labels** — impossible with the offline `diarize_file` API.

## Critical fallback rules

| Feature | Fallback if init fails | Fallback platform |
|---------|------------------------|-------------------|
| ITN | Raw text returned | All macOS Apple Silicon |
| Silero VAD | Threshold RMS/peak VAD | Non-macOS, Intel Mac, or init error |
| Diarization | Unlabeled transcripts | Non-macOS, Intel Mac, or init error |

## Build sequence

### Phase 1: ITN (all branches)
- Modify `src-tauri/src/stt.rs`.
- Verify `cargo check`.
- Commit to `dev`, push, cherry-pick to `feat/fluidaudio-rs` and `main`.

### Phase 2: VAD + diarization feature branch
- Create `feat/fluidaudio-vad-diarization` from `dev`.
- Implement Silero VAD.
- Implement speaker diarization.
- Merge into `dev` when stable.
- Promote to `main` after validation.
