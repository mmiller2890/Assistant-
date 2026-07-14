# Installable macOS Release — Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. Do the tasks in order; each ends in a commit.
> This plan is self-contained — you do **not** need any prior conversation.

**Goal:** Turn `assistant-dev` into a Mac app that ships as a signed, notarized
`.dmg` a user downloads and double-clicks to install. `npm` becomes a
developer-only tool.

**Architecture:** Tauri v2 desktop app. STT runs **in-process** on macOS via the
`fluidaudio-rs` crate (no Python at runtime; speech models download on first
run). Distribution is **Developer ID signing + Apple notarization + direct
download** from GitHub Releases. The Mac App Store is not an option because the
app uses `macOSPrivateApi` (NSPanel) plus system-audio/screen capture.

**Tech Stack:** Tauri 2, Rust (edition 2021), Vite/TypeScript frontend,
`fluidaudio-rs 0.14.1` (bundles a Swift package built by its `build.rs`),
GitHub Actions + `tauri-apps/tauri-action`.

## Global Constraints

Every task inherits these. Values in `<ANGLE_BRACKETS>` are filled once in Task 0.

- **Platform:** macOS **14.0+**, **Apple Silicon only**. `fluidaudio-rs` is
  arm64-only and its `build.rs` builds its Swift package for the **host arch
  only** — there is no working `x86_64-apple-darwin` build. Do not add Intel or
  cross-arch macOS targets.
- **Toolchain:** FluidAudio 0.14.1 requires **Swift 6 / Xcode 16**. Any macOS
  build (local or CI) must run under Xcode 16 (`sudo xcode-select -s
  /Applications/Xcode_16.app`).
- **Version parity:** the version string must match across
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json`.
- **Branching:** do this work on a branch off `dev` named
  `feat/installable-release`. **Never touch `main`** — it is the known-good
  safety branch and is checked out in a separate worktree.
- **Commits:** conventional-commit style, imperative mood. **Never add an AI
  co-author line** (repo rule in `AGENTS.md`).
- **Account gate:** Tasks 1–6 need no Apple Developer account and are fully
  implementable and testable now. Task 7 is written now but its *secrets* and a
  green run require the account. Task 8 requires the account to execute. Each
  account-gated step is marked **[NEEDS APPLE ACCOUNT]**.

### Fill-once values (Task 0)

| Placeholder | Meaning | Suggested value |
|---|---|---|
| `<IDENTIFIER>` | reverse-domain bundle id | `com.morganmiller.assistant` |
| `<PUBLISHER>` | human/company name | `Morgan Miller` |
| `<COPYRIGHT>` | copyright string | `© 2026 Morgan Miller` |
| `<VERSION>` | first release version | `1.0.0` |

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src-tauri/tauri.conf.json` | version, identifier, bundle metadata, targets, entitlements ref | 1, 2, 3, 5 |
| `src-tauri/Cargo.toml` | version parity | 1 |
| `package.json` | version parity | 1 |
| `src-tauri/Entitlements.plist` | **new** — hardened-runtime entitlements | 3 |
| `src-tauri/Info.plist` | **new (renamed from `info.plist`)** — usage-description strings merged into the app | 4 |
| `.github/workflows/publish.yml` | signed/notarized release CI | 7 |

---

## Task 0: Create the working branch and choose identity values

**Files:** none (branch + decisions only)

- [ ] **Step 1: Branch off `dev`**

```bash
cd assistant-dev
git checkout dev
git pull --ff-only    # if a remote dev exists; skip if local-only
git checkout -b feat/installable-release
```

- [ ] **Step 2: Decide the four fill-once values**

Write your chosen `<IDENTIFIER>`, `<PUBLISHER>`, `<COPYRIGHT>`, `<VERSION>`
somewhere (or just use the suggested values in the table above). Every later
task substitutes them literally.

- [ ] **Step 3: Confirm the toolchain**

Run: `swift --version`
Expected: Swift version **6.x**. If not, run
`sudo xcode-select -s /Applications/Xcode_16.app` and re-check.

---

## Task 1: Bump and synchronize the version

**Files:**
- Modify: `src-tauri/tauri.conf.json:4`
- Modify: `src-tauri/Cargo.toml:3`
- Modify: `package.json` (`"version"` field)

**Interfaces:**
- Produces: the single `<VERSION>` string all release tooling reads.

- [ ] **Step 1: Set the Tauri version**

In `src-tauri/tauri.conf.json`, change:

```json
  "version": "0.1.9",
```
to:
```json
  "version": "<VERSION>",
```

- [ ] **Step 2: Set the Cargo version**

In `src-tauri/Cargo.toml`, change line 3:

```toml
version = "0.1.9"
```
to:
```toml
version = "<VERSION>"
```

- [ ] **Step 3: Set the package.json version**

In `package.json`, change the `"version"` field from `"0.1.9"` to `"<VERSION>"`.

- [ ] **Step 4: Verify all three match**

Run:
```bash
grep '"version"' src-tauri/tauri.conf.json | head -1
grep '^version' src-tauri/Cargo.toml | head -1
node -e "console.log(require('./package.json').version)"
```
Expected: all three print `<VERSION>`.

- [ ] **Step 5: Verify the Rust side still resolves**

Run: `( cd src-tauri && cargo check )`
Expected: `Finished` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json
git commit -m "chore(release): bump version to <VERSION>"
```

---

## Task 2: Add bundle metadata and a real identifier

**Files:**
- Modify: `src-tauri/tauri.conf.json` (top-level `identifier`; `bundle` block)

**Interfaces:**
- Produces: a stable bundle identifier used by notarization and the installed
  app; publisher/copyright/category shown in Finder/Get Info.

- [ ] **Step 1: Replace the placeholder identifier**

In `src-tauri/tauri.conf.json`, change:

```json
  "identifier": "com.assistant.local",
```
to:
```json
  "identifier": "<IDENTIFIER>",
```

- [ ] **Step 2: Add publisher, copyright, category to the `bundle` block**

Find the `bundle` block. Add three keys immediately after `"targets"` (keep the
existing `icon`, `resources`, `macOS` keys). The block should read:

```json
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": false,
    "targets": "all",
    "publisher": "<PUBLISHER>",
    "copyright": "<COPYRIGHT>",
    "category": "Productivity",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": ["info.plist", "assistant.desktop"],
    "macOS": { "minimumSystemVersion": "14.0" }
  },
```

(`targets` and `resources` are corrected in Tasks 5 and 4 respectively — leave
them as-is for now.)

- [ ] **Step 3: Verify the config still parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('valid json')"`
Expected: `valid json`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore(bundle): set real identifier and add publisher/copyright/category"
```

---

## Task 3: Add hardened-runtime entitlements

Notarization requires the Hardened Runtime. A Tauri app with a WKWebview and
native audio capture needs JIT/unsigned-memory allowances plus the audio-input
entitlements. These currently sit — incorrectly — inside `info.plist`; move them
to a real entitlements file referenced by `bundle.macOS.entitlements`.

**Files:**
- Create: `src-tauri/Entitlements.plist`
- Modify: `src-tauri/tauri.conf.json` (`bundle.macOS`)

**Interfaces:**
- Consumes: nothing.
- Produces: `src-tauri/Entitlements.plist`, referenced from
  `bundle.macOS.entitlements`.

- [ ] **Step 1: Create `src-tauri/Entitlements.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- WKWebView / Tauri need JIT and writable-executable memory -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <!-- fluidaudio-rs links a static Swift lib and loads CoreML/Metal;
         disabling library validation avoids notarized-launch failures.
         Tighten later if a stricter set is proven to work. -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <!-- Audio capture -->
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.microphone</key>
    <true/>
</dict>
</plist>
```

- [ ] **Step 2: Reference it from `bundle.macOS`**

In `src-tauri/tauri.conf.json`, change:

```json
    "macOS": { "minimumSystemVersion": "14.0" }
```
to:
```json
    "macOS": {
      "minimumSystemVersion": "14.0",
      "entitlements": "Entitlements.plist"
    }
```

- [ ] **Step 3: Verify JSON + plist are well-formed**

Run:
```bash
plutil -lint src-tauri/Entitlements.plist
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('valid json')"
```
Expected: `src-tauri/Entitlements.plist: OK` and `valid json`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Entitlements.plist src-tauri/tauri.conf.json
git commit -m "chore(macos): add hardened-runtime entitlements file"
```

---

## Task 4: Make the usage-description strings actually apply

`info.plist` is currently listed under `bundle.resources`, which copies it as a
**data file** — it does **not** set the app's real `Info.plist` keys, so the
mic/screen prompts may show generic text. In Tauri v2 a file named `Info.plist`
(capital I) next to `tauri.conf.json` is **merged** into the generated
`Info.plist`. Rename it, drop the entitlement keys (now in `Entitlements.plist`),
and remove it from `resources`.

**Files:**
- Rename: `src-tauri/info.plist` → `src-tauri/Info.plist`
- Modify: `src-tauri/Info.plist` (remove the two entitlement keys)
- Modify: `src-tauri/tauri.conf.json` (`bundle.resources`)

- [ ] **Step 1: Rename the file**

```bash
git mv src-tauri/info.plist src-tauri/Info.plist
```

- [ ] **Step 2: Remove the entitlement keys from `src-tauri/Info.plist`**

Delete these lines (entitlements, not Info.plist keys — they now live in
`Entitlements.plist`):

```xml
  <!-- Hardened Runtime Entitlements -->
  <key>com.apple.security.device.microphone</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
```

The remaining file keeps `NSMicrophoneUsageDescription`,
`NSScreenCaptureUsageDescription`, `NSAudioCaptureUsageDescription`, and the
`NSPrivacyAccessedAPITypes` array.

- [ ] **Step 3: Drop it from `bundle.resources`**

In `src-tauri/tauri.conf.json`, change:

```json
    "resources": ["info.plist", "assistant.desktop"],
```
to:
```json
    "resources": ["assistant.desktop"],
```

- [ ] **Step 4: Lint the plist**

Run: `plutil -lint src-tauri/Info.plist`
Expected: `src-tauri/Info.plist: OK`.

- [ ] **Step 5: Build once and confirm the keys land in the app's Info.plist**

Run:
```bash
sudo xcode-select -s /Applications/Xcode_16.app
npm run tauri build -- --target aarch64-apple-darwin --no-bundle
```
Then, if a bundle was produced in a prior task, inspect it; otherwise do the
full build in Task 5 and run this check there:
```bash
plutil -p "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Assistant.app/Contents/Info.plist" \
  | grep -E "NSMicrophoneUsageDescription|NSScreenCaptureUsageDescription"
```
Expected: both keys present with the custom strings. (If `--no-bundle` skipped
the app, defer this exact check to Task 5 Step 3.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Info.plist src-tauri/tauri.conf.json
git commit -m "fix(macos): merge Info.plist usage strings instead of bundling as a resource"
```

---

## Task 5: Pin macOS bundle targets (drop the broken Intel path)

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`bundle.targets`)

- [ ] **Step 1: Restrict targets to app + dmg**

In `src-tauri/tauri.conf.json`, change:

```json
    "targets": "all",
```
to:
```json
    "targets": ["app", "dmg"],
```

- [ ] **Step 2: Full signed-less build (produces the `.dmg`)**

Run:
```bash
sudo xcode-select -s /Applications/Xcode_16.app
npm run tauri build -- --target aarch64-apple-darwin
```
Expected: build succeeds; artifacts appear under
`src-tauri/target/aarch64-apple-darwin/release/bundle/`:
- `macos/Assistant.app`
- `dmg/Assistant_<VERSION>_aarch64.dmg`

- [ ] **Step 3: Confirm the Info.plist merge (Task 4 verification)**

Run:
```bash
plutil -p "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Assistant.app/Contents/Info.plist" \
  | grep -E "NSMicrophoneUsageDescription|NSScreenCaptureUsageDescription|CFBundleShortVersionString"
```
Expected: the two usage strings appear, and `CFBundleShortVersionString` equals
`<VERSION>`.

- [ ] **Step 4: Confirm the app launches locally (unsigned)**

Because it is unsigned, Gatekeeper will block a double-click. Bypass for local
testing only:
```bash
xattr -dr com.apple.quarantine "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Assistant.app"
open "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Assistant.app"
```
Expected: the app window appears; the mic/screen permission prompts show the
custom strings from Task 4.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore(bundle): target app+dmg only (fluidaudio is arm64-only)"
```

---

## Task 6: Verify first-run model-download UX on a clean machine

No code change — a guarded verification that a fresh user isn't left with a
broken app while ~600 MB of speech models download. The overlay component is
`src/components/SttInitOverlay.tsx` and status comes from `stt_get_status`.

- [ ] **Step 1: Simulate a first run (clear cached models)**

FluidAudio caches models under the user's HuggingFace/app cache. Move it aside:
```bash
# Adjust if your cache path differs; this is the common location.
mv ~/Library/Application\ Support/FluidAudio ~/Library/Application\ Support/FluidAudio.bak 2>/dev/null || true
mv ~/.cache/huggingface ~/.cache/huggingface.bak 2>/dev/null || true
```

- [ ] **Step 2: Launch the built app and start a capture**

Open the app (from Task 5), select the **local-fluidaudio** provider, and start
system-audio capture.
Expected: `SttInitOverlay` shows "Preparing local speech models" and stays until
`asr_ready` (and `vad_ready`/`diarization_ready`) flip true; then capture works.

- [ ] **Step 3: Verify the failure path**

Turn off networking and repeat Step 2 with the cache still cleared.
Expected: the app surfaces an error (not a spinner forever). If it hangs, file a
follow-up bug — the overlay needs a timeout/retry. This is a **verification
gate**, not a code change in this task.

- [ ] **Step 4: Restore your cache**

```bash
mv ~/Library/Application\ Support/FluidAudio.bak ~/Library/Application\ Support/FluidAudio 2>/dev/null || true
mv ~/.cache/huggingface.bak ~/.cache/huggingface 2>/dev/null || true
```

- [ ] **Step 5: Commit (only if you changed code to fix a hang)**

If Step 3 required a fix, commit it:
```bash
git add -A
git commit -m "fix(stt): surface first-run model-download failures instead of hanging"
```
Otherwise skip.

---

## Task 7: Rewrite the release workflow for a signed, notarized macOS build

Writable now; a **green run needs the Apple secrets** (Task 8). Changes vs the
current file: build on `macos-15` under Xcode 16; **arm64-only** matrix (the
Intel/Linux/Windows rows are dropped for the v1 installable macOS release); add
Apple signing + notarization env; remove the dead updater keys.

**Files:**
- Modify (replace): `.github/workflows/publish.yml`

- [ ] **Step 1: Replace `.github/workflows/publish.yml` with:**

```yaml
name: "publish"

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

jobs:
  publish-macos:
    permissions:
      contents: write
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4

      # FluidAudio 0.14.1 needs the Swift 6 toolchain from Xcode 16.
      - name: Select Xcode 16
        run: sudo xcode-select -s /Applications/Xcode_16.app

      - name: Show Swift version
        run: swift --version

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: lts/*

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin

      - name: Install frontend deps
        run: npm ci

      - name: Build, sign, notarize & publish
        uses: tauri-apps/tauri-action@v0.5.16
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Apple code signing (Developer ID Application cert)
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          # Apple notarization (app-specific password flow)
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          tagName: v__VERSION__
          releaseName: "Assistant v__VERSION__"
          releaseBody: "Download the .dmg, open it, and drag Assistant to Applications."
          releaseDraft: true
          prerelease: false
          args: "--target aarch64-apple-darwin"
```

- [ ] **Step 2: Lint the workflow YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/publish.yml')); print('valid yaml')"`
Expected: `valid yaml`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci(release): sign+notarize arm64 macOS build under Xcode 16"
```

- [ ] **Step 4: [NEEDS APPLE ACCOUNT] Add repository secrets**

In GitHub → repo → Settings → Secrets and variables → Actions, add:

| Secret | How to get it |
|---|---|
| `APPLE_CERTIFICATE` | base64 of your exported **Developer ID Application** `.p12`: `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: <PUBLISHER> (TEAMID)` — from `security find-identity -v -p codesigning` |
| `APPLE_ID` | your Apple Developer account email |
| `APPLE_PASSWORD` | an **app-specific password** from appleid.apple.com (not your login password) |
| `APPLE_TEAM_ID` | your 10-char Team ID from the Apple Developer portal |

---

## Task 8: [NEEDS APPLE ACCOUNT] Produce and verify the first notarized release

**Files:** none (release operation + verification)

- [ ] **Step 1: Tag the release**

```bash
# Merge feat/installable-release into dev first (keep main untouched until you
# promote), then from the commit you want to ship:
git tag v<VERSION>
git push origin v<VERSION>
```
Expected: the `publish` workflow runs on `macos-15`, signs, notarizes, staples,
and creates a **draft** GitHub Release with `Assistant_<VERSION>_aarch64.dmg`.

- [ ] **Step 2: Download the `.dmg` from the draft release and verify signing**

```bash
# Mount the dmg, copy Assistant.app out, then:
codesign -dv --verbose=4 /Applications/Assistant.app 2>&1 | grep -E "Authority|TeamIdentifier|flags"
spctl -a -vvv -t install /Applications/Assistant.app
xcrun stapler validate /Applications/Assistant.app
```
Expected:
- `codesign` shows `Authority=Developer ID Application: <PUBLISHER> ...` and
  `flags=0x10000(runtime)` (Hardened Runtime).
- `spctl` prints `accepted` with `source=Notarized Developer ID`.
- `stapler validate` prints `The validate action worked!`.

- [ ] **Step 3: The real acceptance test — a clean machine**

On a **second Mac (or a fresh macOS user account) that never built this app**,
download the `.dmg` from the release, open it, drag Assistant to Applications,
and launch by double-click.
Expected: **no Gatekeeper warning**; the app opens, prompts for mic/screen
permission with the custom strings, downloads models on first run, and
transcribes. This passing is the definition of done.

- [ ] **Step 4: Publish the release**

In the GitHub Releases UI, edit the draft and click **Publish**. The `.dmg` is
now a public download.

---

## Self-Review

**Spec coverage** (against `docs/shipping-plan.md` v2):
- Phase 1 (bundle release-ready): Tasks 1–5 ✓ (version, metadata, entitlements,
  Info.plist, targets).
- Phase 2 (sign + notarize): Tasks 7–8 ✓.
- Phase 3 (release automation): Task 7 ✓.
- First-run UX risk: Task 6 ✓.
- Phase 0 decisions (Apple account, STT scope, identity): account gate is called
  out per-task; identity is Task 0; STT scope is fixed by the arm64-only,
  fluidaudio-in-process assumption in Global Constraints.
- Phase 4 (auto-update, install page, smoke test, bundle-size) is intentionally
  **out of scope** here — it is post-first-release polish.

**Placeholder scan:** no "TBD/handle appropriately" placeholders; every code and
config change is shown in full. `<ANGLE_BRACKET>` values are defined in Task 0
and substituted literally.

**Consistency:** `<VERSION>` is written to all three manifests in Task 1 and read
back in Tasks 5/7/8; `Entitlements.plist` created in Task 3 is referenced by the
`bundle.macOS.entitlements` added in the same task; `Info.plist` renamed in Task
4 is removed from `resources` in the same task.

**Known follow-ups (not blockers):** Task 6 Step 3 may reveal that the first-run
overlay needs an explicit download timeout/retry; if so it becomes its own bug
fix. Non-macOS (Linux/Windows) and the Whisper Python sidecar are deliberately
dropped from the installable v1 and can return as a later plan.
