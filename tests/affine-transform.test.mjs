import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {gunzipSync} from 'node:zlib';
import {patchWasm} from '../patches/reduced-area-colors.mjs';
import {patchAffine} from '../patches/affine-transform.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const FN = 4724, RET = 2870, IMPORTS = 151;
const HEAP_BASE = 346225600, RESUME = 346324656;
const expectedBody = 'fff2415a73b937218148601ad80ed036c040b7af74b6b1f7eb7bc5c4393d1bc4';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const cat = (...parts) => Buffer.concat(parts.flat(Infinity).map(p => typeof p === 'number' ? Buffer.from([p]) : Buffer.from(p)));
function uleb(n) {
  const out = [];
  do { let v = n & 127; n = Math.floor(n / 128); out.push(v | (n ? 128 : 0)); } while (n);
  return Buffer.from(out);
}
function readU(b, c) {
  let value = 0, shift = 0, byte;
  do { byte = b[c.p++]; value += (byte & 127) * 2 ** shift; shift += 7; assert(shift <= 35); } while (byte & 128);
  return value;
}
const section = (id, payload) => cat([id], uleb(payload.length), payload);
const name = s => cat(uleb(Buffer.byteLength(s)), Buffer.from(s));
function readName(b, c) { const n = readU(b, c), v = b.subarray(c.p, c.p + n).toString(); c.p += n; return v; }
function parse(bytes) {
  assert(bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])));
  const c = { p: 8 }, sections = new Map(), sectionRecords = [];
  while (c.p < bytes.length) {
    const start = c.p, id = bytes[c.p++], n = readU(bytes, c), payloadStart = c.p;
    c.p += n;
    const payload = bytes.subarray(payloadStart, c.p);
    sections.set(id, payload); sectionRecords.push({id, raw: bytes.subarray(start, c.p)});
  }
  const imports = sections.get(2), ic = { p: 0 }, types = [];
  const importCount = readU(imports, ic);
  for (let i = 0; i < importCount; i++) {
    readName(imports, ic); readName(imports, ic); assert.equal(imports[ic.p++], 0);
    types.push(readU(imports, ic));
  }
  assert.equal(importCount, IMPORTS);
  const functions = sections.get(3), fc = { p: 0 }, count = readU(functions, fc);
  for (let i = 0; i < count; i++) types.push(readU(functions, fc));
  const code = sections.get(10), cc = { p: 0 }, bodyCount = readU(code, cc), bodies = [];
  assert.equal(bodyCount, count);
  for (let i = 0; i < bodyCount; i++) { const n = readU(code, cc); bodies.push(code.subarray(cc.p, cc.p + n)); cc.p += n; }
  assert.equal(cc.p, code.length);
  return { bytes, sections, sectionRecords, types, bodies };
}

const upstream = gunzipSync(fs.readFileSync(path.join(dir, '../upstream/wasm.gz')));
const {output: input} = patchWasm(upstream);
const {output, report: patchReport} = patchAffine(input);
assert.equal(sha(output), 'feb044f268003cc60e64825f6c825f5e86f945c6c5bbb4a2b0fc5577e297404a', 'Exact validated candidate changed');
assert(patchAffine(input).output.equals(output), 'Patching must be deterministic');
assert.throws(() => patchAffine(Buffer.alloc(8)), /unverified/);
const original = parse(input), candidate = parse(output);
assert.deepEqual(original.sectionRecords.map(s => s.id), candidate.sectionRecords.map(s => s.id));
for (let i = 0; i < original.sectionRecords.length; i++) if (original.sectionRecords[i].id !== 10) {
  assert(original.sectionRecords[i].raw.equals(candidate.sectionRecords[i].raw), `Section ${original.sectionRecords[i].id} changed`);
}
assert.equal(original.bodies.length, candidate.bodies.length);
const changedFunctions = original.bodies.flatMap((body, i) => body.equals(candidate.bodies[i]) ? [] : [i + IMPORTS]);
assert.deepEqual(changedFunctions, [FN]);
const originalBody = original.bodies[FN - IMPORTS], changedBody = candidate.bodies[FN - IMPORTS];
assert(changedBody.subarray(patchReport.declarationsBytes + patchReport.prefixBytes).equals(originalBody.subarray(patchReport.originalDeclarationsBytes)), 'Original fallback instructions changed');
assert.equal(sha(original.bodies[FN - IMPORTS]), expectedBody, 'Expected the exact original affine body');
assert.deepEqual(original.types, candidate.types, 'Function indices/signatures must stay unchanged');
assert.equal(original.types[FN], original.types[RET], 'Leaf and native RET ABI must match');
assert(original.bodies[RET - IMPORTS].equals(candidate.bodies[RET - IMPORTS]), 'Native RET helper must stay unchanged');

const pages = Math.ceil((RESUME + 4) / 65536);
const memory = new WebAssembly.Memory({ initial: pages });
function harness(parsed, countRet = false) {
  const bodies = parsed.types.map((_, index) => [FN, RET].includes(index) ? parsed.bodies[index - IMPORTS] : Buffer.from([0, 0, 11]));
  const entry = (n, kind, index) => cat(name(n), [kind], uleb(index));
  const exports = [entry('run', 0, FN), entry('memory', 2, 0)];
  let globals = parsed.sections.get(6);
  if (countRet) {
    const gc = { p: 0 }, globalCount = readU(globals, gc), lc = { p: 0 }, ret = bodies[RET];
    const localGroups = readU(ret, lc);
    for (let i = 0; i < localGroups; i++) { readU(ret, lc); lc.p++; }
    bodies[RET] = cat(ret.subarray(0, lc.p), [0x23], uleb(globalCount), [0x41, 1, 0x6a, 0x24], uleb(globalCount), ret.subarray(lc.p));
    globals = cat(uleb(globalCount + 1), globals.subarray(gc.p), [0x7f, 1, 0x41, 0, 0x0b]);
    exports.push(entry('__testRetCalls', 3, globalCount));
  }
  const bytes = cat(parsed.bytes.subarray(0, 8), section(1, parsed.sections.get(1)),
    section(2, cat([1], name('env'), name('memory'), [2, 0], uleb(pages))),
    section(3, cat(uleb(parsed.types.length), parsed.types.map(uleb))),
    section(6, globals), section(7, cat(uleb(exports.length), exports)),
    section(10, cat(uleb(bodies.length), bodies.map(b => cat(uleb(b.length), b)))));
  assert(WebAssembly.validate(bytes), 'Extracted leaf module must validate; unexpected dependency/global/table is unsupported');
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } }).exports;
}
const native = harness(original, true), fast = harness(candidate, true);
const heap = new Uint8Array(memory.buffer), view = new DataView(memory.buffer);
const CPU = 0x2000, BASE = 0x100000, GUEST = BASE + 0x4000, STACK = BASE + 0x5000;
const regions = [[0, 256], [CPU, 2048], [BASE - 128, 256], [GUEST - 128, 1024], [STACK - 128, 256],
  [HEAP_BASE - 16, 48], [RESUME - 16, 48], [heap.length - 128, 128]];
const guestPtr = actual => (actual - BASE) >>> 0;
const bitPatterns = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff, 0x00800000, 0x80800000,
  0x3f800000, 0xbf800000, 0x3f000000, 0x40000000, 0x7f7fffff, 0xff7fffff,
  0x7f800000, 0xff800000, 0x7fc00000, 0xffc00000, 0x7fc12345, 0x7f812345, 0xff812345];
let randomState = 0x728441ed;
function randomU32() { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return randomState >>> 0; }
function reset(test) {
  for (const [start, length] of regions) heap.fill(0xa5, start, start + length);
  for (let i = 0; i < 2048; i += 4) view.setUint32(CPU + i, (Math.imul(i + 17, 0x9e3779b1) ^ test.seed) >>> 0, true);
  const a = test.a ?? GUEST + 128, b = test.b ?? GUEST + 256, dst = test.dst ?? GUEST + 384;
  const high = test.high ?? 0n, stackHigh = test.stackHigh ?? high;
  view.setBigUint64(CPU + 8, high | BigInt(guestPtr(dst)), true);
  view.setBigUint64(CPU + 16, high | BigInt(guestPtr(a)), true);
  view.setBigUint64(CPU + 64, high | BigInt(guestPtr(b)), true);
  view.setBigUint64(CPU + 32, stackHigh | 0x5000n, true);
  view.setBigUint64(CPU + 192, 0x10006190n, true);
  view.setBigUint64(STACK, 0x123456789abcdef0n, true);
  // The write order is intentional: overlapped input bytes form one actual native memory image.
  for (let i = 0; i < 6; i++) if (a + i * 4 + 4 <= heap.length) view.setUint32(a + i * 4, test.aBits[i] >>> 0, true);
  for (let i = 0; i < 6; i++) if (b + i * 4 + 4 <= heap.length) view.setUint32(b + i * 4, test.bBits[i] >>> 0, true);
  view.setUint32(HEAP_BASE, BASE, true); view.setUint32(RESUME, test.resume ?? 0, true);
}
function execute(api, test) {
  reset(test);
  if (api.__testRetCalls) api.__testRetCalls.value = 0;
  let trapped = false;
  try { api.run(CPU); } catch (e) { assert(e instanceof WebAssembly.RuntimeError); trapped = true; }
  return { trapped, retCalls: api.__testRetCalls?.value ?? null, bytes: regions.map(([start, length]) => Buffer.from(heap.subarray(start, start + length))) };
}
const counterTotals = { compactCases: 0, fallbackCases: 0 };
function compare(test, index) {
  const before = execute(native, test), after = execute(fast, test);
  assert.equal(before.retCalls, 0, 'Original affine body never calls the shared RET helper');
  if (after.retCalls) counterTotals.compactCases++; else counterTotals.fallbackCases++;
  if (test.resume || test.label.startsWith('oob') || test.label.startsWith('metadata-output8') ||
      ['a', 'b', 'dst'].some(field => test[field] >= CPU && test[field] < CPU + 2048)) {
    assert.equal(after.retCalls, 0, `${index} ${test.label}: exceptional metadata/bounds/resume case must use original path`);
  }
  assert.equal(after.trapped, before.trapped, `${index} ${test.label}: trap behavior`);
  for (let i = 0; i < regions.length; i++) if (!before.bytes[i].equals(after.bytes[i])) {
    const at = before.bytes[i].findIndex((v, n) => v !== after.bytes[i][n]);
    assert.fail(`${index} ${test.label}: memory mismatch at0x${(regions[i][0] + at).toString(16)}, original=${before.bytes[i][at]} compact=${after.bytes[i][at]}; ${JSON.stringify(test, (_, v) => typeof v === 'bigint' ? '0x' + v.toString(16) : v)}`);
  }
  return before.trapped;
}
const cases = [];
const add = (label, aBits, bBits, extra = {}) => cases.push({ label, aBits, bBits, seed: randomU32(), ...extra });
const identity = [0x3f800000, 0, 0, 0x3f800000, 0, 0];
for (let i = 0; i < bitPatterns.length; i++) {
  const bits = Array.from({ length: 6 }, (_, j) => bitPatterns[(i + j) % bitPatterns.length]);
  add(`bits${i}-identityB`, bits, identity); add(`bits${i}-identityA`, identity, bits);
  add(`bits${i}-both`, bits, [...bits].reverse());
}
for (let i = 0; i < 360; i++) add(`raw${i}`, Array.from({ length: 6 }, randomU32), Array.from({ length: 6 }, randomU32));
for (let i = 0; i < 320; i++) {
  const finite = () => randomU32() & 0xfeffffff;
  add(`finite${i}`, Array.from({ length: 6 }, finite), Array.from({ length: 6 }, finite));
}
const offsets = [-24, -20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20, 24];
for (const offset of offsets) for (const bOffset of [0, 4, 8, 12, 16, 20, 24, 64]) {
  const aBits = Array.from({ length: 6 }, randomU32), bBits = Array.from({ length: 6 }, randomU32);
  add(`aliasA${offset}-B${bOffset}`, aBits, bBits, { a: GUEST + 256, b: GUEST + 256 + bOffset, dst: GUEST + 256 + offset });
  add(`aliasB${offset}-B${bOffset}`, aBits, bBits, { a: GUEST + 256, b: GUEST + 256 + bOffset, dst: GUEST + 256 + bOffset + offset });
}
for (const high of [0x1234567800000000n, 0xffffffff00000000n, 0x8000000000000000n]) {
  for (const resume of [0, 0x10006190, 0xffffffff]) add(`high${high}-resume${resume}`, identity, [...identity].reverse(), { high, resume });
}
for (const resume of [1, 0x10006190, 0xffffffff]) add(`resume${resume}`, identity, identity, { resume });
for (const dst of [CPU, CPU + 8, CPU + 32, CPU + 192, CPU + 988, CPU + 1052, CPU + 1116, CPU + 1180, CPU + 1244, CPU + 1308, STACK - 4, STACK, STACK + 4]) {
  add(`metadata-output${dst}`, [0x3f800000, 0x40000000, 0x40400000, 0x40800000, 0x40a00000, 0x40c00000], identity, { dst });
}
for (const actual of [CPU + 988, CPU + 1052, CPU + 1116, CPU + 1180, CPU + 1244, CPU + 1308, STACK - 4, STACK, 16, BASE - 1]) {
  add(`metadata-inputA${actual}`, identity, identity, { a: actual });
  add(`metadata-inputB${actual}`, identity, identity, { b: actual });
}
for (const field of ['a', 'b', 'dst']) for (const endOffset of [4, 8, 12, 16, 20]) {
  add(`oob${field}${endOffset}`, identity, identity, { [field]: heap.length - endOffset });
}
const started = performance.now();
let trappedCases = 0;
for (let i = 0; i < cases.length; i++) trappedCases += +compare(cases[i], i);
if (!original.bodies[FN - IMPORTS].equals(candidate.bodies[FN - IMPORTS])) assert(counterTotals.compactCases > 700, 'Prove the compact path actually executes on the normal fixtures');
const report = { passed: true, cases: cases.length, trappedCases, elapsedMs: performance.now() - started,
  counterTotals,
  sharedMemoryBytes: heap.length, comparedRegions: regions.map(([start, length]) => ({ start, length })),
  changedFunctionIndices: changedFunctions,
  otherSectionsAndFunctionsPreserved: true,
  deterministic: true,
  rejectsWrongInput: true,
  input: { sha256: sha(original.bytes), bodyBytes: original.bodies[FN - IMPORTS].length, bodySHA256: sha(original.bodies[FN - IMPORTS]) },
  candidate: { sha256: sha(candidate.bytes), bodyBytes: candidate.bodies[FN - IMPORTS].length, bodySHA256: sha(candidate.bodies[FN - IMPORTS]) },
  tests: ['full2048-byteCPU', 'guest-input-output-and-guards', 'return-stack-and-guards', 'heap-base-and-resume-slots',
    'rawIEEE754bits', 'signedzero/subnormals/NaN/Inf', 'dstA/dstB-overlap-offsets', 'input-input-overlap',
    'high64-bitguestregisters', 'nonzero-resume', 'CPU/return-stack-alias', 'i32-address-wrap', 'out-of-bounds-traps'] };
assert.equal(cases.length, 1011);
assert.equal(trappedCases, 15);
assert.deepEqual(counterTotals, {compactCases: 965, fallbackCases: 46});
console.log(JSON.stringify(report));
