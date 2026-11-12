import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchWasm, readSections, readU, codeBodies, guard, uleb, sleb, name, section, RESUME_PC, HEAP_BASE_SLOT, RET_HEX, sha } from '../patches/reduced-area-colors.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const input = gunzipSync(fs.readFileSync(path.join(directory, '../upstream/wasm.gz')));
const { output: candidate, report } = patchWasm(input);
assert.equal(sha(candidate), '72dfc0317b8c2b45a856a0a9b8a11be71e25d79d6b055ed04bc43c138efa1b4e', 'Area-color patch output must remain deterministic');
const before = readSections(input), after = readSections(candidate);
assert.deepEqual(after.map(s => s.id), before.map(s => s.id));
for (let i = 0; i < before.length; i++) {
  if (![6, 7, 10].includes(before[i].id)) assert(after[i].raw.equals(before[i].raw), `Section${before[i].id} changed`);
}
const originalBodies = codeBodies(before.find(s => s.id === 10).payload);
const patchedBodies = codeBodies(after.find(s => s.id === 10).payload);
assert.equal(originalBodies.length, patchedBodies.length);
const imports = readU(before.find(s => s.id === 2).payload, {p: 0});
const changed = originalBodies.flatMap((body, index) => body.equals(patchedBodies[index]) ? [] : [index + imports]);
assert.deepEqual(changed, [9409]);
const original = originalBodies[9409 - imports], patched = patchedBodies[9409 - imports], locals = report.localDeclarationBytes;
assert(patched.subarray(0, locals).equals(original.subarray(0, locals)));
assert(patched.subarray(locals, locals + report.guardBytes).equals(guard(report.globalIndex, 2870)));
assert(patched.subarray(locals + report.guardBytes).equals(original.subarray(locals)), 'Default instruction stream changed');
const tampered = Buffer.from(input); tampered[tampered.length - 1] ^= 1;
assert.throws(() => patchWasm(tampered), /unverified input/);

// Execute the actual original 66-byte RET helper with the identical guard,
// using a tiny module whose original path only increments a marker. The large
// address range is virtual; the harness touches only a handful of memory pages.
const marker = 0x3000, registers = 0x1000, guestStack = 0x2000, heapBase = 0x4000;
const markerCode = Buffer.from([0x41, ...sleb(marker), 0x41, 1, 0x36, 2, 0]);
const runBody = Buffer.concat([Buffer.from([0]), guard(0, 0), markerCode, Buffer.from([0x0b])]);
const retBody = Buffer.from(RET_HEX, 'hex');
const exportEntry = (value, kind, index) => Buffer.concat([name(value), Buffer.from([kind]), uleb(index)]);
const harness = Buffer.concat([
  Buffer.from('0061736d01000000', 'hex'),
  section(1, Buffer.from([1, 0x60, 1, 0x7f, 0])),
  section(3, Buffer.from([2, 0, 0])),
  section(5, Buffer.concat([Buffer.from([1, 0]), uleb(Math.ceil((RESUME_PC + 4) / 65536))])),
  section(6, Buffer.from([1, 0x7f, 1, 0x41, 0, 0x0b])),
  section(7, Buffer.concat([Buffer.from([4]), exportEntry('ret', 0, 0), exportEntry('run', 0, 1), exportEntry('flag', 3, 0), exportEntry('memory', 2, 0)])),
  section(10, Buffer.concat([Buffer.from([2]), uleb(retBody.length), retBody, uleb(runBody.length), runBody])),
]);
assert(WebAssembly.validate(harness));
const { instance } = await WebAssembly.instantiate(harness), api = instance.exports;
const view = new DataView(api.memory.buffer), returnAddress = 0xabcdef01n;
function reset(flag, resume) {
  new Uint8Array(api.memory.buffer, registers, 256).fill(0x5a);
  view.setUint32(HEAP_BASE_SLOT, heapBase, true); view.setUint32(RESUME_PC, resume, true);
  view.setBigUint64(registers + 32, BigInt(guestStack), true);
  view.setBigUint64(registers + 192, 0xfeedfacefeedfacen, true);
  view.setBigUint64(heapBase + guestStack, returnAddress, true);
  view.setUint32(marker, 0, true); api.flag.value = flag;
}
reset(0, 0); api.run(registers);
assert.equal(view.getUint32(marker, true), 1); assert.equal(view.getBigUint64(registers + 32, true), BigInt(guestStack));
assert.equal(view.getBigUint64(registers + 192, true), 0xfeedfacefeedfacen);
reset(1, 0);
const registerPreimage = Buffer.from(new Uint8Array(api.memory.buffer, registers, 256));
api.run(registers);
assert.equal(view.getUint32(marker, true), 0); assert.equal(view.getBigUint64(registers + 32, true), BigInt(guestStack + 8));
assert.equal(view.getBigUint64(registers + 192, true), returnAddress);
for (let i = 0; i < 256; i++) if (!((i >= 32 && i < 40) || (i >= 192 && i < 200))) assert.equal(view.getUint8(registers + i), registerPreimage[i], `Register byte${i} changed`);
reset(1, 0x123456); api.run(registers);
assert.equal(view.getUint32(marker, true), 1); assert.equal(view.getUint32(RESUME_PC, true), 0x123456);
assert.equal(view.getBigUint64(registers + 32, true), BigInt(guestStack));
reset(0, 0x123456); api.ret(registers);
assert.equal(view.getUint32(RESUME_PC, true), 0); assert.equal(view.getBigUint64(registers + 192, true), returnAddress);
const tests = { deterministic: true, changedFunctionIndices: changed, unchangedDefaultInstructions: true, unchangedOtherSections: true, rejectsWrongInput: true, validatedFullCandidate: true, nativeRetHarness: { flagOffOriginalPath: true, flagOnRetBalancesGuestStack: true, preservesOtherRegisters: true, resumedCallsKeepOriginalPath: true, helperClearsResumeState: true }, candidateSha256: sha(candidate) };
console.log(JSON.stringify(tests));
