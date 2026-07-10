#!/usr/bin/env python3
"""
Minimal OpenAI-compatible Whisper transcription server.
Uses faster-whisper to run any Hugging Face Whisper model locally.

Usage:
  python3 whisper_server.py
  python3 whisper_server.py --model openai/whisper-large-v3-turbo --port 8000

Then point the app's STT provider to http://localhost:8000/v1/audio/transcriptions

Install deps first:
  python3.12 -m pip install faster-whisper fastapi uvicorn python-multipart
"""

import argparse
import io
import sys

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("Missing dependency. Install with:\n  python3.12 -m pip install faster-whisper fastapi uvicorn python-multipart")
    sys.exit(1)

try:
    from fastapi import FastAPI, UploadFile, File, Form
    import uvicorn
except ImportError:
    print("Missing dependency. Install with:\n  python3.12 -m pip install faster-whisper fastapi uvicorn python-multipart")
    sys.exit(1)

app = FastAPI(title="Local Whisper Server")
model: WhisperModel | None = None


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), model_name: str = Form(default="")):
    audio_bytes = await file.read()
    segments, info = model.transcribe(io.BytesIO(audio_bytes), beam_size=5)
    text = " ".join(seg.text for seg in segments).strip()
    return {"text": text}


@app.get("/health")
async def health():
    return {"status": "ok"}


def main():
    parser = argparse.ArgumentParser(description="Local Whisper transcription server")
    parser.add_argument("--model", default="openai/whisper-large-v3-turbo",
                        help="CTranslate2-format model ID (default: openai/whisper-large-v3-turbo)")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
    parser.add_argument("--device", default="auto", help="Device: auto, cpu, cuda, or mps")
    parser.add_argument("--compute-type", default="default", help="Compute type: default, int8, float16, etc.")
    args = parser.parse_args()

    global model
    print(f"Loading model: {args.model} (device={args.device}, compute_type={args.compute_type})...")
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    print(f"Model loaded. Server starting on http://localhost:{args.port}")
    uvicorn.run(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()