# Changes and measured results

The native engine is Bog's compiled port. This build changes the browser wrapper, asset loader, and serving layer; it does not claim authorship of the original port. The native WASM SHA-256 remains `523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a`, and the complete data-package hash remains unchanged.

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

- The original native WASM, game logic, resources, and input/audio shims are retained and credited upstream.
- A Binaryen `-O2` experiment exceeded its five-minute resource bound and was stopped. A smaller cleanup pass changed only 40 bytes. Neither candidate was shipped.
- Compiled-module storage in IndexedDB was rejected after a real-browser test produced `DataCloneError`; no failing cache layer was added.
- The earlier seven-level recreation was discarded from the deliverable.

## Compatibility evidence

All three original executable code sections and 8,998 local resources matched the supplied installation. Patched runtime images differ in data/pointer sections and remain paired with the precompiled runtime. See `evidence/native-runtime-compatibility.json`.

An editor check created one object, saved, reloaded, and reopened the native level. The encrypted native save was 864 bytes before and after reload, byte-identical, with one decoded level object and no browser errors. See `evidence/native-save-check.json`. Two extended editor sessions encountered a native abort; its cause remains unresolved. This passing check does not establish exhaustive editor stability.

## Hosted builds

The complete package is uploaded to `MeatLover6447/geometry-dash-wasm`, with GitHub Pages deployed through Actions. Pages generates raw native WASM during deployment so it can serve the correct native HTTP response without committing a file over GitHub's file-size limit. The Pages CDN returned it with `application/wasm` and gzip encoding.

The online-enabled host deploys a 2.1 MB browser shell and restricted service bridge; it streams the original compressed payloads from a pinned GitHub commit. This resolves the host's 256 MiB deployment input limit without removing game resources. Its existing owner-private access is preserved. Live content-URL and online level-list requests both returned valid HTTP 200 responses. No paid hosting account was added.

Both hosted builds passed native boot and built-in-level gameplay in Chromium. Each 20-second test measured 59.8 native FPS average on this Windows machine, with a 910 MiB WASM heap. See `evidence/hosted-browser-check.json` and `evidence/pages-browser-check.json`. Chromebook performance, account login, and online uploads remain untested.
