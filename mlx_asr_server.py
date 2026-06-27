#!/usr/bin/env python3
"""
MLX ASR server — OpenAI-compatible transcription endpoint for any
mlx-audio speech recognition model on Apple Silicon.

Defaults to mlx-community/parakeet-tdt-0.6b-v3 for best English accuracy.
Other tested models:
  - mlx-community/nemotron-3.5-asr-streaming-0.6b (streaming, 40 languages)
  - mlx-community/nemotron-3.5-asr-streaming-0.6b-8bit

Usage:
  python3.12 mlx_asr_server.py
  python3.12 mlx_asr_server.py --port 8001
  python3.12 mlx_asr_server.py --model mlx-community/nemotron-3.5-asr-streaming-0.6b

Endpoint: POST /v1/audio/transcriptions  (file + optional model fields)
          GET  /health
"""

import argparse
import sys
import tempfile
import os

try:
    from mlx_audio.stt import load
except ImportError:
    print("Missing dependency. Install with:\n  pip install \"git+https://github.com/Blaizzy/mlx-audio.git\"")
    sys.exit(1)

try:
    from fastapi import FastAPI, UploadFile, File, Form
    import uvicorn
except ImportError:
    print("Missing dependency. Install with:\n  pip install fastapi uvicorn python-multipart")
    sys.exit(1)

app = FastAPI(title="MLX ASR Server")
model = None


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), model_name: str = Form(default="")):
    audio_bytes = await file.read()
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        result = model.generate(tmp_path)
        text = result.text if hasattr(result, "text") else str(result)
        return {"text": text.strip()}
    finally:
        os.unlink(tmp_path)


@app.get("/health")
async def health():
    return {"status": "ok"}


def main():
    global model
    parser = argparse.ArgumentParser(description="MLX ASR server (Apple Silicon)")
    parser.add_argument(
        "--model",
        default="mlx-community/parakeet-tdt-0.6b-v3",
        help="MLX ASR model ID (default: mlx-community/parakeet-tdt-0.6b-v3)",
    )
    parser.add_argument("--port", type=int, default=8001, help="Port (default: 8001)")
    args = parser.parse_args()

    print(f"Loading model: {args.model} ...")
    model = load(args.model)
    print(f"Model loaded. Server starting on http://localhost:{args.port}")
    uvicorn.run(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()
