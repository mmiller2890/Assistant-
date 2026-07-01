#!/usr/bin/env python3
"""
MLX ASR server — OpenAI-compatible transcription endpoint plus a WebSocket
streaming endpoint for Parakeet models.

Defaults to mlx-community/parakeet-tdt-0.6b-v3 for best English accuracy.
Other tested models:
  - mlx-community/nemotron-3.5-asr-streaming-0.6b (streaming, 40 languages)
  - mlx-community/nemotron-3.5-asr-streaming-0.6b-8bit

Usage:
  python3.12 mlx_asr_server.py
  python3.12 mlx_asr_server.py --port 8001
  python3.12 mlx_asr_server.py --model mlx-community/nemotron-3.5-asr-streaming-0.6b

Endpoints:
  POST /v1/audio/transcriptions  (file + optional model fields) — batch
  WS   /v1/audio/stream          (live audio chunks) — Parakeet streaming only
  GET  /health
"""

import argparse
import json
import os
import struct
import sys
import tempfile
from contextlib import asynccontextmanager
from typing import Any, Optional

import numpy as np

try:
    from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
    import uvicorn
except ImportError:
    print("Missing dependency. Install with:\n  pip install fastapi uvicorn python-multipart websockets")
    sys.exit(1)

try:
    import librosa
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False

MODEL: Any = None
MODEL_TYPE: Optional[str] = None
MODEL_ID: str = "mlx-community/parakeet-tdt-0.6b-v3"
PORT: int = 8001

TARGET_SR = 16000


def load_model(model_id: str):
    """Load model via the appropriate library.

    parakeet_mlx only supports Parakeet variants (TDT, RNNT, CTC, TDTCTC).
    Nemotron and other models load through mlx_audio.stt.
    """
    if "parakeet" in model_id.lower():
        try:
            from parakeet_mlx import from_pretrained
        except ImportError:
            print("Missing parakeet_mlx. Install with:\n  pip install parakeet-mlx")
            sys.exit(1)
        print(f"Loading Parakeet model via parakeet_mlx: {model_id} ...")
        return from_pretrained(model_id), "parakeet_mlx"
    else:
        try:
            from mlx_audio.stt import load
        except ImportError:
            print("Missing mlx_audio. Install with:\n  pip install mlx-audio")
            sys.exit(1)
        print(f"Loading model via mlx_audio: {model_id} ...")
        return load(model_id), "mlx_audio"


def bytes_to_f32(data: bytes) -> np.ndarray:
    """Convert little-endian float32 bytes to a 1-D numpy array."""
    if len(data) % 4 != 0:
        raise ValueError(f"f32 PCM data length {len(data)} is not a multiple of 4")
    return np.frombuffer(data, dtype=np.float32, count=len(data) // 4)


def resample(samples: np.ndarray, orig_sr: int, target_sr: int = TARGET_SR) -> np.ndarray:
    if orig_sr == target_sr:
        return samples
    if not HAS_LIBROSA:
        raise RuntimeError("librosa is required for server-side resampling. pip install librosa")
    return librosa.resample(y=samples.astype(np.float32), orig_sr=orig_sr, target_sr=target_sr)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, MODEL_TYPE
    MODEL, MODEL_TYPE = load_model(MODEL_ID)
    print(f"Model loaded ({MODEL_TYPE}). Server starting on http://localhost:{PORT}")
    yield
    MODEL = None


app = FastAPI(title="MLX ASR Server", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_ID, "model_type": MODEL_TYPE}


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), model_name: str = Form(default="")):
    audio_bytes = await file.read()
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        if MODEL_TYPE == "parakeet_mlx":
            result = MODEL.transcribe(tmp_path)
        else:
            result = MODEL.generate(tmp_path)
        text = result.text if hasattr(result, "text") else str(result)
        return {"text": text.strip()}
    finally:
        os.unlink(tmp_path)


@app.websocket("/v1/audio/stream")
async def stream_transcribe(ws: WebSocket):
    await ws.accept()

    if MODEL_TYPE != "parakeet_mlx":
        await ws.send_json({"error": "Streaming requires a Parakeet model"})
        await ws.close()
        return

    sample_rate: int = TARGET_SR
    transcriber = None
    ctx = None
    latest_text = ""

    try:
        import mlx.core as mx

        # First message: JSON handshake with the capture sample rate.
        handshake_raw = await ws.receive_text()
        try:
            info = json.loads(handshake_raw)
            sample_rate = int(info.get("sample_rate", TARGET_SR))
        except Exception:
            sample_rate = TARGET_SR

        transcriber = MODEL.transcribe_stream(context_size=(256, 256))
        ctx = transcriber.__enter__()

        while True:
            message = await ws.receive()

            if message.get("type") == "websocket.disconnect":
                break

            chunk_bytes = message.get("bytes")
            if not chunk_bytes:
                continue

            try:
                samples = bytes_to_f32(chunk_bytes)
                if sample_rate != TARGET_SR:
                    samples = resample(samples, sample_rate, TARGET_SR)

                mx_chunk = mx.array(samples)
                ctx.add_audio(mx_chunk)

                current_text = ctx.result.text
                if current_text != latest_text:
                    latest_text = current_text
                    await ws.send_json({"text": latest_text, "is_final": False})
            except Exception as e:
                print(f"Streaming chunk error: {e}", file=sys.stderr)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}", file=sys.stderr)
        try:
            await ws.send_json({"error": str(e)})
        except Exception:
            pass
    finally:
        if ctx is not None:
            try:
                final_text = ctx.result.text or latest_text
                await ws.send_json({"text": final_text, "is_final": True})
            except Exception:
                pass
        if transcriber is not None:
            try:
                transcriber.__exit__(None, None, None)
            except Exception:
                pass
        try:
            await ws.close()
        except Exception:
            pass


def main():
    global MODEL_ID, PORT
    parser = argparse.ArgumentParser(description="MLX ASR server (Apple Silicon)")
    parser.add_argument(
        "--model",
        default="mlx-community/parakeet-tdt-0.6b-v3",
        help="MLX ASR model ID (default: mlx-community/parakeet-tdt-0.6b-v3)",
    )
    parser.add_argument("--port", type=int, default=8001, help="Port (default: 8001)")
    args = parser.parse_args()

    MODEL_ID = args.model
    PORT = args.port

    uvicorn.run(app, host="0.0.0.0", port=PORT)


if __name__ == "__main__":
    main()