#[cfg(target_os = "macos")]
use fluidaudio_rs::FluidAudio;
use serde_json;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct SttInner {
    #[cfg(target_os = "macos")]
    audio: Option<FluidAudio>,
    asr_ready: bool,
}

impl Default for SttInner {
    fn default() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            audio: None,
            asr_ready: false,
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
                "is_apple_silicon": is_apple_silicon,
                "is_intel": is_intel,
                "is_supported": is_apple_silicon && !is_intel,
            }))
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
