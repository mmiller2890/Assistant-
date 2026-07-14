#[cfg(target_os = "macos")]
use fluidaudio_rs::FluidAudio;
use serde_json;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct SttInner {
    #[cfg(target_os = "macos")]
    audio: Option<FluidAudio>,
    asr_ready: bool,
    vad_ready: bool,
    diarization_ready: bool,
    #[cfg(target_os = "macos")]
    session_wav_path: Option<std::path::PathBuf>,
}

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

#[derive(Default)]
pub struct SttState {
    pub inner: Arc<Mutex<SttInner>>,
}

fn not_supported() -> String {
    "Local STT requires macOS Apple Silicon".to_string()
}

fn emit_error(app: &AppHandle, message: String) {
    eprintln!("[STT] error: {}", message);
    let _ = app.emit("stt-error", message);
}

impl SttState {
    #[cfg(target_os = "macos")]
    fn init_asr_inner(
        inner: Arc<Mutex<SttInner>>,
        app: AppHandle,
    ) -> Result<(), String> {
        let mut guard = inner.lock().map_err(|e| e.to_string())?;
        if guard.asr_ready {
            return Ok(());
        }

        let audio = FluidAudio::new().map_err(|e| e.to_string())?;
        if audio.is_intel_mac() {
            let msg = not_supported();
            emit_error(&app, msg.clone());
            return Err(msg);
        }

        audio.init_asr().map_err(|e| e.to_string())?;
        guard.asr_ready = true;
        guard.audio = Some(audio);
        let _ = app.emit("stt-ready", ());
        Ok(())
    }

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
            let msg = e.to_string();
            emit_error(&app, format!("Failed to initialize VAD: {}", msg));
            return Err(msg);
        }
        guard.vad_ready = true;
        Ok(())
    }

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
            let msg = e.to_string();
            emit_error(&app, format!("Failed to initialize diarization: {}", msg));
            return Err(msg);
        }
        guard.diarization_ready = true;
        Ok(())
    }

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

    pub fn transcribe_samples(&self, samples: &[f32]) -> Result<serde_json::Value, String> {
        #[cfg(not(target_os = "macos"))]
        return Err(not_supported());

        #[cfg(target_os = "macos")]
        {
            let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
            if guard.audio.is_none() || !guard.asr_ready {
                let audio = FluidAudio::new().map_err(|e| e.to_string())?;
                if audio.is_intel_mac() {
                    return Err(not_supported());
                }
                audio.init_asr().map_err(|e| e.to_string())?;
                guard.asr_ready = true;
                guard.audio = Some(audio);
            }
            let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
            let result = audio
                .transcribe_samples(samples)
                .map_err(|e| e.to_string())?;
            let text = audio
                .itn_normalize_sentence(&result.text)
                .unwrap_or(result.text.clone());
            Ok(serde_json::json!({
                "text": text,
                "confidence": result.confidence,
                "duration": result.duration,
                "processing_time": result.processing_time,
            }))
        }
    }

    pub fn get_status(&self) -> Result<serde_json::Value, String> {
        #[cfg(not(target_os = "macos"))]
        {
            return Ok(serde_json::json!({
                "asr_ready": false,
                "vad_ready": false,
                "diarization_ready": false,
                "is_apple_silicon": false,
                "is_intel": false,
                "is_supported": false,
            }));
        }

        #[cfg(target_os = "macos")]
        {
            let guard = self.inner.lock().map_err(|e| e.to_string())?;

            let (is_apple_silicon, is_intel) = if let Some(audio) = guard.audio.as_ref() {
                (audio.is_apple_silicon(), audio.is_intel_mac())
            } else {
                match FluidAudio::new() {
                    Ok(audio) => (audio.is_apple_silicon(), audio.is_intel_mac()),
                    Err(_) => (false, false),
                }
            };

            Ok(serde_json::json!({
                "asr_ready": guard.asr_ready,
                "vad_ready": guard.vad_ready,
                "diarization_ready": guard.diarization_ready,
                "is_apple_silicon": is_apple_silicon,
                "is_intel": is_intel,
                "is_supported": is_apple_silicon && !is_intel,
            }))
        }
    }
}

impl Drop for SttState {
    fn drop(&mut self) {
        if let Ok(guard) = self.inner.lock() {
            if let Some(path) = guard.session_wav_path.as_ref() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

#[tauri::command]
pub async fn stt_init(state: State<'_, SttState>, app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        emit_error(&app, not_supported());
        return Err(not_supported());
    }

    #[cfg(target_os = "macos")]
    {
        let inner = state.inner.clone();
        tokio::task::spawn_blocking(move || SttState::init_asr_inner(inner, app))
            .await
            .map_err(|e| e.to_string())?
    }
}

#[tauri::command]
pub async fn stt_transcribe_speech(
    samples: Vec<f32>,
    state: State<'_, SttState>,
) -> Result<serde_json::Value, String> {
    state.transcribe_samples(&samples)
}

#[tauri::command]
pub async fn stt_get_status(state: State<'_, SttState>) -> Result<serde_json::Value, String> {
    state.get_status()
}

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

#[tauri::command]
pub async fn stt_diarize_file(
    state: State<'_, SttState>,
    path: String,
) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "macos"))]
    return Ok(serde_json::json!([]));

    #[cfg(target_os = "macos")]
    {
        let managed_path = state
            .take_session_wav_path()
            .map(|p| p.to_string_lossy().to_string());

        let path_for_diarization = managed_path
            .filter(|managed| managed == &path)
            .ok_or("Path is not the managed session audio file")?;
        let path_for_cleanup = path_for_diarization.clone();

        let inner = state.inner.clone();
        let segments = tokio::task::spawn_blocking(move || {
            let state = SttState { inner };
            state.diarize_file(&path_for_diarization)
        })
        .await
        .map_err(|e| e.to_string())??;

        let _ = std::fs::remove_file(&path_for_cleanup);

        Ok(serde_json::json!(segments.iter().map(|s| {
            serde_json::json!({
                "speaker_id": s.speaker_id,
                "start_time": s.start_time,
                "end_time": s.end_time,
            })
        }).collect::<Vec<_>>()))
    }
}
