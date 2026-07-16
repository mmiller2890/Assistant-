# UI Redesign — "Slate & signal" direction

**Date:** 2026-07-15 · **Status:** Direction chosen, not yet implemented

## Why

Assistant is a fork of [Pluely](https://github.com/iamsrikanthnani/pluely) and currently *looks* like it — a translucent, friendly, consumer-style overlay that's hard to tell apart from a dozen similar tools. The people who use this app are in high-stakes moments (job interviews, critical meetings) trying to change their lives. The UI should reflect that: **serious, work-oriented, calm, and trustworthy — a professional instrument, not a consumer widget.**

The goal is a distinct visual identity **and** a structural shift from "movable bar + popover dropdown" to a **dashboard-first** layout with the sleek overlay kept as an optional pop-out mode.

## The chosen mood: Slate & signal

Steel-dark surfaces, a single electric-blue accent used only as a *signal*, and monospace-forward labels. It reads like an engineering instrument / terminal — precise, technical, dependable. It's also the natural home for the planned **coding panel**.

### The four moves that make it distinct (from the fork)

1. **Structure over softness.** Machined steel surfaces and hairline-divided panels instead of glassy blur and floating rounded cards. Reads as an instrument panel.
2. **Monospace is the system's voice; sans is the human's.** Status line, labels, timestamps, metrics, and latency are all mono. The actual content (the question, the answer) is sans. This single split is what makes it feel technical rather than friendly.
3. **One accent, used as a signal light.** The electric blue appears *only* where something is live or actionable (listening dot, answer bracket, code chips, summary ticks). Everything else stays disciplined steel-gray. Restraint is what reads premium; forks lean on purple gradients.
4. **Information architecture, not a scrolling dropdown.** Fixed zones — transcript feed · live answer · session summary + status — each with one job, so the eye always knows where to look. This directly fixes the "scrolling and reading a lot in a dropdown is tedious" complaint.

## Palette (mockup values → become theme tokens)

These are the exact values from the reference mockup. In the real app they become theme tokens (which also sets up a future light variant cleanly).

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0E1116` | page / base steel |
| `--panel` | `#151A21` | panel surface (one step up) |
| `--elev` | `#1B222B` | elevated chips / inputs |
| `--line` | `#232B35` | hairline border |
| `--line2` | `#2E3947` | stronger border |
| `--tp` | `#E7ECF2` | text primary (cool off-white) |
| `--ts` | `#93A2B2` | text secondary (steel gray) |
| `--tm` | `#57646F` | text muted / meta |
| `--sig` | `#4DA3FF` | **the signal accent** (live / actionable only) |
| `--ok` | `#3FD99B` | status ok / connected (used sparingly) |

**Still to refine:** the exact accent (this blue can go cooler/cyan for more "terminal," or slightly warmer for less clinical) and a red/amber for error/warning states.

## Typography

- **System voice = monospace.** A real mono (JetBrains Mono, Berkeley Mono, or IBM Plex Mono) for the status line, labels, timestamps, metrics.
- **Human content = grotesk sans.** A characterful-but-professional grotesk (Geist, Söhne, or Inter used with discipline) for the question/answer body.
- Two weights only (400 / 500). Sentence case; lowercase mono labels read appropriately "terminal."

## Layout / information architecture

**Dashboard-first**, with two modes:

- **Dashboard (primary):** a normal, resizable window — the all-encompassing work view.
  - **Top:** statusline (`listening · 24:10 | claude · fluidaudio`).
  - **Left/center (~1.65fr):** live **transcript feed** (mono time + speaker tag) and the streaming **AI answer** (signal-blue left rule, mono `answer` label, code chips).
  - **Right rail (~1fr):** **session summary** (metric tiles: questions, speakers), the post-session bullet summary, and **provider/status** (on-device STT, model — mono values, green ok dots).
- **Pop-out (the sleek option):** the current always-on-top, screen-share-invisible bar — kept as an intentional *mode*, shown as a slim pill, not the whole app.

**Coding panel (future):** slots in as another zone/route next to the transcript (Monaco or CodeMirror), so a coding-interview question and the worked answer sit side by side. The dashboard-first structure is what makes this natural; the popover never could.

## How it maps to the current code (feasibility)

Investigated 2026-07-15. Good news: the hard pieces already exist.

- **Already multi-window.** The 600×54 overlay is the special always-on-top NSPanel (`main`); `src-tauri/src/window.rs` builds a **separate `dashboard` window** on demand (toggled by `⌘⇧D`). So a dashboard-primary + overlay-pop-out model is an extension, not a rebuild.
- **A full dashboard SPA already exists.** `src/routes/*` has a `DashboardLayout` wrapping ~10 routed pages (`/dashboard`, `/chats`, `/dev-space`, `/system-prompts`, `/shortcuts`, `/settings`, `/audio`, `/responses`, …).
- **The engine is UI-agnostic.** Capture, VAD, STT, providers, AI all live in hooks/lib (`useSystemAudio` + `hooks/system-audio/*`, `lib/functions/*`). None of it changes for a reskin/relayout.

**The real work, in order of effort/risk:**
1. 🟡 **Dashboard IA + reskin** in slate-and-signal tokens — the bulk, but normal frontend work, low risk.
2. 🔴 **Cross-window live state** — the one genuinely tricky part. The live capture session currently runs in the *overlay* window's React tree; separate windows are separate React trees. To show live transcript/answers in the big dashboard, sync capture state across windows via Tauri events or a shared store. Known pattern, a few focused days.
3. 🟢 **Make the dashboard primary** — open it on launch with normal chrome; keep the overlay as an opt-in pop-out. Mostly wiring.
4. **Coding panel** — separate future feature; fits the model.

**Alternative window model (avoids the 🔴 sync problem):** a *single* window that reshapes between "dashboard mode" (large, normal chrome) and "sleek bar mode" (small, borderless, always-on-top) by toggling window props at runtime. Same React tree, so no cross-window state. Easier, but the pop-out can't stay up *while* you use the dashboard. Decide based on whether simultaneous dashboard + floating pop-out matters.

## Recommended sequencing

1. **Finish the god-hook decomposition first** (assessment item #9 — `useSystemAudio` is still ~1,300 lines). A dashboard-first UI and any cross-window sync are dramatically easier against clean, focused hooks.
2. **Decide the window model** (multi-window + event sync, vs single reshaping window).
3. **Build the dashboard shell + IA** in slate-and-signal theme tokens.
4. **Wire live state** into the dashboard.
5. **Coding panel** later.

This is a **weeks-scale** frontend track, largely independent of the installable-`.dmg` packaging work (`docs/superpowers/plans/2026-07-14-installable-macos-release.md`) — the two can proceed in parallel.

## Caveats

- Still GPL-derived. A UI you design from scratch is a *good* candidate for clean original work if the relicense/rewrite path is ever pursued (see `docs/shipping-plan.md` license notes).
- The mockup below is a **concept skin** to react to, not final — the exact accent, typeface, and spacing rhythm still need dialing.

## Reference mockup

Self-contained HTML for the slate-and-signal concept (dark theme, works in any host). Drop into a preview to re-render it.

<details>
<summary>mockup HTML</summary>

```html
<style>
.si{--bg:#0E1116;--panel:#151A21;--elev:#1B222B;--line:#232B35;--line2:#2E3947;--tp:#E7ECF2;--ts:#93A2B2;--tm:#57646F;--sig:#4DA3FF;--ok:#3FD99B;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,sans-serif}
</style>
<div class="si" style="background:var(--bg);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-family:var(--sans);color:var(--tp);max-width:680px">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 15px;border-bottom:1px solid var(--line);background:var(--panel)">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:20px;height:20px;border-radius:5px;border:1px solid var(--sig);display:flex;align-items:center;justify-content:center"><span style="width:7px;height:7px;background:var(--sig);border-radius:2px"></span></div>
      <span style="font-size:14px;font-weight:500;letter-spacing:0.02em">Assistant</span>
    </div>
    <div style="font-family:var(--mono);font-size:12px;color:var(--ts);display:flex;align-items:center;gap:14px">
      <span style="color:var(--sig);display:inline-flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:var(--sig)"></span>listening</span>
      <span>24:10</span><span style="color:var(--tm)">|</span><span>claude</span><span style="color:var(--tm)">·</span><span>fluidaudio</span>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:minmax(0,1.65fr) minmax(0,1fr)">
    <div style="border-right:1px solid var(--line);padding:14px 15px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:11px">
        <span style="font-family:var(--mono);font-size:11px;color:var(--tm);padding-top:3px;min-width:36px">23:48</span>
        <div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--ts);margin-bottom:3px">interviewer</div>
          <div style="font-size:14px;line-height:1.6">Walk me through how you'd design a rate limiter for a public API.</div>
        </div>
      </div>
      <div style="border-left:2px solid var(--sig);padding:4px 0 6px 13px;background:var(--panel)">
        <div style="font-family:var(--mono);font-size:11px;color:var(--sig);margin-bottom:8px;padding-top:8px">answer</div>
        <div style="font-size:14px;line-height:1.65">Start with the algorithm: a token bucket per client key gives smooth bursts with a hard ceiling. Store counters in Redis with atomic <span style="font-family:var(--mono);font-size:12px;background:var(--elev);color:var(--sig);padding:1px 5px;border-radius:4px">INCR</span> + TTL, keyed by API key and window.</div>
        <div style="display:flex;gap:14px;margin-top:10px;font-family:var(--mono);font-size:11px;color:var(--tm)"><span>regen</span><span>copy</span><span style="margin-left:auto">0.4s</span></div>
      </div>
    </div>
    <div style="padding:14px 15px;display:flex;flex-direction:column;gap:15px">
      <div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--tm);margin-bottom:8px">session</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:9px 11px"><div style="font-family:var(--mono);font-size:21px;font-weight:500;line-height:1">6</div><div style="font-size:11px;color:var(--ts);margin-top:4px">questions</div></div>
          <div style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:9px 11px"><div style="font-family:var(--mono);font-size:21px;font-weight:500;line-height:1">3</div><div style="font-size:11px;color:var(--ts);margin-top:4px">speakers</div></div>
        </div>
      </div>
      <div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--tm);margin-bottom:8px">summary</div>
        <div style="font-size:13px;line-height:1.6;color:var(--ts)">
          <div style="display:flex;gap:8px;margin-bottom:7px"><span style="color:var(--sig);font-family:var(--mono)">–</span><span>Systems design: rate limiting, caching, idempotency.</span></div>
          <div style="display:flex;gap:8px"><span style="color:var(--sig);font-family:var(--mono)">–</span><span>Follow up: send the token-bucket sketch.</span></div>
        </div>
      </div>
      <div style="border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:9px;font-family:var(--mono);font-size:12px">
        <div style="display:flex;align-items:center;justify-content:space-between"><span style="color:var(--ts)">on-device stt</span><span style="color:var(--ok)">● fluidaudio</span></div>
        <div style="display:flex;align-items:center;justify-content:space-between"><span style="color:var(--ts)">model</span><span style="color:var(--ok)">● connected</span></div>
      </div>
    </div>
  </div>
  <div style="border-top:1px solid var(--line);background:var(--panel);padding:10px 15px">
    <div style="font-family:var(--mono);font-size:11px;color:var(--tm);margin-bottom:8px">pop-out — on top, invisible to screen share</div>
    <div style="display:flex;align-items:center;gap:12px;background:var(--bg);border:1px solid var(--line2);border-radius:8px;padding:8px 13px">
      <span style="width:7px;height:7px;border-radius:50%;background:var(--sig);flex-shrink:0"></span>
      <span style="font-size:13px;color:var(--tp);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Token bucket per key in Redis, atomic INCR + TTL…</span>
      <span style="font-family:var(--mono);font-size:12px;color:var(--tm);margin-left:auto;flex-shrink:0">⌘⏎</span>
    </div>
  </div>
</div>
```

</details>
