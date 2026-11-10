import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSections, readU, uleb, section, name, codeBodies, RESUME_PC, HEAP_BASE_SLOT, sha, patchWasm } from '../patches/reduced-area-colors.mjs';
import { patchSectionUpdates as patch, patchedBody, splitLocals, FN, RET, IMPORTS, op, join } from '../patches/section-updates.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const input = patchWasm(gunzipSync(fs.readFileSync(path.join(dir, '../upstream/wasm.gz')))).output;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, '../dist/gd_assets.json')));
const candidate = gunzipSync(fs.readFileSync(path.join(dir, '../dist', manifest.wasm.url)));
const { output, report } = patch(input);
assert(output.equals(candidate), 'Patcher must be deterministic');
const before = readSections(input), after = readSections(candidate), one = id => before.find(s => s.id === id).payload;
assert.deepEqual(before.map(s => s.id), after.map(s => s.id));
for (let i = 0; i < before.length; i++) if (![6, 7, 10].includes(before[i].id)) assert(before[i].raw.equals(after[i].raw));
const bodies = codeBodies(one(10)), patchedBodies = codeBodies(after.find(s => s.id === 10).payload);
assert.equal(bodies.length, patchedBodies.length);
assert.deepEqual(bodies.flatMap((b, i) => b.equals(patchedBodies[i]) ? [] : [i + IMPORTS]), [FN]);
const original = bodies[FN - IMPORTS], changed = patchedBodies[FN - IMPORTS], locals = splitLocals(original);
assert(changed.subarray(report.declarationsBytes + report.prefixBytes).equals(original.subarray(locals.end)));

// Preserve every original function index and signature in a small module.
// Unneeded functions trap; the unchanged-section path must never call them.
const c = { p: 0 }, importsPayload = one(2), importedTypes = [];
const importCount = readU(importsPayload, c);
for (let i = 0; i < importCount; i++) {
  for (let j = 0; j < 2; j++) { const n = readU(importsPayload, c); c.p += n; }
  assert.equal(importsPayload[c.p++], 0); importedTypes.push(readU(importsPayload, c));
}
const fc = { p: 0 }, definedPayload = one(3), definedCount = readU(definedPayload, fc), allTypes = [...importedTypes];
for (let i = 0; i < definedCount; i++) allTypes.push(readU(definedPayload, fc));
const fastIndex = 24586, harnessCount = fastIndex + 1, hitIndex = 38;
const ret = bodies[RET - IMPORTS], retLocals = splitLocals(ret);
const countedRet = join(ret.subarray(0, retLocals.end), op(0x23), uleb(hitIndex), op(0x41, 1, 0x6a, 0x24), uleb(hitIndex), ret.subarray(retLocals.end));
const harnessBodies = Array.from({ length: harnessCount }, () => op(0, 0, 0x0b));
harnessBodies[RET] = countedRet; harnessBodies[FN] = original; harnessBodies[fastIndex] = patchedBody(original, report.flagIndex).body;
const gc = { p: 0 }, globals = one(6), globalCount = readU(globals, gc);
assert.equal(globalCount, 37);
const exportEntry = (value, kind, index) => join(name(value), op(kind), uleb(index));
const harness = join(
  input.subarray(0, 8), section(1, one(1)),
  section(3, join(uleb(harnessCount), Array.from({ length: harnessCount }, (_, i) => uleb(i === fastIndex ? 0 : allTypes[i])))),
  section(5, join(op(1, 0), uleb(Math.ceil((RESUME_PC + 4) / 65536)))),
  section(6, join(uleb(globalCount + 2), globals.subarray(gc.p), op(0x7f, 1, 0x41, 0, 0x0b, 0x7f, 1, 0x41, 0, 0x0b))),
  section(7, join(op(5), exportEntry('original', 0, FN), exportEntry('fast', 0, fastIndex), exportEntry('flag', 3, report.flagIndex), exportEntry('hits', 3, hitIndex), exportEntry('memory', 2, 0))),
  section(10, join(uleb(harnessCount), harnessBodies.flatMap(b => [uleb(b.length), b]))),
);
assert(WebAssembly.validate(harness));
const { instance } = await WebAssembly.instantiate(harness), api = instance.exports;
assert.equal(api.flag.value, 0);
const view = new DataView(api.memory.buffer), heap = new Uint8Array(api.memory.buffer);
const regs = 0x1000, base = 0x10000, objectGuest = 0x2000, layerGuest = 0x4000, stackGuest = 0xc000;
const object = base + objectGuest, layer = base + layerGuest, stack = base + stackGuest;
view.setUint32(HEAP_BASE_SLOT, base, true);
view.setFloat64(base + 12801344, 10000000, true); view.setFloat32(base + 12803128, 10000000, true);
function oracle(value, scale) {
  scale = Math.fround(scale);
  const scaled = value <= 0 ? 0 : value >= 10000000 ? Math.fround(scale * 10000000) : value * scale;
  return !Number.isFinite(scaled) || scaled < -2147483648 || scaled >= 2147483648 ? -2147483648 : Math.trunc(scaled);
}
function execute(test, fast, enabled = true) {
  heap.fill(0x5a, regs, regs + 2048); heap.fill(0xa5, object, object + 0x600);
  heap.fill(0, layer, layer + 0x3800); heap.fill(0x6b, stack - 64, stack + 64);
  view.setBigUint64(regs + 8, BigInt(layerGuest), true); view.setBigUint64(regs + 16, BigInt(objectGuest), true);
  view.setBigUint64(regs + 32, BigInt(stackGuest), true); view.setBigUint64(regs + 192, 0x730ba0n, true);
  view.setBigUint64(stack, 0xabcdef01n, true); view.setUint32(RESUME_PC, test.resume || 0, true);
  view.setInt32(object + 0x278, test.cx ?? oracle(test.x, test.sx), true);
  view.setInt32(object + 0x27c, test.cy ?? oracle(test.y, test.sy), true);
  view.setFloat64(object + 0x3b8, test.x, true); view.setFloat64(object + 0x3c0, test.y, true);
  view.setFloat32(layer + 0x37a0, test.sx, true); view.setFloat32(layer + 0x37a4, test.sy, true);
  api.hits.value = 0; api.flag.value = enabled ? 1 : 0;
  let fault = false;
  try { (fast ? api.fast : api.original)(regs); } catch (e) { assert(e instanceof WebAssembly.RuntimeError); fault = true; }
  return { fault, hits: api.hits.value, regs: Buffer.from(heap.subarray(regs, regs + 2048)), object: Buffer.from(heap.subarray(object, object + 0x600)), stack: Buffer.from(heap.subarray(stack - 64, stack + 64)), resume: view.getUint32(RESUME_PC, true) };
}
function neighbor(value, up) {
  if (!value) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const b = new ArrayBuffer(8), v = new DataView(b); v.setFloat64(0, value, true);
  v.setBigUint64(0, v.getBigUint64(0, true) + ((value > 0) === up ? 1n : -1n), true); return v.getFloat64(0, true);
}
const cases = [], scale = Math.fround(0.01);
for (const x of [0, -0, 1, -1, Number.MIN_VALUE, -Number.MIN_VALUE, 100, neighbor(100, false), neighbor(100, true), neighbor(10000000, false), 10000000, neighbor(10000000, true), NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
  cases.push({ x, y: 200, sx: scale, sy: scale });
  cases.push({ x: 200, y: x, sx: scale, sy: scale });
}
for (const sx of [0, -0, 1, -1, NaN, Infinity, -Infinity, 214.7483648, 1e30]) cases.push({ x: 9999999, y: 1, sx, sy: sx });
for (const cell of [0, 1, 99, 10000, 20000000]) for (const x of [neighbor(cell / scale, false), cell / scale, neighbor(cell / scale, true)]) cases.push({ x, y: x, sx: scale, sy: scale });
cases.push({ x: 10, y: 20, sx: scale, sy: scale, cx: 50 });
cases.push({ x: NaN, y: 20, sx: scale, sy: scale, cx: 0 });
cases.push({ x: 100, y: 200, sx: scale, sy: scale, resume: 0x123456 });
let seed = 0x239d4b11;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
for (let i = 0; i < 300; i++) cases.push({ x: random() * 11000000 - 500000, y: random() * 11000000 - 500000, sx: Math.fround(random() * 0.03), sy: Math.fround(random() * 0.03) });
const originalCaseCount = cases.length;
assert.equal(originalCaseCount, 359, 'Keep the complete v1 fixture set');
const nonpositive = [-Infinity, -Number.MAX_VALUE, -10000000, -1, -Number.MIN_VALUE, -0, 0];
const specialScales = [NaN, Infinity, -Infinity, -Number.MAX_VALUE, Number.MAX_VALUE, -0.01, -0, 0, scale];
for (const x of nonpositive) for (const y of nonpositive) for (const sx of specialScales) {
  cases.push({ x, y, sx, sy: sx, expectFast: true });
}
for (const coordinate of nonpositive) for (const factor of specialScales) {
  cases.push({ x: coordinate, y: 100, sx: factor, sy: scale, expectFast: true });
  cases.push({ x: 100, y: coordinate, sx: scale, sy: factor, expectFast: true });
}
for (const coordinate of [NaN, Infinity, 10000000, neighbor(10000000, true)]) {
  cases.push({ x: coordinate, y: -1, sx: scale, sy: NaN, cx: 0, expectFast: false });
  cases.push({ x: -1, y: coordinate, sx: NaN, sy: scale, cx: 0, expectFast: false });
}
const v2CaseCount = cases.length;
assert.equal(v2CaseCount, 934, 'Keep the complete v2 fixture set');
const negativeCachedXValues = [-2147483648, -2147483647, -1073741824, -2, -1];
const arbitraryCachedYValues = [-2147483648, -1, 0, 1, 2147483647];
const arbitraryCoordinates = [[0, -0], [1234.5, -5678.9], [NaN, Infinity], [-Infinity, -Infinity], [Number.MAX_VALUE, NaN]];
for (const cx of negativeCachedXValues) for (const cy of arbitraryCachedYValues) for (const [x, y] of arbitraryCoordinates) {
  for (const factor of [NaN, Infinity, -Infinity, 0, -0, scale]) cases.push({ x, y, sx: factor, sy: factor, cx, cy, expectFast: true });
}
cases.push({ x: NaN, y: -Infinity, sx: NaN, sy: Infinity, cx: -1, cy: -2147483648, resume: 0x123456, expectFast: false });
let fastReturns = 0, originalReturns = 0, fallbacks = 0, v1FixtureFastReturns = 0;
for (const [index, test] of cases.entries()) {
  const originalResult = execute(test, false), fastResult = execute(test, true);
  assert.equal(fastResult.fault, originalResult.fault, `Trap mismatch case${index}`);
  assert(fastResult.object.equals(originalResult.object), `Object changed case${index}`);
  assert.equal(fastResult.resume, originalResult.resume);
  if ('expectFast' in test) assert.equal(!!fastResult.hits, test.expectFast, `Clamp/fallback path case${index}`);
  if (fastResult.hits) {
    if (index < originalCaseCount) v1FixtureFastReturns++;
    fastReturns++; assert.equal(fastResult.hits, 1); assert(!fastResult.fault);
    for (const offset of [24, 32, 40, 48, 56, 96, 104, 112, 120, 192]) assert.equal(fastResult.regs.readBigUInt64LE(offset), originalResult.regs.readBigUInt64LE(offset), `ABI register${offset} case${index}`);
  } else {
    fallbacks++; assert(fastResult.regs.equals(originalResult.regs), `Fallback registers case${index}`);
    assert(fastResult.stack.equals(originalResult.stack), `Fallback guest stack case${index}`);
  }
  if (!originalResult.fault) originalReturns++;
  const disabledResult = execute(test, true, false);
  assert.equal(disabledResult.hits, 0); assert.equal(disabledResult.fault, originalResult.fault);
  assert(disabledResult.regs.equals(originalResult.regs)); assert(disabledResult.stack.equals(originalResult.stack));
}
assert(fastReturns > 1000); assert(fallbacks >= 10);
const results = { version: 3, candidateSha256: sha(candidate), deterministic: true, changedFunctionIndices: [FN], originalInstructionsPreserved: true, otherStandardSectionsPreserved: true, validatedByNode: true, harness: { cases: cases.length, fastReturns, fallbacks, originalReturns, originalV1FixtureCases: originalCaseCount, originalV1FixtureFastReturns: v1FixtureFastReturns, originalV2FixtureCases: v2CaseCount, addedNegativeCachedXCases: cases.length - v2CaseCount, defaultOffByteExactCpuAndGuestStack: true, fallbackByteExactCpuAndGuestStack: true, fastReturnPreservesObjectAndCalleeSavedState: true, floatingPointAndClampBoundaries: true, negativeInfinityAndNonpositiveClamp: true, unusedNonfiniteFactorsIgnoredForClampedAxes: true, signedNegativeCachedXAllCoordinatesAndFactors: true, nonzeroResumeFallsThrough: true }, limits: 'Fast path preserves native function ABI and object behavior. Volatile CPU registers/flags/XMM temporaries and dead callee stack-save slots intentionally need not match the original return path.' };
console.log(JSON.stringify(results));
