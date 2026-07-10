# Local STT Provider Strategy — Final Plan

**Date:** 2026-07-10
**Branch:** `feat/fluidaudio-rs`
**Status:** Ready to implement

## Goal

Two zero-setup local STT providers that cover all platforms, plus cloud options as fallback. No Python venvs, no manual server startup, no terminal.

## Provider matrix

| Provider | Platform | Engine | Model | Setup | Status |
|----------|----------|--------|-------|-------|--------|
| `local-fluidaudio` | macOS Apple Silicon | fluidaudio-rs (CoreML/ANE) | Parakeet TDT v3 | Zero — in-process, auto-downloads on first use | ✅ Implemented |
| `local-whisper` | Windows, Linux, macOS Intel | whisper.cpp (bundled binary) | Whisper Large v3 Turbo | Zero — bundled sidecar, auto-starts on first use | ☐ To implement |
| Cloud providers | All platforms | HTTP to cloud API | Various | API key required | ✅ Already work |

## Changes to make

### 1. Remove redundant providers from `stt.constants.ts`

Remove `local-parakeet` and `local-nemotron`:
- `local-parakeet` is redundant with `local-fluidaudio` (same model, same platform, harder setup)
- `local-nemotron` is niche (40 languages vs Parakeet's 25), macOS-only, requires manual Python setup. Users who need it can add it as a custom provider.

Keep `local-fluidaudio`, `local-whisper`, and all cloud providers.

### 2. Update `whisper_server.py` default model

Change `--model` default from `Systran/faster-whisper-large-v3` to `openai/whisper-large-v3-turbo`.

### 3. Update `local-whisper` provider config in `stt.constants.ts`

- Rename: "Local Whisper (faster-whisper-server)" → "Local Whisper Turbo (whisper.cpp)"
- Update default `{{MODEL}}` variable to `openai/whisper-large-v3-turbo`
- Mark `platform: "windows-linux"` (not macOS Apple Silicon — `local-fluidaudio` covers that)

### 4. Remove `mlx_asr_server.py` and related docs

The MLX Python server (`mlx_asr_server.py`) is no longer needed — `local-fluidaudio` replaces it on macOS. Remove the file and any setup references in README/AGENTS.md. Keep `whisper_server.py` for now (used by `local-whisper` advanced users until whisper.cpp sidecar is implemented).

### 5. Platform gating in `app.context.tsx`

On first run:
- macOS Apple Silicon → default to `local-fluidaudio`
- Windows / Linux / macOS Intel → default to `local-whisper`
- If neither available → default to `groq` (cloud)

Settings UI should filter the provider dropdown by platform:
- macOS Apple Silicon: show `local-fluidaudio`, `local-whisper`, all cloud
- Windows/Linux/macOS Intel: show `local-whisper`, all cloud
- Show `local-fluidaudio` greyed out with tooltip "Requires macOS Apple Silicon" on non-Apple-Silicon

### 6. Future: whisper.cpp bundled sidecar (separate milestone)

Replace `whisper_server.py` with a bundled `whisper.cpp` binary:
- Download platform-specific `whisper.cpp` binary at build time
- Bundle as Tauri resource
- Auto-start as sidecar on `localhost:8000` when `local-whisper` is selected
- Same OpenAI-compatible HTTP endpoint — no frontend changes needed
- Eliminates Python dependency for `local-whisper` entirely

This is the cross-platform equivalent of `local-fluidaudio`: zero-setup, native binary, no Python.

## File changes

| File | Action | Description |
|------|--------|-------------|
| `src/config/stt.constants.ts` | **Modify** | Remove `local-parakeet` and `local-nemotron`. Rename `local-whisper` to "Local Whisper Turbo". Add `platform` field. |
| `src/types/provider.type.ts` | **Modify** | Already has `platform?: string` — no change needed. |
| `whisper_server.py` | **Modify** | Change default model to `openai/whisper-large-v3-turbo`. Update help text. |
| `src/contexts/app.context.tsx` | **Modify** | Platform-based default provider selection on first run. |
| `mlx_asr_server.py` | **Delete** | No longer needed — replaced by `local-fluidaudio`. |
| `README.md` | **Modify** | Remove MLX server setup instructions. Update to reflect `local-fluidaudio` as macOS default and `local-whisper` turbo as cross-platform option. |
| `AGENTS.md` | **Modify** | Remove `mlx_asr_server.py` references. Update STT provider list. |

## Provider list after changes

```
local-fluidaudio    — macOS Apple Silicon, CoreML, zero setup (DEFAULT on macOS)
local-whisper       — Windows/Linux/macOS Intel, faster-whisper, turbo model (DEFAULT on Windows/Linux)
groq                — Cloud, Groq Whisper, API key required (fallback)
openai-whisper      — Cloud, OpenAI Whisper, API key required
elevenlabs-stt      — Cloud, ElevenLabs, API key required
google-stt          — Cloud, Google, API key required
deepgram-stt        — Cloud, Deepgram, API key required
azure-stt           — Cloud, Azure, API key required
speechmatics-stt    — Cloud, Speechmatics, API key required
rev-ai-stt          — Cloud, Rev.ai, API key required
ibm-watson-stt      — Cloud, IBM Watson, API key required
```

## Build sequence

- [ ] Update `whisper_server.py` default model to turbo
- [ ] Remove `local-parakeet` and `local-nemotron` from `stt.constants.ts`
- [ ] Update `local-whisper` name and add `platform` field
- [ ] Delete `mlx_asr_server.py`
- [ ] Update `app.context.tsx` platform-based default selection
- [ ] Update README.md and AGENTS.md
- [ ] `npx tsc --noEmit` + `cargo check` + `npm run build` all green
- [ ] Commit and push