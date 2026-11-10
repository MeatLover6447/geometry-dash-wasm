import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const settingsStart = html.indexOf('var gdReducedAreaTint = false;');
const settingsEnd = html.indexOf('\nvar GD_DEBUG', settingsStart);
assert(settingsStart >= 0 && settingsEnd > settingsStart);
const settingsCode = html.slice(settingsStart, settingsEnd);
const instantiateCode = /instantiateWasm: (function \(imports, success\) \{[\s\S]*?\n\}),\nprint:/.exec(html)?.[1];
assert(instantiateCode, 'actual instantiation callback is present');
const bootStart = html.indexOf('var started = false;');
const bootEnd = html.indexOf("\ndocument.getElementById('loadFly').addEventListener", bootStart);
assert(bootStart >= 0 && bootEnd > bootStart);
const keyboardStart = html.indexOf("document.addEventListener('keydown', function (e) {\nif (e.target === gdQualitySelect");
const keyboardEnd = html.indexOf('\n});', keyboardStart) + 4;
assert(keyboardStart >= 0 && keyboardEnd > keyboardStart);

function harness(search = '', saved = null, blockedStorage = false) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      checked: false, disabled: false, hidden: false, value: 'standard', style: {}, listeners: {},
      classList: {add() {}}, addEventListener(name, fn) { this.listeners[name] = fn; },
      getBoundingClientRect() { return {height: 100}; }, querySelector() { return this; },
    });
    return elements.get(id);
  };
  const writes = [], documentEvents = {};
  const context = vm.createContext({
    URLSearchParams, location: {search}, window: {},
    document: {getElementById: get, querySelector: () => get('logoDock'), addEventListener(name, fn) { documentEvents[name] = fn; }},
    localStorage: {
      getItem(key) { if (blockedStorage) throw Error('Storage blocked'); assert.equal(key, 'gdReducedAreaTint'); return saved; },
      setItem(key, value) { if (blockedStorage) throw Error('Storage blocked'); writes.push([key, value]); },
    },
    Module: {}, gdQualitySelect: get('qualitySelect'), gdApplyQuality() {}, setTimeout() {}, resetProgress() {},
    GDAssets: {loadScript: () => ({then: () => ({catch() {}})})},
  });
  vm.runInContext(settingsCode, context);
  vm.runInContext('var instantiate = ' + instantiateCode + ';', context);
  return {context, checkbox: get('reducedAreaTint'), control: get('qualityControl'), writes, documentEvents};
}

assert.equal(harness().checkbox.checked, false, 'full native colors remain the default');
assert.equal(harness('', '1').checkbox.checked, true, 'explicit saved opt-in restores');
assert.equal(harness('', 'true').checkbox.checked, false, 'unrecognized saved values do not opt in');
assert.equal(harness('?effects=reduced', '0').checkbox.checked, true, 'reduced URL overrides saved full colors');
assert.equal(harness('?effects=full', '1').checkbox.checked, false, 'full URL overrides saved reduced colors');
assert.equal(harness('?effects=unknown', '1').checkbox.checked, true, 'unknown URL values preserve the saved choice');
assert.equal(harness('', null, true).checkbox.checked, false, 'blocked storage preserves default colors');

for (const search of ['', '?effects=reduced', '?effects=full']) {
  const h = harness(search);
  const flag = new WebAssembly.Global({value: 'i32', mutable: true}, 7);
  const instance = {exports: {gdReducedAreaTint: flag}}, module = {};
  h.context.GDAssets.instantiateWasm = (imports, success) => { success(instance, module); return {}; };
  let calls = 0;
  h.context.instantiate({}, (receivedInstance, receivedModule) => {
    calls++;
    assert.equal(receivedInstance, instance);
    assert.equal(receivedModule, module);
    assert.equal(flag.value, search === '?effects=reduced' ? 1 : 0, 'native flag is set before loader receives the instance');
    assert.equal(h.context.Module.gdReducedAreaTint, flag, 'Module retains the same mutable native global');
  });
  assert.equal(calls, 1);
}

const h = harness();
h.checkbox.checked = true;
h.checkbox.listeners.change.call(h.checkbox);
assert.deepEqual(h.writes, [['gdReducedAreaTint', '1']]);
vm.runInContext(html.slice(bootStart, bootEnd), h.context);
vm.runInContext(html.slice(keyboardStart, keyboardEnd), h.context);
h.documentEvents.keydown({target: h.checkbox, code: 'Space', key: ' ', preventDefault() { throw Error('Checkbox keyboard input was intercepted'); }});
assert.equal(h.context.started, false, 'Space on the checkbox does not start the game');
h.documentEvents.keydown({target: h.context.gdQualitySelect, code: 'Enter', key: 'Enter', preventDefault() { throw Error('Select keyboard input was intercepted'); }});
assert.equal(h.context.started, false);
h.context.gdStart();
assert.equal(h.checkbox.disabled, true);
assert.equal(h.control.hidden, true);
assert.equal(h.context.gdReducedAreaTint, true);
h.checkbox.checked = false;
h.checkbox.listeners.change.call(h.checkbox);
assert.equal(h.context.gdReducedAreaTint, true, 'forced late UI events cannot change the running native mode');
assert.equal(h.writes.length, 1, 'forced late events cannot rewrite the saved choice');

const privateBrowser = harness('', null, true);
privateBrowser.checkbox.checked = true;
privateBrowser.checkbox.listeners.change.call(privateBrowser.checkbox);
assert.equal(privateBrowser.context.gdReducedAreaTint, true, 'storage failures do not prevent opting in');
console.log('Reduced effects checks passed: default colors, saved/URL choices, native flag handoff, keyboard behavior, and boot lock.');
