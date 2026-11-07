import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('(function () {\nvar fpsEl');
assert(start >= 0, 'FPS/benchmark IIFE exists');
const end = html.indexOf('\n})();', start) + 6;
assert(end > start, 'FPS/benchmark IIFE closes');
const code = html.slice(start, end);
new vm.Script(code);

let now = 0, count = 100, nextFrame;
const children = [], events = {document: {}, window: {}};
const element = () => ({
  textContent: '', disabled: false, style: {}, listeners: {},
  setAttribute() {},
  addEventListener(name, callback) { this.listeners[name] = callback; },
  appendChild(child) { children.push(child); },
});
const fps = element(), bar = element();
const document = {
  hidden: false,
  body: {classList: {add() {}}},
  getElementById(id) { return id === 'fpsval' ? fps : id === 'midbar' ? bar : null; },
  createElement: element,
  addEventListener(name, callback) { events.document[name] = callback; },
};
const Module = {
  _gd_frames_get: () => count,
  HEAPU8: {byteLength: 360 * 1048576},
  canvas: {focus() {}},
};
const window = {
  __gdRuntimeReady: true,
  addEventListener(name, callback) { events.window[name] = callback; },
};
vm.runInNewContext(code, {
  document, Module, window, location: {search: '?perf'},
  performance: {now: () => now},
  requestAnimationFrame: callback => nextFrame = callback,
  setProgress() {},
});
const [button, result] = children;
assert(button.disabled, 'test waits for the frame counter');
function advance(time, frames) { now = time; count = frames; nextFrame(time); }

advance(500, 100);
assert.equal(button.disabled, false);
button.listeners.click();
assert(button.disabled);
advance(10500, 700);
assert.equal(result.textContent, '');
assert.equal(button.textContent, 'Testing 10s');
advance(20500, 1300);
assert.match(result.textContent, /60\.0 native fps avg · WASM heap 360 MiB/);
assert.equal(button.disabled, false);
assert.equal(fps.textContent, '60 fps', 'normal FPS display remains active');

button.listeners.click();
document.hidden = true;
events.document.visibilitychange();
assert.match(result.textContent, /cancelled: game was hidden/);
assert(button.disabled);
document.hidden = false;
advance(21000, 1330);
button.listeners.click();
events.window.blur();
assert.match(result.textContent, /cancelled: game lost focus/);

advance(21500, 0xffffff00);
button.listeners.click();
advance(41500, 944);
assert.match(result.textContent, /60\.0 native fps avg/, '32-bit counter wrap preserves the average');
assert(!code.includes('gdBeginBenchmark'), 'no nonexistent start hook');
assert(!code.includes('gdBenchmark'), 'no nonexistent results hook');
console.log('Benchmark checks passed: native average, normal FPS, counter wrap, visibility and blur cancellation.');
