import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const qualityStart = html.indexOf('var gdQualityModes = ');
const qualityEnd = html.indexOf('\nvar GD_DEBUG', qualityStart);
assert(qualityStart >= 0 && qualityEnd > qualityStart);
const qualityCode = html.slice(qualityStart, qualityEnd);
const bootStart = html.indexOf('var started = false;');
const bootEnd = html.indexOf("\ndocument.getElementById('loadFly').addEventListener", bootStart);
assert(bootStart >= 0 && bootEnd > bootStart);
const bootCode = html.slice(bootStart, bootEnd);
const keyboardStart = html.indexOf("document.addEventListener('keydown', function (e) {\nif (e.target === gdQualitySelect)");
const keyboardEnd = html.indexOf('\n});', keyboardStart) + 4;
assert(keyboardStart >= 0 && keyboardEnd > keyboardStart);
const keyboardCode = html.slice(keyboardStart, keyboardEnd);
const inputCode = fs.readFileSync(new URL('../dist/gd_input.js', import.meta.url), 'utf8');

function harness(search = '', saved = null, blockedStorage = false) {
  const elements = new Map();
  const element = () => ({
    width: 1920, height: 1080, value: '', disabled: false, hidden: false,
    style: {}, listeners: {}, classList: {add() {}},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    getBoundingClientRect() { return {left: 100, top: 50, width: 1280, height: 720}; },
    querySelector() { return this; }, focus() {}, setPointerCapture() {},
  });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const writes = [], documentEvents = {};
  const context = vm.createContext({
    URLSearchParams, performance: {now: () => 100},
    location: {search}, window: {addEventListener() {}},
    document: {getElementById: get, querySelector: () => get('logoDock'), addEventListener(name, fn) { documentEvents[name] = fn; }},
    localStorage: {
      getItem() { if (blockedStorage) throw Error('Storage blocked'); return saved; },
      setItem(key, value) { if (blockedStorage) throw Error('Storage blocked'); writes.push([key, value]); },
    },
    Module: {canvas: get('canvas'), gdInputQueue: [], gdCursorPos: [0, 0]},
    setTimeout() {}, resetProgress() {},
    GDAssets: {loadScript: () => ({then: () => ({catch() {}})})},
  });
  vm.runInContext(qualityCode, context);
  return {context, canvas: get('canvas'), select: get('qualitySelect'), control: get('qualityControl'), writes, documentEvents};
}

const standard = harness();
assert.equal(standard.select.value, 'standard');
assert.deepEqual([standard.canvas.width, standard.canvas.height], [1280, 720]);
assert.equal(harness('', 'performance').select.value, 'performance', 'saved choice restores');
assert.equal(harness('?quality=high', 'performance').select.value, 'high', 'explicit high URL overrides saved choice');
assert.equal(harness('?quality=__proto__', 'invalid').select.value, 'standard', 'unrecognized values cannot become dimensions');

standard.select.value = 'performance';
standard.select.listeners.change.call(standard.select);
assert.deepEqual([standard.canvas.width, standard.canvas.height], [960, 540]);
assert.deepEqual(standard.writes, [['gdRenderQuality', 'performance']]);
vm.runInContext(bootCode, standard.context);
vm.runInContext(keyboardCode, standard.context);
standard.documentEvents.keydown({target: standard.select, code: 'Enter', key: 'Enter', preventDefault() { throw Error('Select keyboard input was intercepted'); }});
assert.equal(standard.context.started, false, 'choosing an option with Enter does not start the game');
standard.documentEvents.keydown({target: standard.canvas, code: 'Enter', key: 'Enter', preventDefault() {}});
assert.equal(standard.select.disabled, true);
assert.equal(standard.control.hidden, true);
assert.equal(standard.context.window.__gdLoadStarted, true);
standard.select.value = 'high';
standard.select.listeners.change.call(standard.select);
assert.deepEqual([standard.canvas.width, standard.canvas.height], [960, 540], 'render size stays fixed after boot');
assert.equal(standard.writes.length, 1, 'a forced late event cannot change the saved choice');

const privateBrowser = harness('', null, true);
privateBrowser.select.value = 'performance';
privateBrowser.select.listeners.change.call(privateBrowser.select);
assert.deepEqual([privateBrowser.canvas.width, privateBrowser.canvas.height], [960, 540], 'storage failures do not prevent selection');

for (const [quality, width, height] of [['performance', 960, 540], ['standard', 1280, 720], ['high', 1920, 1080]]) {
  const h = harness('?quality=' + quality);
  assert.deepEqual([h.canvas.width, h.canvas.height], [width, height]);
  h.context.window.__gdInputReady = true;
  vm.runInContext(inputCode, h.context);
  h.canvas.listeners.pointerdown({button: 0, pointerType: 'mouse', buttons: 1, clientX: 740, clientY: 410, pointerId: 1, timeStamp: 100, preventDefault() {}});
  assert.deepEqual(Array.from(h.context.Module.gdCursorPos), [width / 2, height / 2], quality + ' preserves center input mapping');
}

console.log('Quality checks passed: defaults, saved/URL choices, boot lock, blocked storage, and native pointer scaling at all three resolutions.');
