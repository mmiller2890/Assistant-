use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tracing::{error, info};

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
