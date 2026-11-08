# Changes and measured results

The native engine is Bog's compiled port. This build changes the browser wrapper, asset loader, serving layer, downloaded-audio path lookup, and an optional area-color control; it does not claim authorship of the original port. The original native WASM SHA-256 is `523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a`; it is retained in `upstream/wasm.gz`. The current engine adds 49 bytes for an opt-in visual-effects guard. The complete data-package hash remains unchanged.

## Startup comparison

Windows, isolated persistent Chrome 149 profiles, 1366×768 viewport, 720p game canvas, local server. Each warm trial restarted Chrome using the same profile. Both variants had identical native WASM and full game data. The experimental difference was native HTTP-response streaming. These startup runs did not enable the CPU profiler or debugger.

| Trial | Original first frame | Modified first frame | Original native menu | Modified native menu |
|---|---:|---:|---:|---:|
| Cold | 4.771 s | 4.942 s | 9.594 s | 9.810 s |
| Repeat 1 | 3.251 s | 2.599 s | 8.140 s | 6.971 s |
| Repeat 2 | 3.048 s | 2.635 s | 7.906 s | 7.008 s |
| Repeat mean | 3.150 s | 2.617 s | 8.023 s | 6.990 s |

Repeat startup improved by about **17% to first frame** and **13% to the native menu** in these two warm trials. The cold trial did not improve. This is a small local sample, not a general speed guarantee.

Chrome created roughly 13.6 MB of WASM code-cache files for the native-response variant; the original variant's WASM code-cache directory contained no compiled entries. The repeat native WASM requests had zero network transfer bytes. Raw results: `evidence/startup-comparison.json`.

## Rejected WebGL bridge experiment

Five upload paths accept a range of the existing heap, avoiding temporary typed-array views. The matrix-uniform path passes a heap range directly and avoids the JavaScript float-copy loop. The differential test produced identical pixels in nine cases, with matching buffer contents, zero-length behavior, clipped-range fallback, and GL errors.

A 10-second native gameplay diagnostic observed about 60 FPS and 17.9 ms frame p95 in both versions. CPU/task timing did not establish an improvement. **The graphics patch is not shipped**, since it added code without a demonstrated gameplay benefit. Raw diagnostic profiles and the rejected experiment are retained in `evidence/`; the production graphics bridge remains upstream code.

## Retained and rejected work

- The original native game logic, resources, and input shim are retained and credited upstream. The audio shim includes the AppData lookup fix below; the optional native color guard is described below.
- A Binaryen `-O2` experiment exceeded its five-minute resource bound and was stopped. A smaller cleanup pass changed only 40 bytes. Neither candidate was shipped.
- Compiled-module storage in IndexedDB was rejected after a real-browser test produced `DataCloneError`; no failing cache layer was added.
- The earlier seven-level recreation was discarded from the deliverable.

## Compatibility evidence

All three original executable code sections and 8,998 local resources matched the supplied installation. Patched runtime images differ in data/pointer sections and remain paired with the precompiled runtime. See `evidence/native-runtime-compatibility.json`.

An editor check created one object, saved, reloaded, and reopened the native level. The encrypted native save was 864 bytes before and after reload, byte-identical, with one decoded level object and no browser errors. See `evidence/native-save-check.json`. Two extended editor sessions encountered a native abort; its cause remains unresolved. This passing check does not establish exhaustive editor stability.

## Hosted builds

The complete package is uploaded to `MeatLover6447/geometry-dash-wasm`, with GitHub Pages deployed through Actions. Pages generates raw native WASM during deployment so it can serve the correct native HTTP response without committing a file over GitHub's file-size limit. The Pages CDN returned it with `application/wasm` and gzip encoding.

The online-enabled host deploys a 2.1 MB browser shell and restricted service bridge; it streams the original compressed payloads from a pinned GitHub commit. This resolves the host's 256 MiB deployment input limit without removing game resources. The host is now public and opens without ChatGPT sign-in. Live content-URL and online level-list requests both returned valid HTTP 200 responses. No paid hosting account was added.

Both hosted builds passed native boot and built-in-level gameplay in Chromium. Each 20-second test measured 59.8 native FPS average on this Windows machine, with a 910 MiB WASM heap. See `evidence/hosted-browser-check.json` and `evidence/pages-browser-check.json`. Chromebook performance, account login, and online uploads remain untested.

## Online song fixes

Newgrounds' legacy `/audio/download/<id>` endpoint returned browser-check HTML or rate-limit errors. The service bridge now resolves these addresses using the official `getGJSongInfo.php` response and validates the resulting download host. The current Geometry Dash content CDN is included in the allowlist. This applies to both the hosted Worker and local server.

Downloaded library music was recognized by the native filesystem, whose bare-name lookup prefers `/AppData/<filename>`, but the JavaScript audio bridge omitted that folder and did not normalize Windows backslashes. The runtime patch normalizes those filenames and adds the AppData lookup, leaving the native engine and audio decoding/playback implementation unchanged. The regression test verifies that both bare and Windows-style names open the downloaded Ogg file without falling through to an HTTP request.

Full public-host downloads passed for songs 404117 (7,651,704 bytes), 1168082 (7,507,661 bytes), and 590577 (9,817,931 bytes), all HTTP 200 with valid MP3 headers. See `evidence/song-download-check.json`.

With the final built runtime, native playback of 10013017 opened `/AppData/10013017.ogg` from the Windows-style filename, decoded 217.73 seconds of stereo audio, and started an unpaused native audio channel at gain 1. The public host's loader SHA-256 matches the tested build. See `evidence/song-playback-final-check.json` and `evidence/song-deployment-check.json`. No browser-only path override was used for this final check.

## Performance mode for large levels

A pre-boot selector adds Performance 540p (960×540), alongside Standard 720p and High 1080p. Standard stays the default. The selection is stored in this browser; an explicit `quality` URL parameter takes precedence. Resolution locks at boot, so changing it cannot reset a running level. The full native engine, physics, resources, and downloaded-song fixes remain unchanged.

Performance draws 43.75% fewer pixels than Standard. Four clean 10-second runs on a 70,227-object auto version of Change of Scene, ordered Standard/Performance/Performance/Standard, averaged **42.4 → 55.3 native FPS** (+30.5%); the mean of the two frame-p95 values fell **38.6 → 27.7 ms**. These tests used Windows headless Chromium with SwiftShader software rendering, without CPU throttling, CPU profiling, or GL-call instrumentation during the recorded samples. This is a small local comparison, not a Chromebook FPS guarantee. Raw results: `evidence/large-level-quality-comparison.json`.

A separate CPU-throttled diagnostic found most time in native WASM level processing. It confirmed existing native matrix caching and relatively small client-vertex uploads, so no additional state cache or upload-coalescing patch was shipped. Performance mode helps GPU-bound scenes; CPU-bound levels and the roughly 914 MiB WASM heap remain limitations.

## Optional reduced area colors

The supplied Chromebook is an HP 11mk G9 EE with a MediaTek Kompanio 500 and 4 GB RAM, already using 540p. A profile of How to platformer (104187415, 87,378 objects) found over half of sampled CPU time in the native `GJBaseGameLayer::processAreaTintGroupAction` routine. Lower resolution and the game's LDM flags do not remove that work.

A default-off checkbox skips this color routine using a 24-byte guard and the existing native RET helper. The original instruction stream remains exact after the guard, every other function body is unchanged, and resumed native calls always retain the original path. Parent transition timers and the native movement/collision routines remain present. Skipping tint interpolation changes some level colors, which is stated beside the checkbox. The setting applies at boot and never edits save files or level data.

Four clean 10-second samples in one running scene, ordered Full/Reduced/Reduced/Full, measured **23.18 / 59.25 / 58.91 / 23.85 native FPS**. The two-sample means are **23.51 → 59.08 FPS**; mean frame-p95 falls **45.85 → 18.95 ms**. These are Windows headless Chromium/SwiftShader results at 540p with CDP CPU throttling 4, in the stationary first room. CPU throttling is not ARM hardware emulation. No CPU profiler or GL-call instrumentation ran during these samples.

The same comparison on iSpyWithMyLittleEye (89886591, 42,014 objects) measured **32.10 → 31.65 FPS**, providing no benefit in its tested opening/repeated early deaths. Later sections and actual Chromebook FPS remain unchecked. This option targets area tinting; it is not a universal fix for animation-heavy levels.

The full candidate validates in V8. Tests verify deterministic output, input integrity, unchanged other function bodies, flag-off behavior, guest stack/return-address handling, preserved registers, and native resume fallback. A final build booted with the real exported flag set to 1, without a test-time WASM replacement. The native heap still reached 1,100 MiB on How to platformer. Compiler-local cleanup and general low-detail experiments were not shipped because they did not establish a reliable benefit. Raw results: `evidence/reduced-area-colors-comparison.json` and `evidence/reduced-area-colors-patch.json`.
