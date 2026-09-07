# Spine Studio

Local-first Spine animation studio for Windows. The project is being migrated from the owner's standalone HTML gallery to Tauri 2, strict TypeScript, WebGL, Rust, and native FFmpeg.

The original source and full requirements are preserved in `legacy/` and `docs/MASTER_SPEC.md`. The migration is in progress; this repository is not yet a validated production release. See `docs/IMPLEMENTATION_STATUS.md` for tested capabilities, blockers, and phase status.

## Development

Requires Node.js 22, npm, Rust stable, and the platform-specific Tauri 2 prerequisites. On Windows, install the Microsoft C++ Build Tools with Desktop development with C++ and WebView2.

```bash
npm install
npm test
npm run typecheck
npm run desktop:dev
```

Use `npm run desktop:build` to build a Windows installer after the required integration tests and licensing checks pass. An official Spine Editor license is required for users of the Spine Runtimes. No private assets, third-party runtime bundles, FFmpeg binaries, or proprietary project files are redistributed without permission.

## Architecture

The renderer is separate from the offline frame scheduler and native encoder. Runtime versions must match the exported Spine data; unsupported versions fail explicitly. Raw RGBA frames are transported with bounded backpressure. The encoder accepts validated application-level settings rather than arbitrary shell commands.

This repository is public. Do not commit proprietary Spine assets, company data, personal files, credentials, or unreviewed runtime modules.
