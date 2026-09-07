# Source audit and architecture decision

Input: the supplied 3,424-line HTML, preserved unchanged in `legacy/`. Repository baseline: commit 2a0a947, README only. No assets, runtimes, decoder, build configuration or tests were present.

## Audit

- Lines 917–994: global runtime/skeleton/image caches; seven external scripts `runtimes/spine-{3_5,3_6,3_7,3_8,4_0,4_1,4_2}.js`, none supplied. Actual runtime patch versions cannot be established.
- 999–1221, 2344–2560: intersection-aware delayed animation, twelve WebP frames per card; caches and decoded images grow with the entire gallery.
- 1264–1409: playback and seeking, absolute-time reset can break physics; automatic largest skin selection changes appearance.
- 1435–1533, 1665–1796: nearest-older runtime guessing, arbitrary folder-supplied 4.3 module execution, speculative binary version scanning.
- 1842–2256: renderer and atlas ownership; first-image fallback can bind the wrong page, modern atlas syntax forces 4.2 even for older binary data. Textures can be disposed twice. Renderer cleanup only clears the framebuffer.
- 2607–2793: folder grouping, same-basename JSON preference, basename-only folder comparison; eager full texture loading.
- 2794–3063: modal animation, pan, zoom, FPS, scrub. 3064–3192: independent sprite renderer, ceil(duration*FPS), first pose at zero, unbounded sheet canvas and data URL export.
- 3231–3424: multiple folder merging, recursive drop, search, keyboard zoom.
- The missing `skel34-decoder.js` has unknown provenance. No converted legacy format is treated as compatible.
- Context uses premultipliedAlpha=false; atlas-wide PMA detection is not proof of correct framebuffer/readback alpha. Mixed-PMA pages require explicit rejection until a per-slot implementation is validated.

## ADR: Tauri 2 / WebGL / native FFmpeg

Keep the source CSS, gallery/workspace interaction model and official JS runtime integration. Extract typed modules rather than move the unsafe monolith into a privileged webview. Rust owns approved roots, dialogs, scoped file reads, cache, native processes and output finalization. Binary IPC acknowledges one frame at a time. One export runs at a time.

A native C/C++ renderer would replace all existing integration, introduce native graphics and multi-version bindings, and still incur readback/encoder costs. There is no supplied fixture or executable to demonstrate a fidelity or throughput advantage. This is a desk evaluation, not a measured native spike; retain WebGL until evidence justifies replacement.

## Pipeline

Native metadata scan → exact skeleton/atlas/page resolution → version-matched trusted runtime → independent preview/export contexts. Export uses fixed simulation updates and sequential output sampling. Auto bounds uses a replay pass and stable union camera. Top-down straight RGBA transport is bounded to one acknowledged frame; native encoder writes into a unique staging directory. GIF uses a lossless FFV1 intermediate and separate global-palette pass. PNG and paginated sprite sheets use native PNG encoding. FFprobe checks encoded outputs before collision-safe finalization.

## Compatibility

| Data | Adapter route | Release status |
|---|---|---|
| 3.4 | None | Blocked: missing unreviewed decoder |
| 3.5–3.8 | Exact bundled global runtime | Requires original reviewed bundles; no fallback |
| 4.0–4.2 | Pinned official npm runtime modules | Adapter code present; fixtures unverified |
| 4.3 | Official npm 4.3.13 with explicit API differences | Adapter code present; fixtures unverified |
| Unknown/newer | None | Explicit error |

None of these routes is claimed fixture-validated in this code-only delivery. The trusted runtime provisioning command records SHA-256 and copies reviewed build inputs; asset folders can never supply executable runtime code.

## Risk register

1. No real fixtures/reference exports: blending, physics, timing and visual fidelity remain unverified.
2. Missing runtime bundles/legacy decoder: fail closed, supply reviewed original bundles through build provisioning.
3. No Rust/Windows toolchain in this environment: native compile/installer validation deferred.
4. WebGL alpha/blend semantics: documented straight-RGBA conversion, requires reference validation, especially additive blending.
5. Binary IPC cost and synchronous readback: instrumentation only; no performance claims.
6. Licensing: Spine uses its own license; FFmpeg obligations depend on selected build, especially libx264/GPL. No binaries redistributed here.
7. Geometric bounds exclude some screen-space/effect contributions: use custom crop and extra padding.

Sources: https://v2.tauri.app/develop/calling-rust/ ; https://en.esotericsoftware.com/spine-runtimes-license ; https://ffmpeg.org/ffmpeg-filters.html ; https://esotericsoftware.com/spine-versioning

## Implementation follow-up

Official npm package discovery found 4.0.31, 4.1.56, 4.2.120 and 4.3.13. These exact package versions are installed via aliases and locked. The 4.3 adapter handles renamed setup/skin methods, the new GLTexture PMA argument and the changed drawSkeleton signature; additive batching is disabled for transparent framebuffer alpha accumulation. Dependencies and licenses were inspected locally. This does not constitute visual validation.

Context compositing is explicitly premultipliedAlpha=true because the official blend pipeline accumulates associated RGB in the framebuffer; texture upload PMA is controlled independently. Canvas 2D readback then produces straight RGBA. This is a deliberate correction to the original false setting, and still requires edge/blend reference checks.
