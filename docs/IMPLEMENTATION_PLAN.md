# Spine Studio implementation plan

Goal: implement the complete code path for the thirteen migration phases using the supplied spec, with no phase approval prompts and no tests/test cases per the user's latest instruction.

Architecture: strict TypeScript modules and Tauri 2 native commands. Source assets remain local; untrusted assets are data only. Original source is an immutable reference.

| Phase | Files/responsibilities | Code acceptance |
|---|---|---|
| 0 | docs/ARCHITECTURE.md, MASTER_SPEC.md | Source-grounded audit, explicit gaps and chosen architecture |
| 1 | package.json, vite.config.ts, src-tauri, src/ui | Desktop build configuration, preserved dark styling and native dialogs |
| 2 | src/core/assets.ts, src/core/version.ts, src/runtime | Exact versions/pages, safe paths, explicit ownership |
| 3 | src/render/renderer.ts, src/ui/preview.ts | Independent targets, playback/skin/seek, cleanup |
| 4 | src/export/schedule.ts | Trims, rational FPS, loops, endpoints, fixed-step replay |
| 5 | src/native/bridge.ts, src-tauri/src/jobs.rs, encoders.rs | Binary backpressure, safe process lifecycle, capabilities |
| 6 | encoder settings / H.264 branch | Explicit background, CRF presets, CFR, finalization |
| 7 | GIF encoder branches | Disk intermediate, global palette, dither, centisecond FPS |
| 8 | native image export, manifests | PNG sequence, bounded paginated sheets, ProRes/VP9 alpha |
| 9 | renderer camera/bounds | Replay union, padding, crop, supersampling limits |
| 10 | src/ui/gallery.ts, queue.ts, native cache | Metadata/lazy loading, bounded cache, batch/retry/cancel |
| 11 | src/export/metrics.ts | Stage timing, one-job policy; measured optimizations deferred |
| 12 | README, release docs, packaging | Build instructions and release limitations; no validated release claim |

Validation-oriented acceptance criteria from MASTER_SPEC remain deferred rather than represented as passed. Phase 11 benchmark-backed optimization and Phase 12 Windows validation cannot be completed honestly without running those activities.
