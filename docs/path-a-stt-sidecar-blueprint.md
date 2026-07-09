# Path A: Bundled Local STT Sidecar — Implementation Blueprint

**Status:** Abandoned. Superseded by `docs/fluidaudio-rs-blueprint.md`.
**Date:** 2026-07-08
**Goal (historical):** Zero-setup local STT — user installs the app, model downloads on first run, transcription works with no terminal, no Python install, no manual server startup.

## Architecture decision

Bundled Python 3.12 runtime + pre-installed venv as Tauri resources, launched as a managed sidecar process via `tauri-plugin-shell`.

Rationale: MLX's native Metal kernels (`libmlx.dylib`, `.metallib`) are fragile to freeze with PyInstaller. Shipping a real Python framework + venv is the most reliable approach — no import resolution surprises. The venv is built at `tauri build` time by a script, placed in `Resources/stt/` inside the `.app` bundle.

macOS-only (MLX is Apple-Silicon-only). Windows/Linux fall back to cloud STT (Groq) via the existing provider system.

## Existing patterns to follow

- **Tauri shell plugin** already initialized at `src-tauri/src/lib.rs:49` (`tauri_plugin_shell::init()`), imported in `src-tauri/src/speaker/commands.rs:14` (`ShellExt`).
- **Tauri commands** registered in `src-tauri/src/lib.rs:55-84` via `invoke_handler![]`. Pattern: `#[tauri::command]` fn in a module, registered in the handler array.
- **App state** managed via `tauri::Manager` — see `AudioState` at `src-tauri/src/lib.rs:17-22` (holds `Arc<Mutex<...>>` fields). Sidecar process handle follows the same pattern.
- **Frontend STT provider selection** in `src/contexts/app.context.tsx:112-115` — defaults to `local-parakeet`. Provider config in `src/config/stt.constants.ts`. Provider selection persists to localStorage via `STORAGE_KEYS.SELECTED_STT_PROVIDER`.
- **HTTP fetch** uses `tauriFetch` for `http://` localhost URLs. Capabilities whitelist `localhost:8001` at `src-tauri/capabilities/default.json:33-34`.
- **No existing sidecar/binary bundling** — `src-tauri/tauri.conf.json:46` bundles only `["info.plist", "assistant.desktop"]` as resources.

## Component design

### 1. Build script: `scripts/build_stt_bundle.sh`
Creates the bundled STT environment during `tauri build`.

Responsibilities:
- Download Python 3.12 embedded framework (or use system python3.12)
- Create a venv at `src-tauri/resources/stt/venv/`
- `uv pip install` parakeet-mlx, mlx, numpy, fastapi, uvicorn, librosa, python-multipart
- Copy `mlx_asr_server.py` into `src-tauri/resources/stt/`
- Verify MLX native libs are present in the venv site-packages
- Skipped on non-macOS (CI can skip for Windows builds)

### 2. Rust: `src-tauri/src/stt_sidecar.rs` (new module)
Manages the sidecar process lifecycle.

Responsibilities:
- `start_stt_sidecar(app: AppHandle)` — spawns `python mlx_asr_server.py --port 8001` from the bundled resources dir using `tauri-plugin-shell` `Command::new`
- `stop_stt_sidecar(state)` — kills the child process on app exit
- `check_stt_health()` — polls `http://localhost:8001/health` with retry loop (max 30s)
- Emits Tauri events: `stt-sidecar-starting`, `stt-sidecar-ready`, `stt-sidecar-error`, `stt-sidecar-stopped`
- State: `SttSidecarState { child: Arc<Mutex<Option<CommandChild>>>, status: Arc<Mutex<SttStatus>> }`

Tauri commands exposed:
- `get_stt_sidecar_status()` → `SttStatus` enum: `NotStarted | Starting | Ready | Error(String) | UnsupportedPlatform`
- `start_stt_sidecar()` — called from frontend on first run or when user selects local STT
- `stop_stt_sidecar()` — cleanup
- `download_stt_model(model_id)` — triggers model download into `~/Library/Application Support/com.assistant.local/models/`, emits progress events

### 3. Rust: `src-tauri/src/lib.rs` changes
- Add `mod stt_sidecar;`
- Register `SttSidecarState` in app state
- Register new commands in `invoke_handler`
- In `setup()`: on macOS, if default STT provider is `local-parakeet`, auto-start sidecar

### 4. Frontend: `src/hooks/useSttSidecar.ts` (new hook)
- Listens to `stt-sidecar-*` events
- Exposes `{ status, start, stop, downloadModel, downloadProgress }`
- On first run: if local STT selected and model not downloaded, show download progress UI
- Blocks STT capture until `status === Ready`

### 5. Frontend: `src/components/SttSetupOverlay.tsx` (new component)
First-run setup UI shown when local STT is selected but sidecar isn't ready:
- "Starting local transcription..." (during health-check wait)
- "Downloading speech model (600MB)..." with progress bar
- "Local STT unavailable — using cloud fallback" with a "Use Groq instead" button on error

### 6. Config changes
- `tauri.conf.json`: add `"resources": ["info.plist", "assistant.desktop", "resources/stt/**"]` (macOS only via conditional)
- `capabilities/default.json`: add `"shell:allow-execute"` and scope the sidecar binary
- `Cargo.toml`: no new deps (tauri-plugin-shell already present)

### 7. Model download strategy
- Default model: `mlx-community/parakeet-tdt-0.6b-v3` (~600MB)
- Storage: `~/Library/Application Support/com.assistant.local/models/`
- Download via Python subprocess: `python -c "from huggingface_hub import snapshot_download; snapshot_download('mlx-community/parakeet-tdt-0.6b-v3', local_dir=...)"` 
- Set `HF_HOME` env var to the app support dir so MLX caches there
- Progress: parse stderr or use `huggingface_hub`'s callback → emit Tauri events

## Data flow

```
App startup (macOS)
  → lib.rs setup()
    → if default STT == local-parakeet: stt_sidecar::start_stt_sidecar()
      → spawn python mlx_asr_server.py --port 8001
      → poll localhost:8001/health (retry, 30s max)
      → if model not cached: emit stt-sidecar-error("model_missing")
        → frontend shows SttSetupOverlay
          → user clicks "Download"
            → invoke download_stt_model()
              → Python subprocess downloads model
              → progress events → overlay progress bar
              → on complete: restart sidecar
      → on health OK: emit stt-sidecar-ready
        → frontend enables STT capture
        → useSystemAudio.ts WebSocket connects to ws://localhost:8001

App exit
  → stt_sidecar::stop_stt_sidecar()
    → kill child process
```

## Implementation map

| File | Action | Description |
|------|--------|-------------|
| `scripts/build_stt_bundle.sh` | **Create** | Build-time venv packaging script |
| `src-tauri/resources/stt/` | **Create (build-time)** | Bundled venv + server script |
| `src-tauri/src/stt_sidecar.rs` | **Create** | Sidecar lifecycle module |
| `src-tauri/src/lib.rs` | **Modify** | Add module, state, commands, setup hook |
| `src-tauri/tauri.conf.json` | **Modify** | Add resources glob, `beforeBuildCommand` to run bundle script |
| `src-tauri/capabilities/default.json` | **Modify** | Add `shell:allow-execute` + sidecar scope |
| `src/hooks/useSttSidecar.ts` | **Create** | Sidecar status hook |
| `src/components/SttSetupOverlay.tsx` | **Create** | First-run setup UI |
| `src/pages/app/components/speech/index.tsx` | **Modify** | Show overlay when sidecar not ready |
| `src/contexts/app.context.tsx` | **Modify** | Gate local STT on sidecar readiness; cloud fallback |

## Build sequence

### Phase 1: Sidecar lifecycle (Rust)
- [ ] Create `stt_sidecar.rs` with `start/stop/health-check`
- [ ] Register commands + state in `lib.rs`
- [ ] Add `shell:allow-execute` capability
- [ ] Test: manually start/stop sidecar from frontend invoke
- [ ] Verify health check polls correctly

### Phase 2: Build packaging
- [ ] Write `build_stt_bundle.sh`
- [ ] Run it locally to create `resources/stt/`
- [ ] Add resources glob to `tauri.conf.json`
- [ ] Add `beforeBuildCommand` hook (or separate npm script)
- [ ] Test: `tauri build` produces a `.app` with bundled venv
- [ ] Test: launching the built app starts the sidecar

### Phase 3: Model download UX
- [ ] Implement `download_stt_model` command
- [ ] Implement progress event emission
- [ ] Build `SttSetupOverlay.tsx` UI
- [ ] Wire into `speech/index.tsx`
- [ ] Test: fresh install → download → sidecar ready → transcription works

### Phase 4: Fallback + polish
- [ ] Auto-fallback to Groq if sidecar fails after 30s
- [ ] Settings UI: "Local STT (requires ~600MB download)" vs "Cloud STT"
- [ ] Handle sidecar crash recovery (restart on unexpected exit)
- [ ] Handle port conflict (8001 in use → error message)
- [ ] `npm run tauri build` verification

## Critical details

- **Bundle size**: venv + MLX + numpy ≈ 1.5-2 GB. Model (~600MB) downloaded on first run, not bundled. Total first-run footprint: ~2.5 GB.
- **Code signing**: the bundled Python binary must be signed or Gatekeeper will block it. Apple Developer ID required for the helper too.
- **App exit cleanup**: must kill child process or it becomes orphaned. Use `on_window_event` + `Drop` impl.
- **macOS minimum**: MLX requires macOS 13.5+. Set `minimumSystemVersion: "13.5"`.
- **Port conflict**: if 8001 is in use, sidecar should detect and fail gracefully → cloud fallback.
- **Sandboxing**: macOS App Sandbox would block sidecar process spawning. This app is not sandboxed (uses `macos-private-api`), so it works. Document this.
- **CI**: the `build_stt_bundle.sh` needs to run in GitHub Actions. CI runners have python3.12 available via `actions/setup-python`.
- **Dependencies to add to venv**: parakeet-mlx, mlx, numpy, fastapi, uvicorn, librosa, python-multipart, huggingface_hub.

## Prerequisites before starting implementation

- P1 #4: Bump version (set to 1.0.0-alpha.1 or desired)
- P1 #6: Add bundle metadata to `tauri.conf.json`
- P1 #7: Set `minimumSystemVersion: "13.5"` (MLX requirement)
- P1 #8: Decide on code signing (bundled Python binary needs signing)