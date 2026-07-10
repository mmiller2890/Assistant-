# Assistant Project Status & Shipping Plan
**Snapshot:** 2026-07-08 (updated) · **Repo:** assistant-dev (dev branch, clean) · **Target:** First public/local-only fork build

---

## P0 — COMPLETED

| # | Blocker | Status |
|---|---------|--------|
| 1 | Stabilize dirty tree | ✅ 2 commits: `36f6082` (cleanup) + `8197d60` (streaming STT). All checks green. |
| 2 | Remove debug console.logs | ✅ Zero `console.log` in `src/`. Swept 8 files. |
| 3 | Strip cloud env from build.rs | ✅ `build.rs` reduced to `tauri_build::build()`. `dotenv` dep removed from Cargo.toml. |
| 4 | STT distribution decision | ✅ Decided: Path A (bundled local STT sidecar). Blueprint saved to `docs/path-a-stt-sidecar-blueprint.md`. Implementation deferred — no deadline. |

**Verification:** tsc ✓, cargo check ✓, build ✓

---

## P1 — Before public/unsigned distribution

| # | Item | Status | Notes |
|---|------|--------|-------|
| 4 | Bump version | ☐ | `0.1.9` → `1.0.0-alpha.1` in `tauri.conf.json` |
| 5 | Remove unused `TAURI_SIGNING_PRIVATE_KEY*` from `publish.yml` | ☐ | Nothing consumes them |
| 6 | Add bundle metadata (publisher, copyright, category) | ☐ | Missing in `tauri.conf.json` |
| 7 | Set `minimumSystemVersion` | ☐ | `10.13` → `13.5` (MLX requires 13.5+) |
| 8 | Code signing decision | ☐ | Bundled Python binary needs signing. Apple Developer ID required for public Mac distribution. |

---

## P2 — Post-release / nice-to-have

| # | Item | Status |
|---|------|--------|
| 9 | End-user install & setup docs | ☐ |
| 10 | Automated smoke test | ☐ |
| 11 | Bundle size / code splitting (2.3MB `index-*.js`) | ☐ |
| 12 | Audit `shouldUseLocalAPI` stub reachability (15+ files) | ☐ |

---

## Path A — Bundled Local STT Sidecar

**Blueprint:** `docs/path-a-stt-sidecar-blueprint.md`
**Status:** Designed, not implemented. No deadline.

### Phases
- [ ] Phase 1: Sidecar lifecycle (Rust) — `stt_sidecar.rs`
- [ ] Phase 2: Build packaging — `build_stt_bundle.sh`
- [ ] Phase 3: Model download UX — `SttSetupOverlay`
- [ ] Phase 4: Fallback + polish

### Prerequisites (from P1)
- Bump version
- Add bundle metadata
- Set `minimumSystemVersion: "13.5"`
- Code signing decision (bundled Python binary must be signed)

---

## Key risks

- **STT defaulting to localhost** breaks first-run for non-technical users — Path A fixes this but is not yet implemented.
- **Unsigned macOS builds** blocked by Gatekeeper — limits public adoption.
- **No tests** — regressions in Tauri bundling/startup won't be caught automatically.
- **`shouldUseLocalAPI` stub** referenced in 15+ files — confirmed no-op per AGENTS.md but unaudited for reachability.

---

## Bottom line

P0 is done. The tree is clean, debug logs are gone, `build.rs` is stripped. Path A is designed and blueprinted. The remaining work before first release is P1 (version bump, CI cleanup, bundle metadata, signing decision). Path A implementation can proceed whenever ready — the blueprint has the full build sequence.