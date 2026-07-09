# Audio Pipeline Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix race conditions, stale closures, division-by-zero vulnerabilities, and hardcoded WebSocket URL in the Tauri audio capture / STT pipeline.

**Architecture:** Make the TypeScript streaming/batch paths mutually consistent by deriving the WebSocket URL from the selected provider, snapshotting conversation history via refs, and resetting per-utterance guards on stop. Harden Rust VAD by validating `hop_size` and `noise_gate_threshold`. Guard the continuous recording progress bar against zero duration.

**Tech Stack:** TypeScript 5.8 + React 19 (frontend), Rust + Tauri 2 (backend), Tailwind CSS 4.

---

## Background

Code review surfaced the following high-confidence issues in `src/hooks/useSystemAudio.ts` and `src-tauri/src/speaker/commands.rs`:

- `streamingFinalizedRef` only resets on WebSocket `onopen`, so a failed streaming socket skips the batch fallback and drops utterances.
- The batch STT path reads `conversation.messages` from an effect closure stale after the first utterance.
- WebSocket URL is hardcoded to `ws://localhost:8001`, ignoring configured provider URLs.
- A late WebSocket `is_final` can double-trigger `processWithAI` after `speech-detected` already ran the batch path.
- `hop_size = 0` causes an infinite loop / division by zero in Rust VAD.
- `noise_gate_threshold = 0.0` produces NaN/Inf in audio normalization.
- `max_recording_duration_secs = 0` divides by zero in the continuous recording progress bar.

---

## Task 1: Fix streaming/batch double-processing and guard lifecycle

**Files:**
- Modify: `src/hooks/useSystemAudio.ts:120-135` (refs)
- Modify: `src/hooks/useSystemAudio.ts:137-211` (`openStreamingSocket`)
- Modify: `src/hooks/useSystemAudio.ts:365-375` (`speech-detected` guard)
- Modify: `src/hooks/useSystemAudio.ts:781-813` (`stopCapture`)

- [ ] **Step 1: Add `batchProcessedForCurrentUtteranceRef`**

Add a new ref next to `streamingFinalizedRef`:

```typescript
const batchProcessedForCurrentUtteranceRef = useRef<boolean>(false);
```

- [ ] **Step 2: Reset guards at the start of `openStreamingSocket`**

Before creating the `WebSocket`, reset both flags so a failed connection still allows batch fallback:

```typescript
const openStreamingSocket = useCallback(() => {
  const providerConfig = allSttProviders.find(
    (p) => p.id === selectedSttProvider.provider
  );
  if (!providerConfig?.streaming) return;

  if (wsRef.current) {
    if (wsRef.current.readyState === WebSocket.OPEN) return;
  }

  // Reset per-utterance guards before attempting a new connection.
  streamingFinalizedRef.current = false;
  batchProcessedForCurrentUtteranceRef.current = false;

  try {
    const wsUrl = buildStreamingUrl(providerConfig, selectedSttProvider);
    const ws = new WebSocket(wsUrl);
    ...
```

Remove the reset from `ws.onopen`.

- [ ] **Step 3: Ignore late `is_final` when batch already ran**

In `ws.onmessage`, when `data.is_final` is true, check `batchProcessedForCurrentUtteranceRef.current`. If true, skip AI processing and only close the socket / clear partial text.

- [ ] **Step 4: Record batch processing in `speech-detected`**

Set `batchProcessedForCurrentUtteranceRef.current = true` right before calling `fetchSTT` (after the `streamingFinalizedRef` guard). When the guard trips because streaming already finalized, keep the existing early-return path.

- [ ] **Step 5: Reset all guards in `stopCapture`**

Add:

```typescript
streamingFinalizedRef.current = false;
batchProcessedForCurrentUtteranceRef.current = false;
```

- [ ] **Step 6: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors.

---

## Task 2: Fix batch STT stale conversation history

**Files:**
- Modify: `src/hooks/useSystemAudio.ts:424-436`

- [ ] **Step 1: Use ref snapshot for batch path**

In the `speech-detected` handler, replace the closure-captured `conversation.messages` with the ref:

```typescript
const previousMessages = conversationMessagesRef.current.map((msg) => ({
  role: msg.role,
  content: msg.content,
}));
```

Pass `previousMessages` to `processWithAI`.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 3: Derive streaming WebSocket URL from provider config

**Files:**
- Modify: `src/hooks/useSystemAudio.ts:136-148`

- [ ] **Step 1: Add `buildStreamingUrl` helper**

Add a small helper near the refs:

```typescript
function buildStreamingUrl(
  provider: TYPE_PROVIDER,
  selected: { provider: string; variables: Record<string, string> }
): string {
  // Prefer an explicit streaming URL if present, otherwise derive from curl.
  if (provider.streamingUrl) {
    return deepVariableReplacer(provider.streamingUrl, selected.variables);
  }
  const curlJson = curl2Json(provider.curl);
  const baseUrl = curlJson.url || "";
  const replaced = deepVariableReplacer(baseUrl, selected.variables);
  // Convert http/https scheme to ws/wss, preserving the rest.
  return replaced.replace(/^http/, "ws");
}
```

Import `curl2Json`, `deepVariableReplacer`, and `TYPE_PROVIDER` as needed.

- [ ] **Step 2: Replace hardcoded URL**

```typescript
const wsUrl = buildStreamingUrl(providerConfig, selectedSttProvider);
const ws = new WebSocket(wsUrl);
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 4: Harden Rust VAD config validation

**Files:**
- Modify: `src-tauri/src/speaker/commands.rs:651-658`

- [ ] **Step 1: Validate `hop_size` and `noise_gate_threshold`**

Inside `update_vad_config`, before storing config:

```rust
if config.hop_size == 0 {
    return Err("Invalid hop_size: must be > 0".to_string());
}
if config.noise_gate_threshold <= 0.0 {
    return Err("Invalid noise_gate_threshold: must be > 0.0".to_string());
}
if config.max_recording_duration_secs == 0 {
    return Err("Invalid max_recording_duration_secs: must be > 0".to_string());
}
```

- [ ] **Step 2: Defensive guard in `calculate_audio_metrics`**

Return early for empty chunks:

```rust
fn calculate_audio_metrics(chunk: &[f32]) -> (f32, f32) {
    if chunk.is_empty() {
        return (0.0, 0.0);
    }
    ...
}
```

- [ ] **Step 3: Run Rust check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: no errors.

---

## Task 5: Guard continuous recording progress bar division by zero

**Files:**
- Modify: `src/pages/app/components/speech/RecordingPanel.tsx:100-118`

- [ ] **Step 1: Clamp progress width**

Change width calculation:

```tsx
style={{
  width: `${maxDuration > 0 ? (recordingProgress / maxDuration) * 100 : 0}%`,
}}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 6: Frontend production build verification

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: build succeeds.

---

## Task 7: Commit and push

- [ ] **Step 1: Stage changes**

```bash
git add src/hooks/useSystemAudio.ts src-tauri/src/speaker/commands.rs src/pages/app/components/speech/RecordingPanel.tsx
git add docs/superpowers/plans/2025-07-09-audio-pipeline-fixes.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "fix(audio): harden streaming/batch STT handoff, VAD validation, and progress bar"
```

- [ ] **Step 3: Push**

```bash
git push origin feat/fluidaudio-rs
```

---

## Verification Summary

- `npx tsc --noEmit` passes.
- `cargo check --manifest-path src-tauri/Cargo.toml` passes.
- `npm run build` passes.
- Branch pushed to `origin/feat/fluidaudio-rs`.
