# AGENTS.md

## Project Overview
Assistant is a local-only fork of the open-source Pluely project — a Tauri 2 + React desktop app that provides a stealth AI assistant overlay for meetings, interviews, and conversations. This fork removes all cloud features (hosted API, license activation, auto-updater, telemetry) and defaults to local providers (Ollama for AI, local Whisper/Nemotron for STT).

## Tech Stack
- **Frontend:** React 19, TypeScript 5.8, Tailwind CSS 4, Vite 7
- **Desktop:** Tauri 2 (Rust backend)
- **Local AI:** Ollama (`localhost:11434`)
- **Local STT:** faster-whisper server (`localhost:8000`) or mlx-audio Nemotron (`localhost:8001`)
- **Language:** TypeScript (frontend), Rust (backend)

## Commands

### Install
```bash
npm install
```

### Development
```bash
npm run tauri dev      # Full app (Rust + frontend)
npm run dev            # Frontend only (Vite, port 1420)
```

### Build
```bash
npm run build          # Frontend production build
npm run tauri build    # Full app bundle
```

### Typecheck & Lint
```bash
npx tsc --noEmit       # TypeScript typecheck (must pass before committing)
cargo check --manifest-path src-tauri/Cargo.toml  # Rust check
```
No linter is configured. Run `npx tsc --noEmit` and `npm run build` to verify changes compile.

## Project Structure
```
src/
  components/         # Shared React components (UI primitives, Sidebar, etc.)
  config/             # Constants: AI_PROVIDERS, STT providers, storage keys, shortcuts
  contexts/           # React context (app state: providers, license, settings)
  hooks/              # Custom hooks (useApp, useSettings, useCompletion, useSystemAudio)
  layouts/            # Page layouts (DashboardLayout, PageLayout, ErrorLayout)
  lib/                # Core logic: AI/STT functions, storage, analytics, database
  pages/              # Route pages (app, dashboard, chats, settings, dev, etc.)
  routes/             # React Router config
  types/              # TypeScript type definitions
src-tauri/
  src/                # Rust source (window mgmt, capture, shortcuts, speaker, API)
  capabilities/        # Tauri permissions (HTTP scopes, plugin permissions)
  tauri.conf.json     # Tauri config (productName, windows, updater, plugins)
  Cargo.toml          # Rust dependencies
```

## Key Architectural Notes

### Provider System
- AI and STT providers are defined as curl templates in `src/config/` (constants files).
- Variables like `{{API_KEY}}`, `{{MODEL}}`, `{{AUDIO}}` are extracted and replaced at runtime.
- The `extractVariables()` function in `src/lib/functions/common.function.ts` parses curl templates.
- Provider config is stored in localStorage and managed via `src/contexts/app.context.tsx`.

### Cloud Features (Removed)
- `shouldUsePluelyAPI()` in `src/lib/functions/pluely.api.ts` always returns `false`.
- `hasActiveLicense` in context always returns `true` (all features unlocked).
- `pluelyApiEnabled` always returns `false`.
- Analytics (`src/lib/analytics.ts`) are no-ops.
- Auto-updater is disabled (empty endpoint in `tauri.conf.json`).
- These stubs are kept for compile compatibility — do not re-enable them.

### HTTP Fetch
- `tauriFetch` (Tauri HTTP plugin) is used for `http://` URLs (local providers) to bypass CORS.
- Browser `fetch` is used only for `https://` URLs.
- See `src/lib/functions/stt.function.ts` and `ai-response.function.ts` line: `url?.startsWith("https") ? fetch : tauriFetch`.

### Local STT Servers
- `whisper_server.py` — faster-whisper server on port 8000 (venv: `.whisper-venv`)
- `nemotron_server.py` — mlx-audio Nemotron server on port 8001 (venv: `.nemotron-venv`)
- Both expose `POST /v1/audio/transcriptions` (OpenAI-compatible).
- Tauri capabilities in `src-tauri/capabilities/` whitelist `localhost:8000` and `8001`.

## Conventions
- No comments in code unless explicitly requested.
- Follow existing code style (Tailwind classes, component patterns).
- All UI text uses "Assistant" (not "Pluely") as the product name.
- Run `npx tsc --noEmit` and `npm run build` after any change to verify it compiles.
- Do not commit secrets, API keys, or tokens.