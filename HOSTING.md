# Hosting result

## Current live builds

- Online-enabled host: https://geometry-dash-classic-matty.decentdough2.chatgpt.site/game/index.html?perf
- Public GitHub Pages build: https://meatlover6447.github.io/geometry-dash-wasm/?perf
- Full source and game package: https://github.com/MeatLover6447/geometry-dash-wasm

The online host is public and opens without ChatGPT sign-in. Its small Worker streams compressed payloads from the exact GitHub commit `689eec1e50c83c36e4732dcd07dad990ced3a9f1` and forwards allowlisted game-service requests. No public CORS proxy or paid hosting account was added. All game resources remain available from GitHub.

Anonymous requests for the game page and content URL returned HTTP 200 after the public access change. Live checks returned HTTP 200 and valid responses for `getCustomContentURL.php` and `getGJLevels21.php`. Account login and online uploads have not been tested. GitHub Pages serves the full native game for built-in play, editor, saves, and FPS testing; online services require the online-enabled host.

The online host passed a real Chromium boot and built-in-level gameplay check with no browser errors or failed requests. The 20-second test measured **59.8 native FPS average**, with a **910 MiB WASM heap**, on this Windows machine. Cold first frame took 38.2 seconds including downloads. These are not Chromebook measurements. Raw results: `evidence/hosted-browser-check.json`.

The public Pages build also passed real-browser native boot and built-in-level gameplay: 59.8 native FPS average over 20 seconds, with no browser errors. Cold first frame took 25.2 seconds in that run. Raw results: `evidence/pages-browser-check.json`.

Use the **20s test** button while playing a level to measure average native FPS and WASM heap. First load downloads about 300 MB; the browser caches payloads for later visits. Browser saves are separate for each host.

[Performance mode](https://geometry-dash-classic-matty.decentdough2.chatgpt.site/game/?quality=performance&perf) selects 540p before loading. The public selector and saved preference were checked in Chromium. Four local 70,227-object level trials averaged 42.4 native FPS at 720p and 55.3 at 540p; these are Windows software-renderer measurements, not Chromebook results. The Performance UI is deployed as `appgdep_6aefee07d51c8191b6873dd5b389d5db`. Raw checks: `evidence/large-level-quality-comparison.json` and `evidence/performance-host-check.json`.

- Successful site deployment: `appgdep_6aef9fb4ceb88191a191bd5d71ed1399`
- Saved version: `appgprj_6aed464a31588191972c138547eda82a~appgver_1a744df2c8b08191ad7671a53bd4f74e`

The song fixes are deployed as build `00be722cca1c758b46070f3f`, deployment `appgdep_6aefe3d68ebc8191ad93c5903dd133ed`. Full public MP3 downloads passed for 404117, 1168082, and 590577. Song 10013017 passed native in-game playback with the final built runtime: decoded state 1, active unpaused source, gain 1, valid 217.73-second Ogg audio. The public host's loader hash was independently checked against this build. See `evidence/song-download-check.json`, `evidence/song-playback-final-check.json`, and `evidence/song-deployment-check.json`.

## Earlier deployment limit

The complete local browser build is ready. Run `Play.cmd` to start it.

Sites hosting did not publish: the required deployment archive is 301,449,084 bytes, exceeding its 256 MiB input limit (268,435,456 bytes). Both local archive upload and server-side build returned the size-limit failure. No game resources were removed to fit the limit.

Failure: `AppGen input archive exceeds the 256 MiB limit. Package only the required build output or configured static assets. Remove unused files or reduce large media, then package and upload again.`

- Site: `appgprj_6aed464a31588191972c138547eda82a`
- Saved version: `appgprj_6aed464a31588191972c138547eda82a~appgver_b34949cc137481919ec97dd66b0846c7`
- Failed deployment: `appgdep_6aef9c4218f88191a2c07aeed0c616b9`
- Pushed source commit: `0b3d4868344d871685da2ec1a2e37a4c3eb7a7aa`

The streaming deployment above resolves this archive limit. The local build still includes the full native game package and has no deployment upload limit.
