# FluidAudio Feature Enhancement Plan — ITN, Silero VAD, Speaker Diarization

**Date:** 2026-07-10
**Status:** Ready to implement
**Branch strategy:**
- `dev` — ITN only (quick, applies to all branches)
- `feat/fluidaudio-vad-diarization` — Silero VAD + speaker diarization (branched from dev)

## Part A: ITN (Inverse Text Normalization) — all branches

### Goal
Convert spoken-form transcription output to written-form before sending to AI: "two hundred fifty dollars" → "$250", "period" → ".", "three thirty pm" → "3:30 PM".

### Why
fluidaudio-rs 0.14.1 already exposes `itn_normalize_sentence(text)` — no new dependencies, no model download, no UI changes. It's a post-processing function that runs in milliseconds. Every transcription gets cleaner, the AI gets better input, responses improve.

### API
```rust
// Already available in the FluidAudio instance
let raw = audio.transcribe_samples(&samples)?.text;
let normalized = audio.itn_normalize_sentence(&raw)?;
```

### Implementation

**File: `src-tauri/src/stt.rs`**

In `transcribe_samples()`, after `audio.transcribe_samples(samples)` returns, normalize the result text:

```rust
let result = audio.transcribe_samples(samples).map_err(|e| e.to_string())?;
let text = audio.itn_normalize_sentence(&result.text)
    .unwrap_or(result.text.clone());
Ok(serde_json::json!({
    "text": text,
    "confidence": result.confidence,
    "duration": result.duration,
    "processing_time": result.processing_time,
}))
```

Use `unwrap_or` fallback so ITN failure doesn't block transcription — the raw text is always returned even if normalization fails.

### Files to modify
| File | Change |
|------|--------|
| `src-tauri/src/stt.rs` | Add ITN call after transcription in `transcribe_samples()` |

### Verification
- `cargo check` passes
- Test: speak "I paid two hundred dollars" → transcription shows "I paid $200" not "I paid two hundred dollars"

### Commit
```
feat(stt): add ITN post-processing to transcribe_samples
```

---

## Part B: Silero VAD — feature branch

### Goal
Replace the hand-rolled RMS/peak threshold VAD with fluidaudio-rs's Silero VAD for more accurate speech detection. Fewer false triggers from keyboard/clicks/music, better detection of quiet speech.

### Branch
`feat/fluidaudio-vad-diarization` (from `dev`)

### Current VAD architecture
The VAD loop in `run_vad_capture()` (`commands.rs:159-370`) processes audio in `hop_size` (1024 sample) chunks. For each chunk:
1. Apply noise gate
2. Calculate RMS and peak amplitude
3. If RMS > threshold OR peak > threshold → speech detected
4. Track speech-start, silence-end, pre-speech buffer, min speech duration
5. On speech end: normalize, encode to WAV, emit `speech-detected`

The detection logic is tightly coupled to the buffer management. The VAD decision happens at line 182:
```rust
let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;
```

### Silero VAD architecture
fluidaudio-rs exposes:
- `audio.init_vad(threshold: f32)` — initialize the Silero model (downloads ~10MB on first call)
- `audio.vad_process_samples(&[f32]) -> Vec<VadFrame>` — process samples, return per-chunk probabilities
- `VadFrame { probability: f32, is_voice_active: bool, processing_time: f64 }`

Silero processes in 4096-sample (256ms) chunks, not 1024-sample chunks. The `is_voice_active` field is pre-computed based on the threshold passed to `init_vad`.

### Design decision: where to call Silero

**Option A: Call from inside `run_vad_capture` (recommended)**
Replace the `calculate_audio_metrics` + threshold check with a call to `stt_state.vad_process_samples(&mono)`. The VAD loop structure stays the same — speech-start, silence-end, pre-speech buffer, etc. Only the detection decision changes.

**Option B: Pre-process entire stream with Silero, then segment**
Run Silero over the whole audio stream first, then cut segments at speech boundaries, then transcribe each segment. This is cleaner but a bigger refactor.

**Recommendation: Option A.** Minimal change to the existing loop. The buffer management, silence tracking, and WAV emission all stay the same.

### Implementation

#### Step 1: Add VAD init to `SttState`

**File: `src-tauri/src/stt.rs`**

Add `vad_ready: bool` to `SttInner`:
```rust
pub struct SttInner {
    #[cfg(target_os = "macos")]
    audio: Option<FluidAudio>,
    asr_ready: bool,
    vad_ready: bool,  // NEW
}
```

Add `init_vad` method:
```rust
#[cfg(target_os = "macos")]
fn init_vad_inner(inner: Arc<Mutex<SttInner>>, threshold: f32) -> Result<(), String> {
    let mut guard = inner.lock().map_err(|e| e.to_string())?;
    if guard.vad_ready {
        return Ok(());
    }
    let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
    audio.init_vad(threshold).map_err(|e| e.to_string())?;
    guard.vad_ready = true;
    Ok(())
}
```

Add Tauri command:
```rust
#[tauri::command]
pub async fn stt_init_vad(
    state: State<'_, SttState>,
    threshold: f32,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let inner = state.inner.clone();
        tokio::task::spawn_blocking(move || SttState::init_vad_inner(inner, threshold))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    Ok(())
}
```

Add `vad_process_samples` method:
```rust
#[cfg(target_os = "macos")]
pub fn vad_process_samples(&self, samples: &[f32]) -> Result<Vec<fluidaudio_rs::VadFrame>, String> {
    let guard = self.inner.lock().map_err(|e| e.to_string())?;
    if !guard.vad_ready {
        return Err("VAD not initialized".to_string());
    }
    let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
    audio.vad_process_samples(samples).map_err(|e| e.to_string())
}
```

#### Step 2: Use Silero VAD in capture loop

**File: `src-tauri/src/speaker/commands.rs`**

The current loop processes 1024-sample chunks. Silero processes 4096-sample chunks. Two approaches:

**Approach 1 (simpler): Accumulate to 4096, then VAD**
- Keep the 1024-sample hop for buffer processing
- Accumulate 4 × 1024 = 4096 samples before calling Silero
- Use Silero's `is_voice_active` as the speech decision
- Buffer management (pre-speech, silence tracking) stays the same

**Approach 2: Keep 1024 hop, pad to 4096 for Silero**
- Keep the 1024-sample hop
- Zero-pad to 4096 for each Silero call
- Wastes compute but simpler buffer management

**Recommendation: Approach 1.** Accumulate 4 hop chunks, then VAD. More efficient, matches Silero's design.

Replace lines 181-182:
```rust
// OLD: threshold-based VAD
let (rms, peak) = calculate_audio_metrics(&mono);
let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;
```

With:
```rust
// NEW: Silero VAD
let is_speech = if let Some(stt_state) = app.try_state::<SttState>() {
    match stt_state.vad_process_samples(&mono) {
        Ok(frames) => frames.iter().any(|f| f.is_voice_active),
        Err(_) => {
            // Fallback to threshold VAD if Silero fails
            let (rms, peak) = calculate_audio_metrics(&mono);
            rms > config.sensitivity_rms || peak > config.peak_threshold
        }
    }
} else {
    // Fallback if SttState not available (non-macOS or not initialized)
    let (rms, peak) = calculate_audio_metrics(&mono);
    rms > config.sensitivity_rms || peak > config.peak_threshold
};
```

**Key design decision: keep the fallback.** If Silero isn't initialized (non-macOS, Intel Mac, init failed), the old RMS/peak VAD still works. This means `local-whisper` on Windows/Linux still uses the threshold VAD. The Silero VAD only activates when `local-fluidaudio` is the provider and VAD has been initialized.

#### Step 3: Initialize VAD in `startCapture`

**File: `src/hooks/useSystemAudio.ts`**

In `startCapture()`, after ASR init, also init VAD for local-fluidaudio:
```typescript
if (selectedSttProvider.provider === "local-fluidaudio") {
    // ... existing ASR init ...
    
    // Initialize Silero VAD
    try {
        await invoke("stt_init_vad", { threshold: 0.85 });
    } catch (err) {
        console.warn("Silero VAD init failed, falling back to threshold VAD:", err);
    }
}
```

#### Step 4: Add `vad_ready` to `stt_get_status`

**File: `src-tauri/src/stt.rs`**

Add `vad_ready` to the status response:
```rust
Ok(serde_json::json!({
    "asr_ready": guard.asr_ready,
    "vad_ready": guard.vad_ready,
    "is_apple_silicon": is_apple_silicon,
    "is_intel": is_intel,
    "is_supported": is_apple_silicon && !is_intel,
}))
```

### Files to modify (VAD)
| File | Change |
|------|--------|
| `src-tauri/src/stt.rs` | Add `vad_ready` field, `init_vad_inner`, `vad_process_samples`, `stt_init_vad` command, add `vad_ready` to status |
| `src-tauri/src/lib.rs` | Register `stt::stt_init_vad` in `invoke_handler![]` |
| `src-tauri/src/speaker/commands.rs` | Replace threshold VAD with Silero call (with fallback) |
| `src/hooks/useSystemAudio.ts` | Call `stt_init_vad` in `startCapture()` for local-fluidaudio |

### VAD chunk size handling

Silero processes in 4096-sample (256ms at 16kHz) chunks. The current VAD uses 1024-sample (64ms) chunks. To match:
- Accumulate 4 × 1024-sample chunks before calling `vad_process_samples`
- OR change `hop_size` to 4096 for local-fluidaudio
- OR zero-pad 1024 to 4096

**Recommendation:** Change the accumulation logic. Keep `hop_size: 1024` for buffer management, but accumulate 4 chunks before calling Silero. This preserves the existing pre-speech buffer and silence tracking granularity while matching Silero's expected input size.

### Verification (VAD)
- `cargo check` + `npx tsc --noEmit` + `npm run build` all green
- Test: type on keyboard during capture → no false speech detection
- Test: speak quietly → speech detected
- Test: play music in background → no false speech detection
- Test: non-macOS or Intel Mac → fallback to threshold VAD works

---

## Part C: Speaker Diarization — feature branch

### Goal
After a capture session ends, run speaker diarization on the full session audio to identify who spoke when. Display speaker labels in the transcript.

### Architecture challenge

fluidaudio-rs exposes `diarize_file(path)` — an **offline** API that takes a file path, not samples. It returns `Vec<DiarizationSegment>` with `speaker_id`, `start_time`, `end_time`. There is no streaming/real-time diarization in the Rust API.

This means diarization must happen **after the capture session**, not during it. The flow:
1. During capture: accumulate full audio to a temp file
2. On `stopCapture`: run `diarize_file` on the temp file
3. Correlate diarization timestamps with ASR utterance timestamps
4. Label each transcription with its speaker
5. Display in UI with speaker labels

### Implementation

#### Step 1: Add diarization to `SttState`

**File: `src-tauri/src/stt.rs`**

Add `diarization_ready: bool` to `SttInner`:
```rust
pub struct SttInner {
    #[cfg(target_os = "macos")]
    audio: Option<FluidAudio>,
    asr_ready: bool,
    vad_ready: bool,
    diarization_ready: bool,  // NEW
}
```

Add `init_diarization` method (same pattern as `init_vad`):
```rust
#[cfg(target_os = "macos")]
fn init_diarization_inner(inner: Arc<Mutex<SttInner>>, threshold: f64) -> Result<(), String> {
    let mut guard = inner.lock().map_err(|e| e.to_string())?;
    if guard.diarization_ready {
        return Ok(());
    }
    let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
    audio.init_diarization(threshold).map_err(|e| e.to_string())?;
    guard.diarization_ready = true;
    Ok(())
}
```

Add `diarize_file` method:
```rust
#[cfg(target_os = "macos")]
pub fn diarize_file(&self, path: &str) -> Result<Vec<fluidaudio_rs::DiarizationSegment>, String> {
    let guard = self.inner.lock().map_err(|e| e.to_string())?;
    if !guard.diarization_ready {
        return Err("Diarization not initialized".to_string());
    }
    let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
    audio.diarize_file(path).map_err(|e| e.to_string())
}
```

Add Tauri command:
```rust
#[tauri::command]
pub async fn stt_diarize_file(
    path: String,
    state: State<'_, SttState>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let inner = state.inner.clone();
        tokio::task::spawn_blocking(move || {
            let state = SttState { inner };
            state.diarize_file(&path)
        })
        .await
        .map_err(|e| e.to_string())?
        .map(|segments| {
            serde_json::json!(segments.iter().map(|s| {
                serde_json::json!({
                    "speaker_id": s.speaker_id,
                    "start_time": s.start_time,
                    "end_time": s.end_time,
                })
            }).collect::<Vec<_>>())
        })
    }
    #[cfg(not(target_os = "macos"))]
    Ok(serde_json::json!([]))
}
```

#### Step 2: Accumulate full session audio

**File: `src-tauri/src/speaker/commands.rs`**

During `run_vad_capture`, in addition to per-utterance buffers, accumulate ALL audio to a session-level buffer:
```rust
let mut session_audio: Vec<f32> = Vec::new();
let session_start = Instant::now();
```

Append every `mono` chunk to `session_audio`. On capture stop, write `session_audio` to a temp WAV file:
```rust
fn write_session_wav(path: &str, sample_rate: u32, samples: &[f32]) -> Result<(), String> {
    // Use hound to write WAV
    let spec = WavSpec { channels: 1, sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut writer = WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        writer.write_sample((clamped * i16::MAX as f32) as i16).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(())
}
```

Emit a new event `capture-stopped-with-audio` with the temp file path:
```rust
let _ = app.emit("capture-stopped-with-audio", json!({
    "path": temp_path,
    "sample_rate": sr,
    "duration_seconds": session_start.elapsed().as_secs_f32(),
}));
```

#### Step 3: Track utterance timestamps

**File: `src-tauri/src/speaker/commands.rs`**

For each `speech-detected` event, include the start/end timestamps relative to session start:
```rust
let utterance_start = utterance_start_time - session_start_time;
let utterance_end = utterance_end_time - session_start_time;
let _ = app.emit("speech-detected", json!({
    "audio": b64,
    "start_time": utterance_start,
    "end_time": utterance_end,
}));
```

The frontend stores these timestamps alongside each transcription.

#### Step 4: Run diarization on stop

**File: `src/hooks/useSystemAudio.ts`**

In `stopCapture()`, after stopping capture, listen for `capture-stopped-with-audio` and run diarization:
```typescript
const stopCapture = useCallback(async () => {
    // ... existing stop logic ...
    
    // If local-fluidaudio, run diarization
    if (selectedSttProvider.provider === "local-fluidaudio") {
        try {
            const sessionInfo = await listen("capture-stopped-with-audio", async (event) => {
                const { path, sample_rate, duration_seconds } = event.payload;
                const segments = await invoke<Array<{
                    speaker_id: string;
                    start_time: number;
                    end_time: number;
                }>>("stt_diarize_file", { path });
                
                // Correlate with utterance timestamps
                // Label each transcription with speaker
                setSpeakerSegments(segments);
            });
        } catch (err) {
            console.warn("Diarization failed:", err);
        }
    }
}, []);
```

#### Step 5: Display speaker labels in UI

**File: `src/pages/app/components/speech/ResultsSection.tsx`**

Show speaker labels next to each transcription:
```tsx
{conversation.messages.map((msg) => {
    const speaker = getSpeakerForMessage(msg);
    return (
        <div key={msg.id}>
            <span className="text-xs font-medium text-muted-foreground">
                {speaker || "Unknown"}
            </span>
            <p>{msg.content}</p>
        </div>
    );
})}
```

**File: `src/hooks/useSystemAudio.ts`**

Add `speakerSegments` state and a helper to look up which speaker was talking during an utterance:
```typescript
const [speakerSegments, setSpeakerSegments] = useState<Array<{
    speaker_id: string;
    start_time: number;
    end_time: number;
}>>([]);

const getSpeakerForUtterance = (startTime: number, endTime: number) => {
    // Find the speaker segment that overlaps most with this utterance
    let bestSpeaker = null;
    let bestOverlap = 0;
    for (const seg of speakerSegments) {
        const overlap = Math.min(endTime, seg.end_time) - Math.max(startTime, seg.start_time);
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestSpeaker = seg.speaker_id;
        }
    }
    return bestSpeaker;
};
```

#### Step 6: Init diarization in `startCapture`

**File: `src/hooks/useSystemAudio.ts`**

```typescript
if (selectedSttProvider.provider === "local-fluidaudio") {
    // ... existing ASR + VAD init ...
    
    try {
        await invoke("stt_init_vad", { threshold: 0.85 });
        await invoke("stt_init_diarization", { threshold: 0.6 });
    } catch (err) {
        console.warn("Diarization init failed:", err);
    }
}
```

### Files to modify (diarization)
| File | Change |
|------|--------|
| `src-tauri/src/stt.rs` | Add `diarization_ready`, `init_diarization_inner`, `diarize_file`, `stt_init_diarization` + `stt_diarize_file` commands |
| `src-tauri/src/lib.rs` | Register `stt::stt_init_diarization` and `stt::stt_diarize_file` in `invoke_handler![]` |
| `src-tauri/src/speaker/commands.rs` | Accumulate session audio, write temp WAV on stop, emit timestamps with utterances |
| `src/hooks/useSystemAudio.ts` | Run diarization on stop, track speaker segments, label utterances |
| `src/pages/app/components/speech/ResultsSection.tsx` | Display speaker labels in transcript |

### Diarization model download

`init_diarization` downloads a separate model (~100-200MB) on first call. This adds to the first-run init time (currently ASR is ~500MB / 20-30s). With VAD + diarization, total first-run init could be 30-40s. The `SttInitOverlay` should be updated to show "Preparing speech models..." instead of "Preparing speech model...".

### Verification (diarization)
- `cargo check` + `npx tsc --noEmit` + `npm run build` all green
- Test: capture a conversation with two people → speaker labels appear
- Test: single speaker → all utterances labeled as same speaker
- Test: diarization init fails → app still works without labels
- Test: non-macOS → no diarization, no errors

---

## Build sequence

### Phase 1: ITN (all branches)
- [ ] Add ITN call in `stt.rs:transcribe_samples()`
- [ ] `cargo check` passes
- [ ] Test: spoken numbers/symbols normalize correctly
- [ ] Commit to `dev`, push to `dev`, cherry-pick to `feat/fluidaudio-rs` and `main`

### Phase 2: Silero VAD (feature branch)
- [ ] Create `feat/fluidaudio-vad-diarization` from `dev`
- [ ] Add `vad_ready`, `init_vad_inner`, `vad_process_samples` to `stt.rs`
- [ ] Add `stt_init_vad` command, register in `lib.rs`
- [ ] Replace threshold VAD with Silero in `commands.rs` (with fallback)
- [ ] Call `stt_init_vad` in `startCapture`
- [ ] Handle chunk size mismatch (accumulate 4×1024 → 4096)
- [ ] `cargo check` + `tsc` + `build` all green
- [ ] Test: false triggers reduced, quiet speech detected
- [ ] Commit and push

### Phase 3: Speaker diarization (feature branch)
- [ ] Add `diarization_ready`, `init_diarization_inner`, `diarize_file` to `stt.rs`
- [ ] Add `stt_init_diarization` + `stt_diarize_file` commands, register in `lib.rs`
- [ ] Accumulate session audio in `run_vad_capture`
- [ ] Write session WAV to temp file on stop
- [ ] Track utterance timestamps relative to session start
- [ ] Run diarization on stop in frontend
- [ ] Correlate speaker segments with utterance timestamps
- [ ] Display speaker labels in `ResultsSection.tsx`
- [ ] Update `SttInitOverlay` text for multiple models
- [ ] `cargo check` + `tsc` + `build` all green
- [ ] Test: two-speaker conversation → correct labels
- [ ] Commit and push

### Phase 4: Merge
- [ ] Merge `feat/fluidaudio-vad-diarization` into `dev`
- [ ] Test on `dev`
- [ ] Promote to `main`

---

## Critical details

### Silero VAD chunk size
Silero processes in 4096-sample chunks (256ms at 16kHz). The current VAD uses 1024-sample chunks (64ms). The capture loop must either:
- Accumulate 4×1024 before calling Silero (recommended)
- Change `hop_size` to 4096 (affects pre-speech buffer granularity)
- Zero-pad (wasteful)

### Diarization is post-capture only
fluidaudio-rs only exposes `diarize_file(path)` — offline processing. There's no streaming diarization in the Rust API. This means:
- Speaker labels appear **after** the capture session ends, not live
- The user sees unlabeled transcriptions during capture, then labels appear on stop
- A "Processing speaker labels..." indicator should show during diarization

### Diarization temp file
The session WAV file should be written to a temp directory and cleaned up after diarization:
```rust
let temp_dir = std::env::temp_dir();
let temp_path = temp_dir.join(format!("assistant-session-{}.wav", uuid::Uuid::new_v4()));
```
Clean up after diarization completes or on app exit.

### Fallback strategy
- If Silero VAD init fails → fall back to threshold VAD (already implemented in the code)
- If diarization init fails → skip speaker labels, show unlabeled transcriptions
- If diarization processing fails → show unlabeled transcriptions, log error
- Non-macOS or Intel Mac → no Silero VAD, no diarization, threshold VAD + unlabeled transcriptions

### Model download timing
| Model | Size | First-run time |
|-------|------|----------------|
| ASR (Parakeet TDT v3) | ~500MB | 20-30s |
| VAD (Silero) | ~10MB | 2-5s |
| Diarization | ~100-200MB | 5-15s |
| **Total first-run** | **~610-710MB** | **27-50s** |

The `SttInitOverlay` should show "Preparing speech models..." and the overlay should remain until all three are ready.

### Utterance timestamp tracking
To correlate diarization with utterances, each `speech-detected` event must include the utterance's start/end time relative to the session start. This requires:
- Recording `session_start_time: Instant` at capture start
- For each utterance, tracking `utterance_start` and `utterance_end` as `session_start_time.elapsed()` at speech-start and speech-end
- Including these in the `speech-detected` payload