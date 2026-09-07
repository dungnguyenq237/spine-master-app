# Build and release notes

## Development

Install Node 22+, Rust stable, and Tauri 2 platform prerequisites. Windows needs Microsoft C++ desktop build tools and WebView2. macOS development requires Xcode command-line tools. A Windows installer must be built on Windows; macOS can run the native development app but cannot verify WebView2 behavior.

1. `npm install`
2. For legacy 3.x only, provision reviewed exact-version runtime bundles following RUNTIMES.md. Official 4.0–4.3 packages are installed by npm.
3. `npm run desktop:dev`
4. Choose a trusted local FFmpeg executable in the app (FFprobe beside it).
5. Import real Spine asset folders.

`npm run build` compiles TypeScript and builds frontend assets. `npm run desktop:build` creates an NSIS installer on Windows. To build a macOS application bundle use `npm exec tauri build -- --bundles app`. No automatic publishing/signing/update service is configured.

## Distribution dependencies

No FFmpeg binaries are bundled. This avoids silently selecting a distribution license/build. The app supports selecting an installed trusted executable. If bundling is added, pin source/build configuration and checksums, include corresponding license notices and source/source-offer obligations as applicable, and configure Tauri 2 sidecar target triples. Do not copy Tauri 1 sidecar patterns.

Spine Runtimes use the Spine Runtimes License Agreement, not MIT. Review the current agreement and your license before distribution. libx264-enabled FFmpeg builds commonly bring GPL obligations; evaluate the actual selected build and distribution model. The code does not claim a legal clearance.

## Deferred release gates

The user requested code first, without tests or test cases. No Windows integration, installer launch, fixture rendering, alpha compositing, decoded GIF timing, disk-full, malformed-file fuzzing, or benchmark validation is represented as passed. The runtime adapters require reviewed bundles and real fixtures. Phase 11 contains instrumentation and conservative limits, not benchmark-backed optimization. Phase 12 contains packaging/configuration/docs, not a validated distributable.

The cache is metadata-invalidated and 256 MiB bounded. Metadata-preserving source edits can require cache removal. Source assets are never uploaded. Process diagnostics are bounded to the latest 8 KiB; FFmpeg can include local filenames in errors.

Reference documentation: https://v2.tauri.app/start/prerequisites/ ; https://v2.tauri.app/distribute/windows-installer/ ; https://ffmpeg.org/legal.html .
