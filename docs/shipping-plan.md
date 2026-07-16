# Assistant — Shipping Plan (v2)

**Updated:** 2026-07-14 · **Branch:** `dev` · **Goal:** ship a Mac app people **download and double‑click to install** — no npm, no terminal.

> `npm run tauri dev` is a **developer-only** tool (testing, bug fixes, features).
> End users should never see npm. They download a `.dmg`, drag the app to
> Applications, and open it.

> **Executable spec:** the exact, code-level steps to implement Phases 1–3 (with
> every config diff, the entitlements/Info.plist files, and the release
> workflow) live in
> [`docs/superpowers/plans/2026-07-14-installable-macos-release.md`](superpowers/plans/2026-07-14-installable-macos-release.md).
> That file is self-contained and can be handed to another engineer or agent to
> execute task-by-task. Tasks 1–6 need no Apple account; Tasks 7–8 need it.

> **Parallel track — UI redesign:** a distinct, work-oriented visual identity
> ("Slate & signal") and a dashboard-first layout are specced in
> [`docs/design/ui-redesign-slate-and-signal.md`](design/ui-redesign-slate-and-signal.md).
> This is a separate, weeks-scale frontend effort from packaging below — the two
> can run in parallel. It replaces the fork-generic overlay look with a serious
> instrument aesthetic and moves the app from "movable bar + popover" to a big
> dashboard with the overlay kept as an optional pop-out.

---

## The goal in one line

A **notarized `.dmg`** on GitHub Releases: the user downloads it, drags
**Assistant** into Applications, opens it, grants mic/screen permission, lets
the speech models download on first run, and starts using it — with **no
Gatekeeper warning**.

---

## Where we are (2026-07-14)

**Done**
- Core STT features on `dev`: ITN, Silero VAD, offline speaker diarization —
  all in‑process via `fluidaudio-rs` (macOS 14+, no external runtime).
- Debug hygiene restored: **zero `console.log` in `src/`**; app `build.rs` is
  stripped to `tauri_build::build()`.
- `minimumSystemVersion` = `14.0`; app icons present under `src-tauri/icons/`.
- A production bundle already builds: `npm run tauri build` →
  `.app` + `.dmg` in `src-tauri/target/release/bundle/`.

**Not done — this plan**
- **No code signing / notarization.** This is the one hard gate. An unsigned
  build is blocked by Gatekeeper ("Assistant is damaged" / "unidentified
  developer"), which is the opposite of "installs like a regular app."
- `version` is still `0.1.9`; no bundle metadata (publisher / copyright /
  category); identifier is the placeholder `com.assistant.local`.
- No release CI that signs + notarizes + attaches the `.dmg` to a Release.
- STT runtime distribution not finalized (in‑process fluidaudio vs the Python
  Whisper sidecar under `whisper_server.py` / `.whisper-venv`).

---

## Distribution channel (decided by constraints, not preference)

`tauri.conf.json` sets `macOSPrivateApi: true` (the always‑on‑top NSPanel), and
the app uses system‑audio capture, screen capture, and global shortcuts. The
**Mac App Store is not viable** (private APIs + sandbox conflicts). The path is:

> **Developer ID signing + Apple notarization + direct download (GitHub Releases).**

This is the standard, well‑trodden route for utilities like this.

---

## Phase 0 — Decisions to make first (yours to call; everything else waits on these)

- [ ] **Enroll in the Apple Developer Program** ($99/yr). Required for a
  Developer ID certificate and notarization. There is **no technical
  substitute** — without it, "download and double‑click" is impossible.
- [ ] **Scope STT for the first macOS release.** Recommended: **fluidaudio‑only**
  (in‑process, no Python, models download at first run) and **defer the Whisper
  Python sidecar on macOS**. Bundling Python + venvs + models into a *signed*
  app is a large, separate effort (the old "Path A"); it should not gate v1.
- [ ] **Pick real app identity:** bundle identifier (e.g. `com.<you>.assistant`),
  publisher name, copyright string.

---

## Phase 1 — Make the bundle release‑ready (config only, no signing yet)

- [ ] Bump `version` `0.1.9` → `1.0.0` (or `1.0.0-beta.1`) in `tauri.conf.json`.
- [ ] Replace the placeholder identifier; add `bundle.publisher`,
  `bundle.copyright`, `bundle.category` (`"Productivity"`).
- [ ] Add a macOS **entitlements** file for the permissions actually used
  (audio input, screen capture); reference it from `bundle.macOS.entitlements`.
  Required for a clean notarized run.
- [ ] Pin `bundle.targets` to `["app","dmg"]` for macOS (currently `"all"`).
- [ ] Verify the first‑run model‑download UX (`SttInitOverlay`) on a machine
  with **no cached models**, including a failure/retry path.
- [ ] `npm run tauri build` → confirm a `.dmg` is produced and the (still
  unsigned) app launches locally via right‑click → Open.

---

## Phase 2 — Sign + notarize (the gate)

- [ ] Create a **Developer ID Application** certificate; export it for CI
  (`APPLE_CERTIFICATE` base64 + `APPLE_CERTIFICATE_PASSWORD`).
- [ ] Signing env for `tauri build`: `APPLE_SIGNING_IDENTITY`,
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`.
- [ ] Notarization creds: `APPLE_ID` + app‑specific `APPLE_PASSWORD` +
  `APPLE_TEAM_ID` (or an App Store Connect API key:
  `APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH`). Tauri v2
  notarizes and staples automatically when these are set.
- [ ] Produce a signed + notarized `.dmg` and verify on a **second Mac / fresh
  user account** that it opens with **no Gatekeeper prompt**. That check is the
  literal definition of done for "installs like a regular app."

---

## Phase 3 — Release automation

- [ ] Rewrite `.github/workflows/publish.yml`: build on `macos-15` (Xcode 16),
  inject the signing + notarization secrets, run `tauri build`, and attach the
  `.dmg` to a GitHub Release triggered on a `v*` tag.
- [ ] Resolve the currently‑dead `TAURI_SIGNING_PRIVATE_KEY*` in `publish.yml`:
  those are **updater** signing keys (unrelated to Apple codesign). Remove them
  unless/until auto‑update is enabled in Phase 4.
- [ ] Tag `v1.0.0` → CI publishes the Release with the downloadable `.dmg`.

---

## Phase 4 — Optional polish (after the first installable release)

- [ ] Auto‑update via `tauri-plugin-updater` (set `createUpdaterArtifacts: true`,
  an updater endpoint, and the updater pubkey/private key) so installed apps
  update themselves.
- [ ] A short install page / README section: screenshot + "drag to Applications."
- [ ] Automated smoke test that the bundled app launches.
- [ ] Bundle size / code‑splitting (2.3 MB `index-*.js`).
- [ ] Revisit Whisper/Python STT for non‑macOS or as an optional post‑install
  download.

---

## Definition of done

A tagged GitHub Release carrying a **signed, notarized `.dmg`**. A
non‑technical user on a clean macOS 14+ machine downloads it, drags **Assistant**
to Applications, launches it with **no Gatekeeper warning**, grants mic/screen
permission, waits for the first‑run model download, and starts transcribing.
`npm` never enters their world.

---

## Key risks

- **No Apple Developer account = no clean install.** Phase 2 depends entirely on
  Phase 0. This is the gate, not a nice‑to‑have.
- **First‑run model download (~600 MB+)** — the overlay must handle slow/failed
  downloads gracefully; a user on bad wifi must not end up with a broken app.
- **Permission prompts** (microphone, screen recording, accessibility for global
  shortcuts) — must be requested with clear copy or first‑run feels broken.
- **Whisper Python sidecar** — if kept, it drags in Python + venvs that must
  themselves be signed and bundled; the single biggest scope risk. Defer it for
  the first macOS release.

---

## What changed from the previous shipping plan (2026-07-08)

- The STT strategy pivoted from **Path A (bundled Python/localhost sidecar)** to
  **in‑process fluidaudio** on macOS. The old plan's central "STT defaults to
  localhost / first‑run breaks" risk is largely resolved on macOS as a result.
- `minimumSystemVersion` is already at `14.0` (old plan targeted 13.5).
- The remaining release blockers are unchanged in spirit but reframed here
  around the concrete goal: **a notarized, double‑click‑installable `.dmg`.**
