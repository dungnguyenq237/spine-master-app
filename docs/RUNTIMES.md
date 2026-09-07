# Runtime provisioning

No runtime bundles or legacy decoder were attached. Official npm packages are now pinned for 4.0.31, 4.1.56, 4.2.120 and 4.3.13; ordinary 4.x loading works through bundled modules without manual provisioning. The application deliberately refuses to guess compatibility or load JavaScript from asset folders.

For each required data version, provide the original reviewed official WebGL bundle with the matching major/minor version and its original license. The supported structural adapter routes are 3.5, 3.6, 3.7, 3.8, 4.0, 4.1 and 4.2. A bundle must expose `window.spine_4_2` (or the corresponding underscore version), including the official `webgl` namespace. ESM bundles must be bundled into that global at build time; do not rename an ESM file to JS.

```sh
npm run runtime:add -- 4.2 /absolute/path/spine-4_2.js EXPECTED_SHA256
```

The command copies a trusted build input to `public/runtimes`, verifies its supplied SHA-256, and writes the local manifest. Browser subresource integrity checks the bundle on load. These generated vendor files are ignored by git. Keep the original version/provenance/license alongside your distribution inputs. A checksum prevents unnoticed changes; it does not establish provenance or semantic compatibility.

The unsafe 4.3 folder-module path is removed and replaced by the official npm 4.3 adapter. The 3.4 decoder path remains blocked pending reviewed source and fixtures. JSON export alone does not make mismatched runtimes compatible.

Current official sources: https://github.com/EsotericSoftware/spine-runtimes and https://esotericsoftware.com/spine-versioning . License: https://en.esotericsoftware.com/spine-runtimes-license .
