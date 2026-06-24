#!/usr/bin/env python3
"""
Nemotron ASR server — OpenAI-compatible transcription endpoint using
mlx-community/nemotron-3.5-asr-streaming-0.6b on Apple Silicon.

Usage:
  python3.12 nemotron_server.py
  python3.12 nemotron_server.py --port 8001
  python3.12 nemotron_server.py --model mlx-community/nemotron-3.5-asr-streaming-0.6b-8bit

Endpoint: POST /v1/audio/transcriptions  (file + optional model fields)
          GET  /health
"""

import argparse
import io
import sys

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

app = FastAPI(title="Nemotron ASR Server")
model = None


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), model_name: str = Form(default="")):
    audio_bytes = await file.read()

    # Write to temp bytes for mlx-audio
    import tempfile, os
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
    parser = argparse.ArgumentParser(description="Nemotron ASR server (MLX)")
    parser.add_argument("--model", default="mlx-community/nemotron-3.5-asr-streaming-0.6b",
                        help="Model ID (default: mlx-community/nemotron-3.5-asr-streaming-0.6b)")
    parser.add_argument("--port", type=int, default=8001, help="Port (default: 8001)")
    args = parser.parse_args()

    print(f"Loading model: {args.model} ...")
    model = load(args.model)
    print(f"Model loaded. Server starting on http://localhost:{args.port}")
    uvicorn.run(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()