import assert from 'node:assert/strict';
import {Script} from 'node:vm';

export function patchAssets(source) {
const before = `      try {
        var r;
        if (typeof DecompressionStream === 'undefined') {
          r = await fetch('gd_web.wasm?v=' + version(), {cache: attempt ? 'reload' : 'force-cache'});`;
const after = `      try {
        if (m.wasm.nativeUrl) {
          // Preserve the fetch Response and stable URL so the browser can cache compiled WASM.
          var nativeResponse = await fetch(m.wasm.nativeUrl, {cache: attempt ? 'reload' : 'force-cache'});
          if (!nativeResponse.ok) throw new Error('Native WASM HTTP ' + nativeResponse.status);
          var nativeResult = await WebAssembly.instantiateStreaming(nativeResponse, imports);
          finish();
          return nativeResult;
        }
        var r;
        if (typeof DecompressionStream === 'undefined') {
          r = await fetch('gd_web.wasm?v=' + version(), {cache: attempt ? 'reload' : 'force-cache'});`;
assert.equal(source.split(before).length - 1, 1, 'Expected exactly one upstream WASM fetch branch');
source = source.replace(before, after);
new Script(source, {filename: 'optimized-assets.js'});
return source;
}
