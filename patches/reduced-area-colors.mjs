import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const ORIGINAL_SHA = '523d9362955eba27a8ce64ec9b4fda496c8ecc30e6ac9ca1f01cc76c89a5a15a';
export const TINT_SHA = '600a40da7fe7336e533401af11ebc9839d2d89dfc6e147b0c805c96ec66683a0';
export const RET_SHA = 'ebc2d772cd63981d7b10daac3354408bcdca567df4322ae9a2da5e833da649cd';
export const RET_HEX = '01017e2000290320210141b0fd91a501280200044041b0fd91a50141003602000b200041c0f78ba5012802002001a76a2900003703c0012000200142087c3703200b';
export const RESUME_PC = 346324656;
export const HEAP_BASE_SLOT = 346225600;
export const FLAG_NAME = 'gdReducedAreaTint';
export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const uleb = value => {
  const out = [];
  do { const part = value % 128; value = Math.floor(value / 128); out.push(part | (value ? 128 : 0)); } while (value);
  return Buffer.from(out);
};
export const sleb = value => {
  const out = [];
  while (true) {
    const part = value & 127;
    value = Math.floor(value / 128);
    const done = (value === 0 && !(part & 64)) || (value === -1 && !!(part & 64));
    out.push(part | (done ? 0 : 128));
    if (done) return Buffer.from(out);
  }
};
export function readU(bytes, cursor) {
  let value = 0, shift = 0, part;
  do {
    assert(cursor.p < bytes.length, 'Truncated unsigned LEB');
    part = bytes[cursor.p++];
    value += (part & 127) * 2 ** shift;
    shift += 7;
    assert(shift <= 35, 'Oversized u32 LEB');
  } while (part & 128);
  return value;
}
export const name = value => { const b = Buffer.from(value); return Buffer.concat([uleb(b.length), b]); };
export const section = (id, payload) => Buffer.concat([Buffer.from([id]), uleb(payload.length), payload]);
export function readSections(bytes) {
  assert(bytes.subarray(0, 8).equals(Buffer.from('0061736d01000000', 'hex')), 'Unexpected WASM header');
  const cursor = { p: 8 }, out = [];
  while (cursor.p < bytes.length) {
    const start = cursor.p, id = bytes[cursor.p++], size = readU(bytes, cursor), payloadStart = cursor.p;
    cursor.p += size;
    assert(cursor.p <= bytes.length, 'Truncated section');
    out.push({ id, payload: bytes.subarray(payloadStart, cursor.p), raw: bytes.subarray(start, cursor.p) });
  }
  return out;
}
const only = (sections, id) => {
  const matching = sections.filter(s => s.id === id);
  assert.equal(matching.length, 1, `Expected exactly one section ${id}`);
  return matching[0];
};
function readName(bytes, cursor) {
  const length = readU(bytes, cursor), value = bytes.subarray(cursor.p, cursor.p + length).toString();
  cursor.p += length;
  assert(cursor.p <= bytes.length);
  return value;
}
function importInfo(payload) {
  const cursor = { p: 0 }, count = readU(payload, cursor);
  for (let i = 0; i < count; i++) {
    readName(payload, cursor); readName(payload, cursor);
    assert.equal(payload[cursor.p++], 0, 'Original imports must all be functions');
    readU(payload, cursor);
  }
  assert.equal(cursor.p, payload.length);
  return { functions: count, globals: 0 };
}
function vector(payload, readEntry) {
  const cursor = { p: 0 }, count = readU(payload, cursor), entriesStart = cursor.p, entries = [];
  for (let i = 0; i < count; i++) entries.push(readEntry(payload, cursor));
  assert.equal(cursor.p, payload.length);
  return { count, entriesStart, entries };
}
export function codeBodies(payload) {
  return vector(payload, (b, c) => { const n = readU(b, c), body = b.subarray(c.p, c.p + n); c.p += n; return body; }).entries;
}
function localsEnd(body) {
  const cursor = { p: 0 }, groups = readU(body, cursor);
  for (let i = 0; i < groups; i++) { readU(body, cursor); assert([0x7f, 0x7e, 0x7d, 0x7c].includes(body[cursor.p++])); }
  return cursor.p;
}
export function guard(globalIndex, retIndex) {
  // Keep the native resume path intact. The RET helper pops the guest return
  // address; a plain WASM return would leave the emulated stack unbalanced.
  return Buffer.concat([
    Buffer.from([0x23]), uleb(globalIndex), Buffer.from([0x04, 0x40, 0x41]), sleb(RESUME_PC),
    Buffer.from([0x28, 0x02, 0x00, 0x45, 0x04, 0x40, 0x20, 0x00, 0x10]), uleb(retIndex),
    Buffer.from([0x0f, 0x0b, 0x0b]),
  ]);
}
export function patchWasm(input) {
  assert.equal(sha(input), ORIGINAL_SHA, 'Refusing an unverified input engine');
  const sections = readSections(input), imports = importInfo(only(sections, 2).payload);
  const types = only(sections, 1).payload, typeCursor = { p: 0 };
  readU(types, typeCursor);
  assert(types.subarray(typeCursor.p, typeCursor.p + 4).equals(Buffer.from([0x60, 1, 0x7f, 0])), 'Type0 must be (i32)->void');
  const fnTypes = vector(only(sections, 3).payload, readU).entries;
  const bodies = codeBodies(only(sections, 10).payload), tintIndex = 9409 - imports.functions, retIndex = 2870 - imports.functions;
  assert.equal(fnTypes.length, bodies.length);
  assert.equal(fnTypes[tintIndex], 0); assert.equal(fnTypes[retIndex], 0);
  assert.equal(sha(bodies[tintIndex]), TINT_SHA); assert.equal(sha(bodies[retIndex]), RET_SHA);
  assert.equal(bodies[retIndex].toString('hex'), RET_HEX, 'Guest RET helper preimage changed');
  const globals = only(sections, 6).payload, globalsCursor = { p: 0 }, globalsCount = readU(globals, globalsCursor);
  const globalIndex = imports.globals + globalsCount;
  const newGlobals = Buffer.concat([uleb(globalsCount + 1), globals.subarray(globalsCursor.p), Buffer.from([0x7f, 1, 0x41, 0, 0x0b])]);
  const exports = only(sections, 7).payload;
  const exportEntries = vector(exports, (b, c) => ({ name: readName(b, c), kind: b[c.p++], index: readU(b, c) }));
  assert(!exportEntries.entries.some(e => e.name === FLAG_NAME), 'Flag export already exists');
  const newExports = Buffer.concat([uleb(exportEntries.count + 1), exports.subarray(exportEntries.entriesStart), name(FLAG_NAME), Buffer.from([3]), uleb(globalIndex)]);
  const originalTint = bodies[tintIndex], localBytes = localsEnd(originalTint), prefix = guard(globalIndex, 2870);
  bodies[tintIndex] = Buffer.concat([originalTint.subarray(0, localBytes), prefix, originalTint.subarray(localBytes)]);
  assert(bodies[tintIndex].subarray(localBytes + prefix.length).equals(originalTint.subarray(localBytes)));
  const newCode = Buffer.concat([uleb(bodies.length), ...bodies.flatMap(body => [uleb(body.length), body])]);
  const replacements = new Map([[6, newGlobals], [7, newExports], [10, newCode]]);
  const output = Buffer.concat([input.subarray(0, 8), ...sections.map(s => replacements.has(s.id) ? section(s.id, replacements.get(s.id)) : s.raw)]);
  assert(WebAssembly.validate(output), 'Patched module failed V8 validation');
  return { output, report: {
    input: { bytes: input.length, sha256: sha(input) }, output: { bytes: output.length, sha256: sha(output), validatedByNode: true },
    functionIndex: 9409, functionType: '(i32 registers) -> void', helperIndex: 2870,
    originalTintBodySha256: TINT_SHA, helperBodySha256: RET_SHA, patchedTintBodySha256: sha(bodies[tintIndex]),
    globalIndex, flagExport: FLAG_NAME, defaultValue: 0, guardBytes: prefix.length, localDeclarationBytes: localBytes,
    resumeGuardAddress: RESUME_PC, changedSections: [6, 7, 10],
  } };
}
