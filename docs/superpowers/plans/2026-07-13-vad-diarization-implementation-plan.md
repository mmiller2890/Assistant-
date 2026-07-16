# Silero VAD and Speaker Diarization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the threshold-based VAD with FluidAudio's Silero VAD for `local-fluidaudio`, and add offline speaker diarization that labels transcript turns after a capture session ends.

**Architecture:** Extend `SttState` with `vad_ready` and `diarization_ready`, expose three new Tauri commands (`stt_init_vad`, `stt_init_diarization`, `stt_diarize_file`), and update the capture loop to use Silero decisions while accumulating session audio to a capped temp WAV. The frontend initializes VAD/diarization on capture start, correlates returned speaker segments with utterance timestamps, and renders speaker labels in `ResultsSection`.

**Tech Stack:** Rust, Tauri 2, fluidaudio-rs 0.14.1, TypeScript, React.

---

## Branch setup

**Files:**
- Branch from: `dev`
- Create: `feat/fluidaudio-vad-diarization`

- [ ] **Step 1: Create and switch to the feature branch**

  ```bash
  git checkout dev
  git pull origin dev
  git checkout -b feat/fluidaudio-vad-diarization
  ```

---

## Task 1: Extend SttState for VAD and diarization

**Files:**
- Modify: `src-tauri/src/stt.rs`

- [ ] **Step 1: Add `vad_ready` and `diarization_ready` to `SttInner`**

  Change:
  ```rust
  pub struct SttInner {
      #[cfg(target_os = "macos")]
      audio: Option<FluidAudio>,
      asr_ready: bool,
  }
  ```
  to:
  ```rust
  pub struct SttInner {
      #[cfg(target_os = "macos")]
      audio: Option<FluidAudio>,
      asr_ready: bool,
      vad_ready: bool,
      diarization_ready: bool,
      #[cfg(target_os = "macos")]
      session_wav_path: Option<std::path::PathBuf>,
  }
  ```

- [ ] **Step 2: Update `Default` impl for `SttInner`**

  Change:
  ```rust
  impl Default for SttInner {
      fn default() -> Self {
          Self {
              #[cfg(target_os = "macos")]
              audio: None,
              asr_ready: false,
          }
      }
  }
  ```
  to:
  ```rust
  impl Default for SttInner {
      fn default() -> Self {
          Self {
              #[cfg(target_os = "macos")]
              audio: None,
              asr_ready: false,
              vad_ready: false,
              diarization_ready: false,
              #[cfg(target_os = "macos")]
              session_wav_path: None,
          }
      }
  }
  ```

- [ ] **Step 3: Add `init_vad_inner`**

  After `init_asr_inner`, add:
  ```rust
  #[cfg(target_os = "macos")]
  fn init_vad_inner(
      inner: Arc<Mutex<SttInner>>,
      app: AppHandle,
      threshold: f32,
  ) -> Result<(), String> {
      let mut guard = inner.lock().map_err(|e| e.to_string())?;
      if guard.vad_ready {
          return Ok(());
      }
      let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
      if let Err(e) = audio.init_vad(threshold) {
          emit_error(&app, format!("Failed to initialize VAD: {}", e));
          return Err(e);
      }
      guard.vad_ready = true;
      Ok(())
  }
  ```

- [ ] **Step 4: Add `init_diarization_inner`**

  After `init_vad_inner`, add:
  ```rust
  #[cfg(target_os = "macos")]
  fn init_diarization_inner(
      inner: Arc<Mutex<SttInner>>,
      app: AppHandle,
      threshold: f64,
  ) -> Result<(), String> {
      let mut guard = inner.lock().map_err(|e| e.to_string())?;
      if guard.diarization_ready {
          return Ok(());
      }
      let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
      if let Err(e) = audio.init_diarization(threshold) {
          emit_error(&app, format!("Failed to initialize diarization: {}", e));
          return Err(e);
      }
      guard.diarization_ready = true;
      Ok(())
  }
  ```

- [ ] **Step 5: Add `vad_process_samples` and `diarize_file` methods to `SttState`**

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

- [ ] **Step 6: Add session WAV path helpers**

  ```rust
  #[cfg(target_os = "macos")]
  pub fn set_session_wav_path(&self, path: std::path::PathBuf) -> Result<(), String> {
      let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
      guard.session_wav_path = Some(path);
      Ok(())
  }

  #[cfg(target_os = "macos")]
  pub fn take_session_wav_path(&self) -> Option<std::path::PathBuf> {
      let mut guard = self.inner.lock().ok()?;
      guard.session_wav_path.take()
  }
  ```

---

## Task 2: Add Tauri commands for VAD and diarization

**Files:**
- Modify: `src-tauri/src/stt.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `stt_init_vad` command**

  Append to `src-tauri/src/stt.rs`:
  ```rust
  #[tauri::command]
  pub async fn stt_init_vad(
      state: State<'_, SttState>,
      app: AppHandle,
      threshold: f32,
  ) -> Result<(), String> {
      #[cfg(not(target_os = "macos"))]
      return Ok(());

      #[cfg(target_os = "macos")]
      {
          let inner = state.inner.clone();
          tokio::task::spawn_blocking(move || SttState::init_vad_inner(inner, app, threshold))
              .await
              .map_err(|e| e.to_string())?
      }
  }
  ```

- [ ] **Step 2: Add `stt_init_diarization` command**

  Append to `src-tauri/src/stt.rs`:
  ```rust
  #[tauri::command]
  pub async fn stt_init_diarization(
      state: State<'_, SttState>,
      app: AppHandle,
      threshold: f64,
  ) -> Result<(), String> {
      #[cfg(not(target_os = "macos"))]
      return Ok(());

      #[cfg(target_os = "macos")]
      {
          let inner = state.inner.clone();
          tokio::task::spawn_blocking(move || SttState::init_diarization_inner(inner, app, threshold))
              .await
              .map_err(|e| e.to_string())?
      }
  }
  ```

- [ ] **Step 3: Add `stt_diarize_file` command**

  Append to `src-tauri/src/stt.rs`:
  ```rust
  #[tauri::command]
  pub async fn stt_diarize_file(
      state: State<'_, SttState>,
      path: String,
  ) -> Result<serde_json::Value, String> {
      #[cfg(not(target_os = "macos"))]
      return Ok(serde_json::json!([]));

      #[cfg(target_os = "macos")]
      {
          let inner = state.inner.clone();
          let segments = tokio::task::spawn_blocking(move || {
              let state = SttState { inner };
              state.diarize_file(&path)
          })
          .await
          .map_err(|e| e.to_string())??;

          // Clean up temp file after diarization finishes
          let _ = std::fs::remove_file(&path);

          Ok(serde_json::json!(segments.iter().map(|s| {
              serde_json::json!({
                  "speaker_id": s.speaker_id,
                  "start_time": s.start_time,
                  "end_time": s.end_time,
              })
          }).collect::<Vec<_>>()))
      }
  }
  ```

- [ ] **Step 4: Update `stt_get_status` to include VAD/diarization readiness**

  Change the non-macOS branch to:
  ```rust
  return Ok(serde_json::json!({
      "asr_ready": false,
      "vad_ready": false,
      "diarization_ready": false,
      "is_apple_silicon": false,
      "is_intel": false,
      "is_supported": false,
  }));
  ```

  Change the macOS branch return to:
  ```rust
  Ok(serde_json::json!({
      "asr_ready": guard.asr_ready,
      "vad_ready": guard.vad_ready,
      "diarization_ready": guard.diarization_ready,
      "is_apple_silicon": is_apple_silicon,
      "is_intel": is_intel,
      "is_supported": is_apple_silicon && !is_intel,
  }))
  ```

- [ ] **Step 5: Register commands in `src-tauri/src/lib.rs`**

  Add to `invoke_handler`:
  ```rust
  stt::stt_init_vad,
  stt::stt_init_diarization,
  stt::stt_diarize_file,
  ```

---

## Task 3: Update the VAD capture loop for Silero VAD

**Files:**
- Modify: `src-tauri/src/speaker/commands.rs`

### Background

`run_vad_capture` currently decides speech every 1024 samples using RMS/peak. Silero VAD from fluidaudio-rs processes 4096-sample (256 ms) chunks and returns `Vec<VadFrame>`. We accumulate 4 × 1024-sample hops, run Silero once, and use the result as the speech decision for the next 4 iterations. The pre-speech buffer, silence tracking, and WAV emission remain unchanged. If Silero is unavailable, we fall back to the existing threshold check.

We also accumulate the full session audio to a capped `Vec<f32>` so it can be written to a temp WAV at the end for diarization. The cap equals `max_recording_duration_secs` to bound memory.

The `speech-detected` event payload changes from a plain base64 string to:
```json
{
  "audio": "base64 WAV",
  "start_time": 1.25,
  "end_time": 4.80
}
```
`start_time` and `end_time` are seconds relative to the session start. Non-diarization providers ignore the timestamps.

- [ ] **Step 1: Add helper to detect whether Silero VAD should be active**

  Near the top of `src-tauri/src/speaker/commands.rs`, add:
  ```rust
  fn get_silero_vad_decision(
      app: &AppHandle,
      samples: &[f32],
  ) -> Option<bool> {
      #[cfg(target_os = "macos")]
      {
          if let Some(stt_state) = app.try_state::<crate::stt::SttState>() {
              if let Ok(frames) = stt_state.vad_process_samples(samples) {
                  return Some(frames.iter().any(|f| f.is_voice_active));
              }
          }
      }
      None
  }
  ```

- [ ] **Step 2: Modify `run_vad_capture` signature and state**

  Change:
  ```rust
  async fn run_vad_capture(
      app: AppHandle,
      stream: impl StreamExt<Item = f32> + Unpin,
      sr: u32,
      config: VadConfig,
  )
  ```
  (signature stays the same, but add local variables inside.)

  Add at the top of the function body, after `let mut stream = stream;`:
  ```rust
  let session_start = Instant::now();
  let max_session_samples = (sr as usize * config.max_recording_duration_secs as usize).min(sr as usize * 3600);
  let mut session_audio: Vec<f32> = Vec::with_capacity(max_session_samples);
  let mut vad_accumulator: Vec<f32> = Vec::with_capacity(4096);
  let mut pending_silero_decision: Option<bool> = None;
  let mut utterance_start_time: f32 = 0.0;
  ```

- [ ] **Step 3: Accumulate session audio per chunk**

  Inside the main loop, after extracting `mono` from the buffer, append to session audio:
  ```rust
  if session_audio.len() + mono.len() <= max_session_samples {
      session_audio.extend_from_slice(&mono);
  }
  ```

- [ ] **Step 4: Accumulate into Silero VAD buffer and compute decision**

  Replace:
  ```rust
  let (rms, peak) = calculate_audio_metrics(&mono);
  let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;
  ```
  with:
  ```rust
  // Silero VAD processes 4096-sample chunks; accumulate 4 hops.
  vad_accumulator.extend_from_slice(&mono);
  if vad_accumulator.len() >= 4096 {
      let chunk: Vec<f32> = vad_accumulator.drain(..4096).collect();
      pending_silero_decision = get_silero_vad_decision(&app, &chunk);
  }

  let is_speech = pending_silero_decision.unwrap_or_else(|| {
      // Fallback to threshold VAD
      let (rms, peak) = calculate_audio_metrics(&mono);
      rms > config.sensitivity_rms || peak > config.peak_threshold
  });
  ```

  This means the speech decision updates every 256 ms while silence tracking still runs at 64 ms granularity.

- [ ] **Step 5: Track utterance timestamps**

  At speech start (inside `if is_speech { if !in_speech { ... }}`):
  ```rust
  utterance_start_time = session_start.elapsed().as_secs_f32();
  ```

  At speech end (inside the silence handling where the utterance is emitted), capture the end time before normalizing:
  ```rust
  let utterance_end_time = session_start.elapsed().as_secs_f32();
  ```

- [ ] **Step 6: Change `speech-detected` payload to include timestamps**

  Find both places in `run_vad_capture` that emit `speech-detected` (the safety cap and the silence-end branches). Change:
  ```rust
  let _ = app.emit("speech-detected", b64);
  ```
  to:
  ```rust
  let _ = app.emit("speech-detected", serde_json::json!({
      "audio": b64,
      "start_time": utterance_start_time,
      "end_time": utterance_end_time,
  }));
  ```

  Also update the trailing-utterance emission at the end of `run_vad_capture` similarly.

- [ ] **Step 7: Write session WAV and emit stop event when capture ends**

  After the main `while let Some(sample) = stream.next().await` loop ends (and before the trailing-utterance flush), write the accumulated session audio to a temp file and emit the new event:
  ```rust
  // Write session WAV for diarization
  if !session_audio.is_empty() {
      let temp_dir = std::env::temp_dir();
      let temp_path = temp_dir.join(format!("assistant-session-{}.wav", uuid::Uuid::new_v4()));
      if let Err(e) = write_f32_samples_to_wav(sr, &session_audio, &temp_path) {
          error!("Failed to write session WAV: {}", e);
      } else {
          let path_str = temp_path.to_string_lossy().to_string();
          if let Some(stt_state) = app.try_state::<crate::stt::SttState>() {
              let _ = stt_state.set_session_wav_path(temp_path.clone());
          }
          let _ = app.emit("capture-stopped-with-audio", serde_json::json!({
              "path": path_str,
              "sample_rate": sr,
              "duration_seconds": session_start.elapsed().as_secs_f32(),
          }));
      }
  }
  ```

- [ ] **Step 8: Add `write_f32_samples_to_wav` helper**

  Add near the existing `samples_to_wav_b64`:
  ```rust
  fn write_f32_samples_to_wav(
      sample_rate: u32,
      samples: &[f32],
      path: &std::path::Path,
  ) -> Result<(), String> {
      let spec = WavSpec {
          channels: 1,
          sample_rate,
          bits_per_sample: 16,
          sample_format: hound::SampleFormat::Int,
      };
      let mut writer = WavWriter::create(path, spec).map_err(|e| e.to_string())?;
      for &s in samples {
          let clamped = s.clamp(-1.0, 1.0);
          writer.write_sample((clamped * i16::MAX as f32) as i16)
              .map_err(|e| e.to_string())?;
      }
      writer.finalize().map_err(|e| e.to_string())?;
      Ok(())
  }
  ```

- [ ] **Step 9: Clean up the temp WAV on app cleanup / Drop**

  In `src-tauri/src/stt.rs`, implement `Drop` for `SttState` that deletes any remaining `session_wav_path`:
  ```rust
  impl Drop for SttState {
      fn drop(&mut self) {
          if let Ok(guard) = self.inner.lock() {
              if let Some(path) = guard.session_wav_path.as_ref() {
                  let _ = std::fs::remove_file(path);
              }
          }
      }
  }
  ```

- [ ] **Step 10: Disable diarization for continuous mode**

  In `run_continuous_capture`, do **not** change the behavior. Continuous mode has no utterance segmentation, so no speaker labels are produced. The existing continuous mode behavior remains unchanged.

---

## Task 4: Update the frontend to initialize VAD/diarization and handle new payload

**Files:**
- Modify: `src/hooks/useSystemAudio.ts`
- Modify: `src/hooks/useSttStatus.ts`
- Modify: `src/components/SttInitOverlay.tsx`

- [ ] **Step 1: Extend `useSttStatus` status type and refresh**

  Change `SttStatus` interface to:
  ```typescript
  export interface SttStatus {
    asrReady: boolean;
    vadReady: boolean;
    diarizationReady: boolean;
    isSupported: boolean;
    isInitializing: boolean;
    error: string | null;
  }
  ```

  Update default state to include the new fields as `false`.

  Update `refresh` to read and set them:
  ```typescript
  const result = await invoke<{
    asr_ready: boolean;
    vad_ready: boolean;
    diarization_ready: boolean;
    is_supported: boolean;
  }>("stt_get_status");
  setStatus((prev) => ({
    ...prev,
    asrReady: result.asr_ready,
    vadReady: result.vad_ready,
    diarizationReady: result.diarization_ready,
    isSupported: result.is_supported,
    error: null,
  }));
  ```

- [ ] **Step 2: Call `stt_init_vad` and `stt_init_diarization` in `startCapture`**

  After the existing ASR init block in `startCapture` (around line 727), add:
  ```typescript
  if (selectedSttProvider.provider === "local-fluidaudio") {
      try {
          await invoke("stt_init_vad", { threshold: 0.85 });
      } catch (err) {
          console.warn("Silero VAD init failed, falling back to threshold VAD:", err);
      }
      try {
          await invoke("stt_init_diarization", { threshold: 0.6 });
      } catch (err) {
          console.warn("Diarization init failed:", err);
      }
  }
  ```

- [ ] **Step 3: Update the `speech-detected` handler to parse the new payload**

  Change:
  ```typescript
  speechUnlisten = await listen("speech-detected", async (event) => {
      try {
          if (!capturingRef.current) return;
          ...
          const base64Audio = event.payload as string;
          ...
      }
  });
  ```
  to:
  ```typescript
  speechUnlisten = await listen("speech-detected", async (event) => {
      try {
          if (!capturingRef.current) return;

          if (streamingFinalizedRef.current) {
              streamingFinalizedRef.current = false;
              closeStreamingSocket();
              return;
          }

          closeStreamingSocket();
          batchProcessedForCurrentUtteranceRef.current = true;

          const payload = event.payload as {
              audio: string;
              start_time: number;
              end_time: number;
          };

          const base64Audio = payload.audio;
          if (!base64Audio || base64Audio.length < 100) {
              return;
          }

          // Store utterance timestamp for diarization correlation
          utteranceTimestampsRef.current.push({
              start: payload.start_time,
              end: payload.end_time,
          });

          ... // rest of the handler unchanged
      }
  });
  ```

- [ ] **Step 4: Add `utteranceTimestampsRef`**

  Near the other refs (around line 124), add:
  ```typescript
  const utteranceTimestampsRef = useRef<Array<{ start: number; end: number }>>([]);
  ```

  Reset it in `stopCapture` alongside other refs:
  ```typescript
  utteranceTimestampsRef.current = [];
  ```

  Also reset it at capture start:
  ```typescript
  utteranceTimestampsRef.current = [];
  ```

- [ ] **Step 5: Run diarization when capture stops**

  In `stopCapture`, after `await invoke<string>("stop_system_audio_capture");`, add:
  ```typescript
  if (selectedSttProvider.provider === "local-fluidaudio") {
      let unlisten: (() => void) | undefined;
      try {
          unlisten = await listen("capture-stopped-with-audio", async (event) => {
              const { path } = event.payload as {
                  path: string;
                  sample_rate: number;
                  duration_seconds: number;
              };
              try {
                  const segments = await invoke<Array<{
                      speaker_id: string;
                      start_time: number;
                      end_time: number;
                  }>>("stt_diarize_file", { path });
                  setSpeakerSegments(segments);
                  // Apply labels to existing conversation messages
                  labelMessagesWithSpeakers(segments, utteranceTimestampsRef.current);
              } catch (err) {
                  console.warn("Diarization failed:", err);
              } finally {
                  unlisten?.();
              }
          });
      } catch (err) {
          console.warn("Failed to listen for capture-stopped-with-audio:", err);
      }
  }
  ```

- [ ] **Step 6: Add speaker state and helper functions**

  Add state:
  ```typescript
  const [speakerSegments, setSpeakerSegments] = useState<Array<{
      speaker_id: string;
      start_time: number;
      end_time: number;
  }>>([]);
  ```

  Add helper (inside `useSystemAudio`):
  ```typescript
  const getSpeakerForUtterance = useCallback((
      startTime: number,
      endTime: number,
      segments: Array<{ speaker_id: string; start_time: number; end_time: number }>
  ): string | null => {
      let bestSpeaker: string | null = null;
      let bestOverlap = 0;
      for (const seg of segments) {
          const overlap = Math.min(endTime, seg.end_time) - Math.max(startTime, seg.start_time);
          if (overlap > bestOverlap) {
              bestOverlap = overlap;
              bestSpeaker = seg.speaker_id;
          }
      }
      return bestSpeaker;
  }, []);
  ```

  Add `labelMessagesWithSpeakers`:
  ```typescript
  const labelMessagesWithSpeakers = useCallback((
      segments: Array<{ speaker_id: string; start_time: number; end_time: number }>,
      timestamps: Array<{ start: number; end: number }>
  ) => {
      setConversation((prev) => {
          const updated = [...prev.messages];
          timestamps.forEach((ts, index) => {
              // User messages are added in pairs: user at index 0, assistant at index 1
              const userMsgIndex = updated.length - 1 - (index * 2);
              if (userMsgIndex >= 0 && updated[userMsgIndex]?.role === "user") {
                  const speaker = getSpeakerForUtterance(ts.start, ts.end, segments);
                  if (speaker) {
                      updated[userMsgIndex] = {
                          ...updated[userMsgIndex],
                          speaker,
                      };
                  }
              }
          });
          return { ...prev, messages: updated };
      });
  }, [getSpeakerForUtterance]);
  ```

- [ ] **Step 7: Update `SttInitOverlay` copy**

  Change `src/components/SttInitOverlay.tsx`:
  ```tsx
  <p className="text-sm font-medium">Preparing local speech models</p>
  <p className="text-xs text-muted-foreground mt-1">
    First run may take 20–50 seconds
  </p>
  ```

---

## Task 5: Display speaker labels in ResultsSection

**Files:**
- Modify: `src/types/completion.ts`
- Modify: `src/pages/app/components/speech/ResultsSection.tsx`
- Modify: `src/pages/app/components/speech/index.tsx`

- [ ] **Step 1: Add optional `speaker` field to `ChatMessage`**

  In `src/types/completion.ts`:
  ```typescript
  export interface ChatMessage {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    speaker?: string;
    attachedFiles?: AttachedFile[];
  }
  ```

- [ ] **Step 2: Add speaker props to `ResultsSection`**

  Update the `Props` type:
  ```typescript
  type Props = {
    lastTranscription: string;
    lastAIResponse: string;
    isAIProcessing: boolean;
    conversation: ChatConversation;
    conversationMode: boolean;
    setConversationMode: (mode: boolean) => void;
    partialTranscription?: string;
    isStreaming?: boolean;
    isLabelingSpeakers?: boolean;
    currentSpeaker?: string | null;
  };
  ```

- [ ] **Step 3: Render speaker badge in ResultsSection**

  In the "System Input" sections (both response mode and conversation mode), add:
  ```tsx
  {currentSpeaker && (
    <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
      {currentSpeaker}
    </span>
  )}
  {isLabelingSpeakers && !currentSpeaker && (
    <span className="text-[9px] text-muted-foreground italic">
      Labeling speakers…
    </span>
  )}
  ```

  In the previous-messages map, use `message.speaker`:
  ```tsx
  <span className="text-[8px] font-medium text-muted-foreground uppercase">
    {message.role === "user" ? (message.speaker || "System") : "AI"}
  </span>
  ```

- [ ] **Step 4: Pass props from `speech/index.tsx`**

  Update the `ResultsSection` call to pass:
  ```tsx
  <ResultsSection
    lastTranscription={lastTranscription}
    lastAIResponse={lastAIResponse}
    isAIProcessing={isAIProcessing}
    conversation={conversation}
    conversationMode={conversationMode}
    setConversationMode={setConversationMode}
    partialTranscription={partialTranscription}
    isStreaming={isStreaming}
    isLabelingSpeakers={isLabelingSpeakers}
    currentSpeaker={currentSpeaker}
  />
  ```

- [ ] **Step 5: Add `isLabelingSpeakers` and `currentSpeaker` state in `useSystemAudio`**

  Add state:
  ```typescript
  const [isLabelingSpeakers, setIsLabelingSpeakers] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  ```

  Set `isLabelingSpeakers = true` when `stopCapture` starts diarization, and `false` when `setSpeakerSegments` completes.

  Compute `currentSpeaker` from the most recent utterance's timestamp and `speakerSegments`.

---

## Task 6: Verify and commit

**Files:**
- All modified files

- [ ] **Step 1: Run checks**

  ```bash
  cargo check --manifest-path src-tauri/Cargo.toml
  npx tsc --noEmit
  npm run build
  ```

  Expected: all three pass.

- [ ] **Step 2: Commit VAD + diarization together**

  ```bash
  git add src-tauri/src/stt.rs src-tauri/src/lib.rs src-tauri/src/speaker/commands.rs src/hooks/useSystemAudio.ts src/hooks/useSttStatus.ts src/components/SttInitOverlay.tsx src/pages/app/components/speech/ResultsSection.tsx src/pages/app/components/speech/index.tsx src/types/completion.ts
  git commit -m "feat(stt): add Silero VAD and offline speaker diarization for local-fluidaudio"
  git push origin feat/fluidaudio-vad-diarization
  ```

---

## Verification checklist

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` passes.
- [ ] Keyboard typing during VAD capture does not trigger false speech.
- [ ] Quiet speech is detected by Silero VAD.
- [ ] Two-person conversation produces distinct speaker labels after stop.
- [ ] Single-speaker conversation labels all utterances as the same speaker.
- [ ] Non-macOS / Intel Mac falls back to threshold VAD and no speaker labels.
- [ ] Diarization init failure leaves unlabeled transcripts but does not crash.
- [ ] Temp session WAV file is deleted after diarization.
- [ ] Continuous mode remains unchanged and produces no speaker labels.

---

## Notes

- Silero VAD decision latency is 256 ms because it processes 4096-sample chunks, while silence tracking still runs at the 64 ms hop granularity.
- Session audio memory is capped at `max_recording_duration_secs` (default 180 s ≈ 11 MB of f32 samples at 16 kHz).
- The `speech-detected` payload change is backward-compatible at the event level: old plain-string listeners would break, but the only listener is in `useSystemAudio.ts` and is updated in this plan.
