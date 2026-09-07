# Spine Studio

Local-first desktop gallery and offline export engine built with Tauri 2, strict TypeScript, official Spine WebGL runtimes, Rust, and native FFmpeg. The original dark gallery styling and standalone reference HTML are preserved.

## Run

Requires Node 22+, Rust stable, and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run desktop:dev
```

Spine 4.0–4.3 official runtimes are pinned and bundled through npm. Legacy 3.5–3.8 require the original reviewed runtime bundles; see [runtime provisioning](docs/RUNTIMES.md). The missing 3.4 decoder is not fabricated or silently replaced.

Choose a trusted FFmpeg executable in the app, with FFprobe beside it. PNG and sprite-sheet exports do not require FFmpeg. Then choose asset folders, open a skeleton, configure the export, choose an output folder and add jobs to the queue.

## Implemented code

- Native folder picker/drop ingestion, scoped recursive metadata indexing and exact atlas page resolution.
- Visibility-aware animated gallery, search, zoom, disk thumbnails, animation/skin workspace, pan, playback, scrubbing and FPS controls.
- Independent offline renderer, fixed-step sampling, trim/repeats/endpoints, animation bounds, custom framing and 1×/2×/4× supersampling.
- MP4 H.264, palette-based GIF, PNG sequences, bounded sprite-sheet pages, ProRes 4444 and VP9 alpha paths.
- Serial queue, batch animations, progress, cancellation/retry, output reveal, stage timings and collision-safe finalization.
- FFprobe/runtime decode checks before finalization. These checks execute when exporting; project tests were not run or created.

## Build

```sh
npm run build          # TypeScript compilation and frontend production build
npm run desktop:build  # Windows NSIS installer (run on Windows)
```

macOS can run development builds; Windows/WebView2 validation requires Windows. No compiled installer is included in this delivery.

## Status

**Implementation branch, not a validated production release.** Frontend compilation/build passed. Native Rust compilation, integration tests, visual reference validation, installer validation and benchmarks remain unperformed. The user explicitly requested code first without tests/test cases. See [phase status](docs/IMPLEMENTATION_STATUS.md), [architecture/audit](docs/ARCHITECTURE.md), [export semantics](docs/EXPORTS.md), and [release notes](docs/RELEASE.md).

The app keeps assets local. No telemetry, cloud upload, arbitrary shell command API, or asset-folder JavaScript execution. Spine runtime license notices are included in `public/licenses`; review the [Spine Runtimes License Agreement](https://en.esotericsoftware.com/spine-runtimes-license) before distribution. FFmpeg binaries are not redistributed.
