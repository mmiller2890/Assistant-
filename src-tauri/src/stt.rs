#[cfg(target_os = "macos")]
use fluidaudio_rs::FluidAudio;
use serde_json;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct SttInner {
    #[cfg(target_os = "macos")]
    audio: Option<FluidAudio>,
    asr_ready: bool,
    streaming_ready: bool,
    is_streaming_active: bool,
}

impl Default for SttInner {
    fn default() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            audio: None,
            asr_ready: false,
            streaming_ready: false,
            is_streaming_active: false,
        }
    }
}

#[derive(Default)]
pub struct SttState {
    inner: Arc<Mutex<SttInner>>,
}

fn not_supported() -> String {
    "Local STT requires macOS Apple Silicon".to_string()
}

fn emit_error(app: &AppHandle, message: String) {
    let _ = app.emit("stt-error", message);
}

impl SttState {
    pub fn init_asr(&self, app: &AppHandle) -> Result<(), String> {
        #[cfg(not(target_os = "macos"))]
        {
            emit_error(app, not_supported());
            return Err(not_supported());
        }

        #[cfg(target_os = "macos")]
        {
            let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
            if guard.asr_ready {
                return Ok(());
            }

            let audio = FluidAudio::new().map_err(|e| e.to_string())?;
            if audio.is_intel_mac() {
                let msg = not_supported();
                emit_error(app, msg.clone());
                return Err(msg);
            }

            audio.init_asr().map_err(|e| e.to_string())?;
            guard.asr_ready = true;
            guard.audio = Some(audio);
            let _ = app.emit("stt-ready", ());
            Ok(())
        }
    }

    pub fn init_streaming_asr(&self, app: &AppHandle) -> Result<(), String> {
        #[cfg(not(target_os = "macos"))]
        {
            emit_error(app, not_supported());
            return Err(not_supported());
        }

        #[cfg(target_os = "macos")]
        {
            let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
            if guard.streaming_ready {
                return Ok(());
            }

            if guard.audio.is_none() {
                let audio = FluidAudio::new().map_err(|e| e.to_string())?;
                if audio.is_intel_mac() {
                    let msg = not_supported();
                    emit_error(app, msg.clone());
                    return Err(msg);
                }
                guard.audio = Some(audio);
            }

            let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
            audio.init_streaming_asr().map_err(|e| e.to_string())?;
            guard.streaming_ready = true;
            let _ = app.emit("stt-streaming-ready", ());
            Ok(())
        }
    }

    pub fn transcribe_samples(&self, samples: &[f32]) -> Result<serde_json::Value, String> {
        #[cfg(not(target_os = "macos"))]
        return Err(not_supported());

        #[cfg(target_os = "macos")]
        {
            let guard = self.inner.lock().map_err(|e| e.to_string())?;
            let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
            if !guard.asr_ready {
                return Err("ASR not ready".to_string());
            }
            let result = audio
                .transcribe_samples(samples)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "text": result.text,
                "confidence": result.confidence,
                "duration": result.duration,
                "processing_time": result.processing_time,
            }))
        }
    }

    pub fn streaming_start(&self) -> Result<(), String> {
        #[cfg(not(target_os = "macos"))]
        return Err(not_supported());

        #[cfg(target_os = "macos")]
        {
            let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
            if !guard.streaming_ready {
                return Err("Streaming ASR not ready".to_string());
            }
            let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
            audio.streaming_asr_start().map_err(|e| e.to_string())?;
            guard.is_streaming_active = true;
            Ok(())
        }
    }

    pub fn streaming_feed(&self, samples: &[f32]) -> Result<(), String> {
        #[cfg(not(target_os = "macos"))]
        return Err(not_supported());

        #[cfg(target_os = "macos")]
        {
            let guard = self.inner.lock().map_err(|e| e.to_string())?;
            if !guard.is_streaming_active {
                return Err("No active streaming session".to_string());
            }
            let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
            audio.streaming_asr_feed(samples).map_err(|e| e.to_string())?;
            Ok(())
        }
    }

    pub fn streaming_finish(&self, app: &AppHandle) -> Result<String, String> {
        #[cfg(not(target_os = "macos"))]
        return Err(not_supported());

        #[cfg(target_os = "macos")]
        {
            let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
            if !guard.is_streaming_active {
                return Ok(String::new());
            }
            let audio = guard.audio.as_ref().ok_or("STT not initialized")?;
            let text = audio.streaming_asr_finish().map_err(|e| e.to_string())?;
            guard.is_streaming_active = false;
            if !text.is_empty() {
                let _ = app.emit("stt-final", text.clone());
            }
            Ok(text)
        }
    }

    pub fn get_status(&self) -> Result<serde_json::Value, String> {
        #[cfg(not(target_os = "macos"))]
        {
            return Ok(serde_json::json!({
                "asr_ready": false,
                "streaming_ready": false,
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
                "streaming_ready": guard.streaming_ready,
                "is_apple_silicon": is_apple_silicon,
                "is_intel": is_intel,
                "is_supported": is_apple_silicon && !is_intel,
            }))
        }
    }
}

#[tauri::command]
pub async fn stt_init(state: State<'_, SttState>, app: AppHandle) -> Result<(), String> {
    state.init_asr(&app)
}

#[tauri::command]
pub async fn stt_init_streaming(state: State<'_, SttState>, app: AppHandle) -> Result<(), String> {
    state.init_streaming_asr(&app)
}

#[tauri::command]
pub async fn stt_transcribe_speech(
    samples: Vec<f32>,
    state: State<'_, SttState>,
) -> Result<serde_json::Value, String> {
    state.transcribe_samples(&samples)
}

#[tauri::command]
pub async fn stt_streaming_start(state: State<'_, SttState>) -> Result<(), String> {
    state.streaming_start()
}

#[tauri::command]
pub async fn stt_streaming_feed(
    samples: Vec<f32>,
    state: State<'_, SttState>,
) -> Result<(), String> {
    state.streaming_feed(&samples)
}

#[tauri::command]
pub async fn stt_streaming_finish(
    state: State<'_, SttState>,
    app: AppHandle,
) -> Result<String, String> {
    state.streaming_finish(&app)
}

#[tauri::command]
pub async fn stt_get_status(state: State<'_, SttState>) -> Result<serde_json::Value, String> {
    state.get_status()
}
