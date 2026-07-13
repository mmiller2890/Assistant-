# ITN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post-process every `local-fluidaudio` transcription with `itn_normalize_sentence` so spoken-form text becomes written-form before it is sent to the AI.

**Architecture:** Add one line of normalization inside the existing `transcribe_samples` Rust command, with a fallback to the raw transcript if normalization fails. No frontend or dependency changes.

**Tech Stack:** Rust, Tauri 2, fluidaudio-rs 0.14.1.

---

## Background

`fluidaudio-rs` exposes `itn_normalize_sentence(&text)` on the same `FluidAudio` instance used for ASR. It converts spoken-form expressions like "two hundred fifty dollars" into "$250". The app currently only returns the raw ASR text. This plan adds normalization immediately after transcription.

---

## Task 1: Read the current transcription command

**Files:**
- Read: `src-tauri/src/stt.rs:62-153`

- [ ] **Step 1: Open `src-tauri/src/stt.rs`**

  Read from line 62 (`transcribe_samples`) to the end of the file to understand the existing ASR path.

- [ ] **Step 2: Note the return shape**

  The function currently returns:
  ```rust
  Ok(serde_json::json!({
      "text": result.text,
      "confidence": result.confidence,
      "duration": result.duration,
      "processing_time": result.processing_time,
  }))
  ```
  Keep this shape; only change the value assigned to `"text"`.

---

## Task 2: Add ITN normalization after transcription

**Files:**
- Modify: `src-tauri/src/stt.rs`

- [ ] **Step 1: Replace the raw text return with normalized text**

  Find the block in `transcribe_samples` that builds the JSON response. Change it from:
  ```rust
  let result = audio
      .transcribe_samples(samples)
      .map_err(|e| e.to_string())?;
  Ok(serde_json::json!({
      "text": result.text,
      "confidence": result.confidence,
      "duration": result.duration,
      "processing_time": result.processing_time,
  }))
  ```
  to:
  ```rust
  let result = audio
      .transcribe_samples(samples)
      .map_err(|e| e.to_string())?;
  let text = audio
      .itn_normalize_sentence(&result.text)
      .unwrap_or(result.text.clone());
  Ok(serde_json::json!({
      "text": text,
      "confidence": result.confidence,
      "duration": result.duration,
      "processing_time": result.processing_time,
  }))
  ```

- [ ] **Step 2: Verify ITN method exists on the `FluidAudio` instance**

  Confirm that `audio` is of type `&FluidAudio` at this scope. The method `itn_normalize_sentence` is available in `fluidaudio-rs` 0.14.1.

---

## Task 3: Type-check the Rust change

**Files:**
- Test: `src-tauri/src/stt.rs`

- [ ] **Step 1: Run `cargo check`**

  Run:
  ```bash
  cargo check --manifest-path src-tauri/Cargo.toml
  ```

  Expected: command exits with no errors.

- [ ] **Step 2: If errors appear, fix them**

  Likely errors:
  - `itn_normalize_sentence` not found → ensure the `audio` variable is a `FluidAudio` reference and not moved earlier.
  - Type mismatch on `text` → ensure `text` is a `String` before serializing.

---

## Task 4: Commit to `dev`

**Files:**
- Commit: `src-tauri/src/stt.rs`

- [ ] **Step 1: Stage and commit**

  ```bash
  git add src-tauri/src/stt.rs
  git commit -m "feat(stt): add ITN post-processing to transcribe_samples"
  ```

- [ ] **Step 2: Push `dev`**

  ```bash
  git push origin dev
  ```

---

## Task 5: Cherry-pick to `feat/fluidaudio-rs` and `main`

**Files:**
- Cherry-pick commit onto: `feat/fluidaudio-rs`
- Cherry-pick commit onto: `main`

- [ ] **Step 1: Cherry-pick to `feat/fluidaudio-rs`**

  ```bash
  git checkout feat/fluidaudio-rs
  git cherry-pick <itn-commit-hash>
  git push origin feat/fluidaudio-rs
  ```

- [ ] **Step 2: Cherry-pick to `main`**

  ```bash
  git checkout main
  git cherry-pick <itn-commit-hash>
  git push origin main
  ```

- [ ] **Step 3: Return to `dev`**

  ```bash
  git checkout dev
  ```

---

## Verification checklist

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` passes.
- [ ] The commit exists on `dev`, `feat/fluidaudio-rs`, and `main`.
- [ ] Manual test: capture system audio saying "I paid two hundred dollars" with `local-fluidaudio` selected; the transcript shows "I paid $200".

---

## Notes

- ITN only runs on macOS because `local-fluidaudio` is the only code path that reaches `transcribe_samples`. Non-macOS providers use HTTP-based STT and are unaffected.
- If `itn_normalize_sentence` fails for any reason, the raw transcript is returned so transcription is never blocked.
- No frontend changes are needed because the JSON response shape is unchanged.
