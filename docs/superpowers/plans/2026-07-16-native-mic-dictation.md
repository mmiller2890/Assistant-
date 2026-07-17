# Native Mic Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CDN-fetching JS VAD behind the mic button with the app's native Rust Silero pipeline on macOS; Windows/Linux keep the JS path, lazily loaded so macOS never touches it.

**Architecture:** New cpal-based `MicInput` (own thread, channel-bridged to async) feeds a lean `run_mic_dictation` loop reusing the existing Silero/hysteresis/WAV helpers; utterances emit `dictation-detected`. A new `useMicDictation` hook consumes the event and runs the unchanged `fetchSTT → submit()` downstream. `Audio.tsx` platform-splits the button; `AutoSpeechVAD` becomes a `React.lazy` import.

**Tech Stack:** Rust (cpal 0.15.3, tokio, tauri v2 events), fluidaudio-rs Silero via existing `SttState`, React 18.

## Global Constraints

- **All work lands on `dev`** in the main checkout.
- **macOS-only for v1**; non-macOS keeps `AutoSpeechVAD` (lazy-loaded). `@ricky0123/vad-react` stays in package.json.
- **Dictation and system-audio capture must not share a task slot** — both can run simultaneously.
- `dictation-detected` payload is `{ audio: <b64 wav> }` — **no timestamp fields** (no session timeline).
- No changes to the system-audio capture path.
- Gates per task: `cargo check` / `cargo test` (Rust), `npx tsc --noEmit` + `npm run build` (frontend), `npx vitest run` at the end.

---

## File structure

```
src-tauri/src/speaker/mic.rs        # NEW: cpal MicInput + mono downmix (unit-tested)
src-tauri/src/speaker/mod.rs        # expose mic module
src-tauri/src/speaker/commands.rs   # NEW: start/stop_mic_dictation + run_mic_dictation loop
src-tauri/src/lib.rs                # manage MicDictationState; register the two commands
src/hooks/useMicDictation.ts        # NEW: state machine + event listener + fetchSTT/submit
src/pages/app/components/completion/MicDictationButton.tsx  # NEW: macOS button UI
src/pages/app/components/completion/Audio.tsx               # platform split + React.lazy
```

---

## Task 1: `MicInput` (cpal capture, mono, channel-bridged)

**Files:**
- Create: `src-tauri/src/speaker/mic.rs`
- Modify: `src-tauri/src/speaker/mod.rs` (add `pub mod mic;` — macOS-gated like the platform modules if needed; cpal is cross-platform so ungated is fine)

**Interfaces:**
- Produces: `mic::MicInput::new(device_name: Option<String>) -> Result<MicInput, String>`;
  `MicInput::sample_rate(&self) -> u32`;
  `MicInput::start(self) -> (tokio::sync::mpsc::UnboundedReceiver<Vec<f32>>, MicStreamGuard)` — the guard keeps the cpal stream alive; dropping it stops capture.
  `mic::downmix_to_mono(samples: &[f32], channels: u16) -> Vec<f32>` (pub for tests).

- [ ] **Step 1: Write the failing unit test** (in `mic.rs` `#[cfg(test)]`)

```rust
#[cfg(test)]
mod tests {
    use super::downmix_to_mono;

    #[test]
    fn downmix_is_identity_for_mono() {
        let s = vec![0.1, 0.2, 0.3];
        assert_eq!(downmix_to_mono(&s, 1), s);
    }

    #[test]
    fn downmix_averages_stereo_frames() {
        let s = vec![0.0, 1.0, 0.5, 0.5];
        assert_eq!(downmix_to_mono(&s, 2), vec![0.5, 0.5]);
    }

    #[test]
    fn downmix_handles_zero_channels_without_panic() {
        assert!(downmix_to_mono(&[0.1], 0).is_empty());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test downmix 2>&1 | tail -3`
Expected: compile error (function not defined).

- [ ] **Step 3: Implement `mic.rs`**

```rust
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use log::{error, info};

pub fn downmix_to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels == 0 {
        return Vec::new();
    }
    if channels == 1 {
        return samples.to_vec();
    }
    let ch = channels as usize;
    samples
        .chunks_exact(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Keeps the cpal stream (and its thread) alive; drop to stop capture.
pub struct MicStreamGuard {
    stop_tx: std::sync::mpsc::Sender<()>,
}

impl Drop for MicStreamGuard {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
    }
}

pub struct MicInput {
    device_name: Option<String>,
    sample_rate: u32,
    channels: u16,
}

impl MicInput {
    pub fn new(device_name: Option<String>) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = find_device(&host, device_name.as_deref())?;
        let config = device
            .default_input_config()
            .map_err(|e| format!("No default input config: {e}"))?;
        Ok(Self {
            device_name,
            sample_rate: config.sample_rate().0,
            channels: config.channels(),
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Spawns the cpal stream on its own thread (cpal streams are not Send);
    /// mono chunks arrive on the returned receiver.
    pub fn start(
        self,
    ) -> Result<
        (
            tokio::sync::mpsc::UnboundedReceiver<Vec<f32>>,
            MicStreamGuard,
        ),
        String,
    > {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<f32>>();
        let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let channels = self.channels;
        let device_name = self.device_name.clone();

        std::thread::spawn(move || {
            let host = cpal::default_host();
            let device = match find_device(&host, device_name.as_deref()) {
                Ok(d) => d,
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("No default input config: {e}")));
                    return;
                }
            };
            let stream = device.build_input_stream(
                &config.clone().into(),
                move |data: &[f32], _| {
                    let mono = downmix_to_mono(data, channels);
                    if !mono.is_empty() {
                        let _ = tx.send(mono);
                    }
                },
                |e| error!("Mic stream error: {e}"),
                None,
            );
            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to open microphone: {e}")));
                    return;
                }
            };
            if let Err(e) = stream.play() {
                let _ = ready_tx.send(Err(format!("Failed to start microphone: {e}")));
                return;
            }
            info!("Mic dictation stream started");
            let _ = ready_tx.send(Ok(()));
            // Park until the guard drops; the stream stops when it goes out of scope.
            let _ = stop_rx.recv();
            info!("Mic dictation stream stopped");
        });

        match ready_rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(())) => Ok((rx, MicStreamGuard { stop_tx })),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("Timed out opening microphone".to_string()),
        }
    }
}

fn find_device(host: &cpal::Host, name: Option<&str>) -> Result<cpal::Device, String> {
    match name {
        Some(wanted) if !wanted.is_empty() && wanted != "default" => {
            let devices = host
                .input_devices()
                .map_err(|e| format!("Failed to list input devices: {e}"))?;
            for d in devices {
                if d.name().map(|n| n == wanted).unwrap_or(false) {
                    return Ok(d);
                }
            }
            // Selected device unplugged/renamed: fall back to default rather than fail.
            host.default_input_device()
                .ok_or_else(|| "No default input device".to_string())
        }
        _ => host
            .default_input_device()
            .ok_or_else(|| "No default input device".to_string()),
    }
}
```

Add to `src-tauri/src/speaker/mod.rs`: `pub mod mic;`

- [ ] **Step 4: Tests pass**

Run: `cd src-tauri && cargo test downmix 2>&1 | tail -3`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/speaker/mic.rs src-tauri/src/speaker/mod.rs
git commit -m "feat(dictation): cpal MicInput with mono downmix and thread-bridged stream"
```

---

## Task 2: dictation loop + commands + registration

**Files:**
- Modify: `src-tauri/src/speaker/commands.rs` (append)
- Modify: `src-tauri/src/lib.rs` (manage state; register commands)

**Interfaces:**
- Consumes: `mic::MicInput` (Task 1); existing `resample_linear`, `SILERO_SAMPLE_RATE`, `get_silero_vad_probability`, `silero_is_speech`, `apply_noise_gate`, `normalize_audio_level`, `samples_to_wav_b64`, `VadConfig` (thresholds), `crate::AudioState.vad_config`.
- Produces: `#[tauri::command] start_mic_dictation(app, device_id: Option<String>)`, `#[tauri::command] stop_mic_dictation(app)`, `pub struct MicDictationState`; event `dictation-detected` with `{ audio: String }`; event `dictation-stopped` on loop exit.

- [ ] **Step 1: Append state + commands + loop to `commands.rs`**

```rust
// ---- Mic dictation (native path for the mic button; macOS v1) ----

#[derive(Default)]
pub struct MicDictationState {
    task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[tauri::command]
pub async fn start_mic_dictation(
    app: AppHandle,
    device_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<MicDictationState>();
    {
        let guard = state
            .task
            .lock()
            .map_err(|e| format!("Failed to acquire dictation lock: {e}"))?;
        if guard.is_some() {
            return Err("Dictation already running".to_string());
        }
    }

    // Fail fast if Silero isn't available: dictation quality depends on it.
    if get_silero_vad_probability(&app, &[0.0f32; 512]).is_none() {
        return Err(
            "Voice detection isn't ready — initialize speech recognition first".to_string(),
        );
    }

    let input = crate::speaker::mic::MicInput::new(device_id)?;
    let sr = input.sample_rate();
    if !(8000..=96000).contains(&sr) {
        return Err(format!("Invalid mic sample rate: {sr}"));
    }
    let (rx, stream_guard) = input.start()?;

    let vad_config = app
        .state::<crate::AudioState>()
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to read VAD config: {e}"))?
        .clone();

    state
        .stop_flag
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let stop_flag = state.stop_flag.clone();

    let app_clone = app.clone();
    let task = tokio::spawn(async move {
        run_mic_dictation(app_clone.clone(), rx, sr, vad_config, stop_flag).await;
        drop(stream_guard);
        let _ = app_clone.emit("dictation-stopped", ());
    });

    *state
        .task
        .lock()
        .map_err(|e| format!("Failed to store dictation task: {e}"))? = Some(task);
    Ok(())
}

#[tauri::command]
pub async fn stop_mic_dictation(app: AppHandle) -> Result<(), String> {
    let state = app.state::<MicDictationState>();
    state
        .stop_flag
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let task = state
        .task
        .lock()
        .map_err(|e| format!("Failed to acquire dictation lock: {e}"))?
        .take();
    if let Some(task) = task {
        let _ = tokio::time::timeout(tokio::time::Duration::from_secs(3), task).await;
    }
    Ok(())
}

async fn run_mic_dictation(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<f32>>,
    sr: u32,
    config: VadConfig,
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let hop = config.hop_size.max(256);
    let mut pending: Vec<f32> = Vec::new();
    let mut pre_speech: std::collections::VecDeque<Vec<f32>> =
        std::collections::VecDeque::with_capacity(config.pre_speech_chunks);
    let mut speech_buffer: Vec<f32> = Vec::new();
    let mut in_speech = false;
    let mut silence_hops = 0usize;
    let mut speech_hops = 0usize;
    // macOS assumes silence until the first Silero result (mirrors the tap loop).
    let mut prob: Option<f32> = if cfg!(target_os = "macos") { Some(0.0) } else { None };

    loop {
        if stop_flag.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        let chunk = match tokio::time::timeout(
            tokio::time::Duration::from_millis(200),
            rx.recv(),
        )
        .await
        {
            Ok(Some(c)) => c,
            Ok(None) => break, // stream thread ended
            Err(_) => continue, // timeout: re-check stop flag
        };
        pending.extend_from_slice(&chunk);

        while pending.len() >= hop {
            let hop_chunk: Vec<f32> = pending.drain(..hop).collect();
            let chunk_16k = resample_linear(&hop_chunk, sr as usize, SILERO_SAMPLE_RATE);
            if let Some(p) = get_silero_vad_probability(&app, &chunk_16k) {
                prob = Some(p);
            }
            let is_speech = match prob {
                Some(p) => silero_is_speech(in_speech, p),
                None => {
                    // Threshold fallback (mirrors the tap loop's philosophy).
                    let (rms, peak) = calculate_audio_metrics(&hop_chunk);
                    rms > config.sensitivity_rms || peak > config.peak_threshold
                }
            };

            if is_speech {
                if !in_speech {
                    in_speech = true;
                    speech_hops = 0;
                    speech_buffer.clear();
                    for pre in pre_speech.iter() {
                        speech_buffer.extend_from_slice(pre);
                    }
                }
                silence_hops = 0;
                speech_hops += 1;
                speech_buffer.extend_from_slice(&hop_chunk);
            } else if in_speech {
                silence_hops += 1;
                speech_buffer.extend_from_slice(&hop_chunk);
                if silence_hops >= config.silence_chunks {
                    in_speech = false;
                    if speech_hops >= config.min_speech_chunks {
                        emit_dictation_utterance(&app, sr, &speech_buffer, &config);
                    }
                    speech_buffer.clear();
                }
            } else {
                pre_speech.push_back(hop_chunk);
                while pre_speech.len() > config.pre_speech_chunks {
                    pre_speech.pop_front();
                }
            }
        }
    }

    // Flush a trailing utterance on stop.
    if in_speech && speech_hops >= config.min_speech_chunks {
        emit_dictation_utterance(&app, sr, &speech_buffer, &config);
    }
}

fn emit_dictation_utterance(app: &AppHandle, sr: u32, samples: &[f32], config: &VadConfig) {
    let cleaned = apply_noise_gate(samples, config.noise_gate_threshold);
    let normalized = normalize_audio_level(&cleaned, 0.1);
    if normalized.is_empty() {
        return;
    }
    match samples_to_wav_b64(sr, &normalized) {
        Ok(b64) => {
            let _ = app.emit("dictation-detected", serde_json::json!({ "audio": b64 }));
        }
        Err(e) => error!("Failed to encode dictation utterance: {e}"),
    }
}
```

- [ ] **Step 2: Register in `lib.rs`**

Add `.manage(shortcuts::WindowVisibility { ... })`-style registration — after the existing `.manage(...)` calls:

```rust
        .manage(speaker::commands::MicDictationState::default())
```

(match the actual path — commands are re-exported via `speaker::`; use the same path style as `speaker::start_system_audio_capture` in the handler list). In `generate_handler![]`, after `speaker::get_output_devices,`:

```rust
            speaker::start_mic_dictation,
            speaker::stop_mic_dictation,
```

If `speaker/mod.rs` re-exports commands (`pub use commands::*;`), both resolve; otherwise add the re-export.

- [ ] **Step 3: Gates**

Run: `cd src-tauri && cargo check 2>&1 | tail -2 && cargo test 2>&1 | tail -3`
Expected: clean check; all tests pass (incl. Task 1's three).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/speaker/commands.rs src-tauri/src/lib.rs
git commit -m "feat(dictation): native Silero mic dictation loop + start/stop commands"
```

---

## Task 3: `useMicDictation` hook

**Files:**
- Create: `src/hooks/useMicDictation.ts`

**Interfaces:**
- Consumes: `invoke("start_mic_dictation", { deviceId })`, `invoke("stop_mic_dictation")`, events `dictation-detected` (`{ audio: string }`) and `dictation-stopped`; `fetchSTT` from `@/lib`; app context (`selectedSttProvider`, `allSttProviders`, `selectedAudioDevices`).
- Produces:
  ```ts
  useMicDictation(params: {
    submit: (text: string) => void;
    setState: React.Dispatch<React.SetStateAction<any>>; // completion state (error surface)
  }): {
    status: "idle" | "starting" | "listening" | "transcribing";
    error: string | null;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    reset: () => void; // clear error back to idle
  }
  ```

- [ ] **Step 1: Implement the hook**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetchSTT } from "@/lib";
import { useApp } from "@/contexts";

type DictationStatus = "idle" | "starting" | "listening" | "transcribing";

export function useMicDictation({
  submit,
  setState,
}: {
  submit: (text: string) => void;
  setState: React.Dispatch<React.SetStateAction<any>>;
}) {
  const { selectedSttProvider, allSttProviders, selectedAudioDevices } =
    useApp();
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const selectedSttProviderRef = useRef(selectedSttProvider);
  const allSttProvidersRef = useRef(allSttProviders);
  const submitRef = useRef(submit);
  const statusRef = useRef(status);
  selectedSttProviderRef.current = selectedSttProvider;
  allSttProvidersRef.current = allSttProviders;
  submitRef.current = submit;
  statusRef.current = status;

  useEffect(() => {
    const unlistenDetected = listen<{ audio: string }>(
      "dictation-detected",
      async (event) => {
        const b64 = event.payload?.audio;
        if (!b64 || b64.length < 100) return;
        const provider = allSttProvidersRef.current.find(
          (p) => p.id === selectedSttProviderRef.current.provider
        );
        if (!provider) {
          setState((prev: any) => ({
            ...prev,
            error: "Speech provider configuration not found.",
          }));
          return;
        }
        try {
          setStatus("transcribing");
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const audioBlob = new Blob([bytes], { type: "audio/wav" });
          const transcription = await fetchSTT({
            provider,
            selectedProvider: selectedSttProviderRef.current,
            audio: audioBlob,
          });
          if (transcription) {
            submitRef.current(transcription);
          }
        } catch (err) {
          console.error("Dictation transcription failed:", err);
          setState((prev: any) => ({
            ...prev,
            error:
              err instanceof Error ? err.message : "Transcription failed",
          }));
        } finally {
          setStatus((s) => (s === "transcribing" ? "listening" : s));
        }
      }
    );
    const unlistenStopped = listen("dictation-stopped", () => {
      setStatus("idle");
    });
    return () => {
      unlistenDetected.then((fn) => fn());
      unlistenStopped.then((fn) => fn());
      if (statusRef.current !== "idle") {
        invoke("stop_mic_dictation").catch(() => {});
      }
    };
  }, [setState]);

  const start = useCallback(async () => {
    setError(null);
    setStatus("starting");
    try {
      const deviceId = selectedAudioDevices.input.id;
      await invoke("start_mic_dictation", {
        deviceId: deviceId === "default" ? null : deviceId,
      });
      setStatus("listening");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedAudioDevices.input.id]);

  const stop = useCallback(async () => {
    try {
      await invoke("stop_mic_dictation");
    } catch (err) {
      console.error("Failed to stop dictation:", err);
    }
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setStatus("idle");
  }, []);

  return { status, error, start, stop, reset };
}
```

**Device-id caveat (resolve at execution):** confirm what `selectedAudioDevices.input.id` holds. If the Audio settings page populates it from the Rust `get_input_devices` command, it's a native identifier — pass the device **name** if that's what `AudioDevice` carries, matching `find_device`'s name matching. If it's a browser `getUserMedia` id, pass `null` (default mic) for v1 and note the limitation. Check `src/pages/audio/components/AudioSelection.tsx` for the source.

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMicDictation.ts
git commit -m "feat(dictation): useMicDictation hook (native events -> fetchSTT -> submit)"
```

---

## Task 4: platform-split the mic button

**Files:**
- Create: `src/pages/app/components/completion/MicDictationButton.tsx`
- Modify: `src/pages/app/components/completion/Audio.tsx`

**Interfaces:**
- Consumes: `useMicDictation` (Task 3); `UseCompletionReturn` prop types; `isMacOS` from `@/lib`.
- Produces: on macOS the popover-trigger child is `MicDictationButton`; elsewhere the lazy `AutoSpeechVAD`. Button visual states mirror today's: idle mic / muted spinner (starting) / pulsing `MicOffIcon text-primary` (listening) / `text-primary` spinner (transcribing) / `text-destructive` mic + tooltip (error, click resets).

- [ ] **Step 1: Create `MicDictationButton.tsx`**

```tsx
import { LoaderCircleIcon, MicIcon, MicOffIcon } from "lucide-react";
import { Button } from "@/components";
import { UseCompletionReturn } from "@/types";
import { useMicDictation } from "@/hooks/useMicDictation";

export const MicDictationButton = ({
  submit,
  setState,
}: Pick<UseCompletionReturn, "submit" | "setState">) => {
  const { status, error, start, stop, reset } = useMicDictation({
    submit,
    setState,
  });

  const title = error
    ? `Voice input failed: ${error}. Click to reset.`
    : status === "starting"
      ? "Starting microphone…"
      : status === "listening"
        ? "Stop voice input"
        : status === "transcribing"
          ? "Transcribing…"
          : "Start voice input";

  return (
    <Button
      size="icon"
      title={title}
      className="cursor-pointer"
      onClick={() => {
        if (error) {
          reset();
        } else if (status === "idle") {
          start();
        } else if (status === "listening" || status === "transcribing") {
          stop();
        }
      }}
    >
      {error ? (
        <MicIcon className="h-4 w-4 text-destructive" />
      ) : status === "starting" ? (
        <LoaderCircleIcon className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : status === "transcribing" ? (
        <LoaderCircleIcon className="h-4 w-4 animate-spin text-primary" />
      ) : status === "listening" ? (
        <MicOffIcon className="h-4 w-4 animate-pulse text-primary" />
      ) : (
        <MicIcon className="h-4 w-4" />
      )}
    </Button>
  );
};
```

- [ ] **Step 2: Platform-split `Audio.tsx`**

Replace the static `AutoSpeechVAD` import with a lazy one and select the child by platform. Full replacement of the imports + trigger child (Popover wrapper, `configured` gating, PopoverContent warning body all stay exactly as they are):

```tsx
import { lazy, Suspense } from "react";
import { InfoIcon, MicIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, Button } from "@/components";
import { UseCompletionReturn } from "@/types";
import { useApp } from "@/contexts";
import { isMacOS } from "@/lib";
import { MicDictationButton } from "./MicDictationButton";

// Loaded only off-macOS: vad-react (and its runtime asset fetching) must never
// initialize on the platform where the native dictation path exists.
const AutoSpeechVAD = lazy(() =>
  import("./AutoSpeechVad").then((m) => ({ default: m.AutoSpeechVAD }))
);
```

Inside the `PopoverTrigger`, the configured-branch child becomes:

```tsx
        {(localApiEnabled || speechProviderStatus) && enableVAD ? (
          isMacOS() ? (
            <MicDictationButton submit={submit} setState={setState} />
          ) : (
            <Suspense
              fallback={
                <Button size="icon" title="Loading voice input…">
                  <MicIcon className="h-4 w-4 text-muted-foreground" />
                </Button>
              }
            >
              <AutoSpeechVAD
                key={selectedAudioDevices.input.id}
                submit={submit}
                setState={setState}
                setEnableVAD={setEnableVAD}
                microphoneDeviceId={selectedAudioDevices.input.id}
              />
            </Suspense>
          )
        ) : (
          /* existing plain mic Button that toggles enableVAD — unchanged */
        )}
```

Note: on macOS the button still mounts via `enableVAD` exactly like today (first
click sets `enableVAD`, second interacts with the dictation button). Keep that
mount semantic — it preserves the existing UX and the invisible-pane gating.

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -2`
Expected: clean; build emits a separate lazy chunk for AutoSpeechVad.

- [ ] **Step 4: Commit**

```bash
git add src/pages/app/components/completion/MicDictationButton.tsx src/pages/app/components/completion/Audio.tsx
git commit -m "feat(dictation): mac mic button uses native pipeline; vad-react lazy-loaded off-mac"
```

---

## Task 5: full gates + manual verification + push

- [ ] **Step 1:** `cd src-tauri && cargo check && cargo test`, then `npx tsc --noEmit && npm run build && npx vitest run` — all green.
- [ ] **Step 2:** Manual (macOS, `npm run tauri dev`): mic button reaches listening; speak → text lands in the completion input; **network panel shows zero jsdelivr requests**; system-audio capture (⌘⇧M) runs simultaneously without either killing the other; stop works; with STT uninitialized the button shows a clear error.
- [ ] **Step 3:** `git push origin dev`.

---

## Self-Review

**Spec coverage:** MicInput/cpal + own thread (§Rust) → T1; lean loop, `dictation-detected` `{audio}` payload without timestamps, own task slot, Silero fail-fast (§Rust) → T2; hook state machine + unchanged fetchSTT→submit (§Frontend) → T3; platform split + React.lazy + unchanged popover gating (§Frontend) → T4; verification incl. zero-jsdelivr + simultaneity (§Testing) → T5. Win/Linux out of scope honored (lazy JS path kept).

**Placeholders:** the one deliberately open item is the device-id namespace check in T3, flagged with the exact file to consult and a safe fallback — a documented decision point, not a TBD.

**Type consistency:** `start_mic_dictation(app, device_id: Option<String>)` ↔ `invoke("start_mic_dictation", { deviceId })` (Tauri camelCases args); `dictation-detected` payload `{ audio: string }` in both T2 emit and T3 listener; `MicDictationButton({submit, setState})` matches T4's usage; `useMicDictation` return shape matches button consumption.
