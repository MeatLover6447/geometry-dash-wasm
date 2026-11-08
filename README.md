# Geometry Dash — optimized native WASM build

This is a modified build of **Bog's existing native Geometry Dash port**. It runs the original game code and full resource package. It is not an independently recreated game, and I did not produce a fresh Emscripten recompilation from the Windows EXE.

The supplied installation is compatible with the runtime: all three executable `.text` sections and 8,998 resource files match byte for byte. The runtime's patched native images must remain in the package. The manifest identifies Geometry Dash 2.209 / Steam build 26002420.

## Play

- [Online-enabled host and FPS test](https://geometry-dash-classic-matty.decentdough2.chatgpt.site/game/index.html?perf) — public; no ChatGPT sign-in required.
- [Performance mode for slower devices](https://geometry-dash-classic-matty.decentdough2.chatgpt.site/game/?quality=performance&perf) — 540p rendering with the full native game.
- [Public GitHub Pages and FPS test](https://meatlover6447.github.io/geometry-dash-wasm/?perf) — built-in levels, editor, and browser saves; online services are unavailable here.

[HOSTING.md](HOSTING.md) describes the deployed builds and checks. First load downloads about 300 MB; repeat visits use the browser cache. Each host keeps separate browser saves.

GitHub Pages builds are created by `.github/workflows/pages.yml`. Run `node scripts/build-pages.mjs` to stage the same static build locally. The raw 123 MB WASM is generated only during deployment; the repository retains its original compressed payload, under GitHub's individual-file limit. Pages supports built-in levels, the editor, browser saves, and the FPS counter, but needs a backend for online game services.

Add `?perf` to the game URL to enable a 20-second native FPS test. Keep the tab visible and play a level during the test. This reports native frame-count averages; it does not measure total input-to-display latency.

Before loading, choose **Performance · 540p**, **Standard · 720p**, or **High · 1080p**. The selector remembers your choice in this browser. A `?quality=performance`, `?quality=standard`, or `?quality=high` URL takes precedence over the saved setting. Standard remains the default. Performance renders 43.75% fewer pixels than Standard; it trades image sharpness for lower GPU work without changing native physics. The setting locks once loading starts.

Double-click **Play.cmd** on Windows. Node.js is already installed on this computer. Or run `node serve.mjs` in this folder and open http://127.0.0.1:4174. Press Ctrl+C in the server window to stop it.

Use a recent Chrome or Edge with WebGL2 and WebAssembly JSPI. The browser checks these features before starting. The full package is about 300 MB compressed; the observed WASM heap grew to about 910 MiB, with additional browser memory on top.

The original game handles its menus, controls, levels, editor, and game modes. Progress and local levels save to IndexedDB in this browser. The **Save progress** button requests a native save. Keep the same hostname and port to retain access to those browser saves. Clearing site data or pressing Reset progress removes them.

## Changes made here

- WASM streaming preserves the original HTTP response and a stable content-addressed URL. This enables Chrome's compiled-code cache, which the original reconstructed responses did not populate in testing.
- The local server serves compressed WASM with the correct MIME type, content encoding, immutable caching, and a restricted bridge to the game's online services. Account traffic is not sent through public CORS proxy services.
- The wrapper defaults to 720p, excludes unrelated site scripts, and waits for saved files to finish restoring before native boot.
- Legacy Newgrounds download URLs resolve through Geometry Dash's official song metadata. Downloaded audio is read from the native game's AppData folder.

The original compressed asset format, chunk caching, input shim, audio implementation, game resources, and native WASM are upstream work. The audio runtime has one downloaded-file lookup fix. [CHANGES.md](CHANGES.md) includes the measured comparison and its limits.

## Rebuild and check

No dependency installation or compilation toolchain is needed to rebuild these JavaScript changes:

```text
node scripts/build-runtime.mjs
node tests/verify-build.mjs
node tests/server.test.mjs
node tests/audio-paths.test.mjs
node tests/worker.test.mjs
node tests/quality.test.mjs
```

The small patches are in `patches/`. The matching upstream loader and manifest are retained in `upstream/`, and raw comparison results are in `evidence/`. The build verifies the upstream hashes before applying the patches. It preserves the native WASM and full data-package hashes.

For the online host, `scripts/prepare-mirror.mjs` stages the browser shell and restricted service bridge. It streams the content-addressed payloads from an exact GitHub commit, keeping the complete game while fitting the host's deployment limit. The native WASM stays gzip-compressed in transit. This uses the existing host's access controls and requires no public CORS proxy.

## Verification limits

Native boot, menu navigation, level launch, input, and pause have been tested. An editor check created one object, saved the level, reloaded the browser, and confirmed identical native save bytes and the stored object. The result is in `evidence/native-save-check.json`.

Two extended editor sessions hit a native abort; short repeated editor checks and the save/reload check passed. The cause remains unresolved. Save regularly. Every level, account login, online uploads, and all platformer/editor features have not been exhaustively tested. No gameplay FPS improvement is claimed.

## Credits

Geometry Dash and its game code/artwork belong to RobTop Games; music belongs to its respective artists. The native-to-WebAssembly port and compatibility runtime are by **Bog**, as credited in the original game loading screen.

Original port: https://truffled.cv/games/geo/index.html

Compiled-file mirror and upstream credit: https://github.com/AlexBoops/geometry-dash-webport

Chrome WASM code-caching background: https://v8.dev/blog/wasm-code-caching
