# Assistant 🚀

A lightning-fast, privacy-first AI assistant that works seamlessly during meetings, interviews, and conversations without anyone knowing.

This is a **local-only fork** of the open-source [Pluely](https://github.com/iamsrikanthnani/pluely) project. The hosted cloud API, license activation, auto-updater, and all telemetry have been removed. It runs entirely against your own configured providers — including built-in support for **Ollama** and local **Whisper**/**Nemotron** STT servers.

## ✨ Features

- **Stealth Overlay** — translucent, always-available assistant window that's invisible during screen shares and recordings.
- **Bring Your Own Provider** — any LLM or speech-to-text provider configurable via curl, with full streaming support.
- **Ollama by Default** — works out of the box against a local Ollama instance; no API keys required. Detects installed models automatically.
- **Local STT** — run Whisper (faster-whisper) or NVIDIA Nemotron (mlx-audio) locally for fully offline speech-to-text.
- **Audio Capture** — system + microphone audio transcription with VAD.
- **Screenshot Analysis** — capture and send screenshots to your vision-capable model.
- **System Prompts** — create, edit, and switch AI behavior profiles.
- **Customizable** — autostart, app-icon visibility, always-on-top, cursor style, global shortcuts.
- **No Cloud, No Telemetry** — nothing phones home; all requests go directly from your device to your provider.

## 🛠 Tech Stack

- **Frontend:** React 19 + TypeScript 5.8 + Tailwind CSS 4 + Vite 7
- **Desktop:** Tauri 2 (Rust backend)
- **Local AI:** Ollama (`localhost:11434`)
- **Local STT:** faster-whisper (`localhost:8000`) or mlx-audio Nemotron (`localhost:8001`)

## 📦 Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)
- [Ollama](https://ollama.com/) installed and running

  ```bash
  # Pull a model
  ollama pull llama3.2
  ```

- (Optional) Python 3.12 for local STT servers

  ```bash
  # For faster-whisper STT
  python3.12 -m venv .whisper-venv
  .whisper-venv/bin/pip install faster-whisper fastapi uvicorn python-multipart

  # For Nemotron STT (Apple Silicon only)
  python3.12 -m venv .nemotron-venv
  .nemotron-venv/bin/pip install "git+https://github.com/Blaizzy/mlx-audio.git" fastapi uvicorn python-multipart
  ```

## 🚀 Getting Started

```bash
# Clone
git clone <your-repo-url>
cd assistant

# Install frontend dependencies
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

## 🔧 Configuration

1. Start Ollama:
   ```bash
   ollama serve
   ```
2. Launch the app (`npm run tauri dev`).
3. Open the dashboard (`Cmd+Shift+D` / `Ctrl+Shift+D`).
4. The default AI provider is **Ollama** — the app auto-detects installed models. Pick one in **Dev Space → AI Providers**.
5. Configure a **Speech-to-Text** provider in **Dev Space → STT Providers** (Ollama does not provide STT).

### Local STT Servers

#### Option A: faster-whisper (recommended, all platforms)
```bash
. .whisper-venv/bin/activate
python3.12 whisper_server.py --model Systran/faster-whisper-large-v3
```
Serves at `http://localhost:8000/v1/audio/transcriptions`.

Available models: `Systran/faster-whisper-tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`.

#### Option B: NVIDIA Nemotron via mlx-audio (Apple Silicon only)
```bash
. .nemotron-venv/bin/activate
python3.12 nemotron_server.py
```
Serves at `http://localhost:8001/v1/audio/transcriptions`.

Model: `mlx-community/nemotron-3.5-asr-streaming-0.6b` (600M, bf16, 35 languages, streaming).

### Supported AI Providers

Ollama, OpenAI, Claude, Gemini, Grok, Groq, Mistral, Cohere, Perplexity, OpenRouter — plus any custom provider via curl.

### Supported STT Providers

Local Whisper, Local Nemotron, OpenAI Whisper, Groq Whisper, ElevenLabs, Google, Deepgram, Azure, Speechmatics, Rev.ai, IBM Watson — plus any custom provider via curl.

## 🔒 Privacy

- No analytics, no usage tracking, no telemetry.
- All API calls go directly from your device to your chosen provider.
- No proxy servers, no middleware, no data collection.
- The auto-updater has been disabled; updates are managed manually.
- License checks are bypassed — all features are unlocked.

## 📁 Project Structure

```
src/
  components/         # Shared React components
  config/             # Constants: providers, storage keys, shortcuts
  contexts/           # React context (app state)
  hooks/              # Custom hooks
  layouts/            # Page layouts
  lib/                # Core logic: AI/STT functions, storage, database
  pages/              # Route pages
  routes/             # React Router config
  types/              # TypeScript types
src-tauri/
  src/                # Rust source (window, capture, shortcuts, speaker)
  capabilities/        # Tauri permissions
  tauri.conf.json     # Tauri config
  Cargo.toml           # Rust dependencies
```

See [AGENTS.md](./AGENTS.md) for detailed architecture notes.

## 🧪 Development

```bash
npx tsc --noEmit       # Typecheck
npm run build          # Frontend build
cargo check --manifest-path src-tauri/Cargo.toml  # Rust check
```

## 📄 License

GPL-3.0 — inherited from the original [Pluely](https://github.com/iamsrikanthnani/pluely) project.

## 🙏 Acknowledgements

- [Pluely](https://github.com/iamsrikanthnani/pluely) — the original open-source project by [Srikanth Nani](https://github.com/iamsrikanthnani)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — CTranslate2-based Whisper inference
- [mlx-audio](https://github.com/Blaizzy/mlx-audio) — MLX audio models for Apple Silicon
- [Ollama](https://ollama.com) — local LLM runtime
- [Tauri](https://tauri.app) — desktop app framework