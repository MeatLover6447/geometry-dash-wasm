import assert from 'node:assert/strict';
import { sha, readSections, readU, uleb, sleb, section, name, codeBodies, RESUME_PC, HEAP_BASE_SLOT, RET_SHA } from './reduced-area-colors.mjs';

export const INPUT_SHA = '72dfc0317b8c2b45a856a0a9b8a11be71e25d79d6b055ed04bc43c138efa1b4e';
export const FLAG_NAME = 'gdSectionFastPath';
export const FN = 12963, RET = 2870, IMPORTS = 151;
export const shaBody = 'e46bd2bca9bc4aea087700de911cb569bb7f4b93a5a6cd6729d528f7c28246e7';
export const op = (...bytes) => Buffer.from(bytes.flat());
export const join = (...parts) => Buffer.concat(parts.flat());
export const get = n => join(op(0x20), uleb(n));
export const set = n => join(op(0x21), uleb(n));
export const ci = n => join(op(0x41), sleb(n));
export const cd = n => { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(n); return join(op(0x44), bytes); };
const load = (opcode, offset = 0) => join(op(opcode, 0), uleb(offset));
const within = (local, max) => join(get(local), cd(0), op(0x66), get(local), cd(max), op(0x63, 0x71));
export function fastPrefix(flagIndex, firstLocal = 29) {
  const [base, layer, object, x, y, px, py] = Array.from({ length: 7 }, (_, i) => firstLocal + i);
  // Native COMISD branches clamp every ordered coordinate <=0 to +0, before
  // reading the section factor. NaN is unordered and must not take that path.
  // The br_if exits the surrounding domain block, preserving the original body
  // for NaN, +Infinity and coordinates at/above the native upper clamp.
  const axis = (coordinate, product, factorOffset) => join(
    get(coordinate), cd(0), op(0x65, 0x04, 0x40),
    cd(0), set(product), op(0x05),
    get(coordinate), cd(10000000), op(0x63, 0x45, 0x0d, 1),
    get(layer), load(0x2a, factorOffset), op(0xbb), get(coordinate), op(0xa2), set(product),
    op(0x0b),
  );
  return join(
    op(0x23), uleb(flagIndex), op(0x04, 0x40),
    ci(RESUME_PC), load(0x28), op(0x45, 0x04, 0x40),
    ci(HEAP_BASE_SLOT), load(0x28), set(base),
    get(base), get(0), load(0x29, 16), op(0xa7, 0x6a), set(object),
    // Native's first signed cached-X test returns without reading the layer,
    // coordinates or factors. Preserve the native resume guard above it.
    get(object), load(0x28, 0x278), ci(0), op(0x48, 0x04, 0x40),
    get(0), op(0x10), uleb(RET), op(0x0f, 0x0b),
    get(base), get(0), load(0x29, 8), op(0xa7, 0x6a), set(layer),
    get(object), load(0x2b, 0x3b8), set(x), get(object), load(0x2b, 0x3c0), set(y),
    op(0x02, 0x40), axis(x, px, 0x37a0), axis(y, py, 0x37a4),
    within(px, 2147483648), within(py, 2147483648), op(0x71, 0x04, 0x40),
    get(px), op(0xaa), get(object), load(0x28, 0x278), op(0x46),
    get(py), op(0xaa), get(object), load(0x28, 0x27c), op(0x46, 0x71, 0x04, 0x40),
    get(0), op(0x10), uleb(RET), op(0x0f),
    op(0x0b, 0x0b, 0x0b, 0x0b, 0x0b),
  );
}
export function splitLocals(body) {
  const cursor = { p: 0 }, groups = readU(body, cursor), entriesStart = cursor.p;
  let count = 0;
  for (let i = 0; i < groups; i++) { count += readU(body, cursor); cursor.p++; }
  return { groups, entriesStart, end: cursor.p, count };
}
export function patchedBody(original, flagIndex) {
  const locals = splitLocals(original);
  assert.equal(locals.count, 28);
  const declarations = join(uleb(locals.groups + 2), original.subarray(locals.entriesStart, locals.end), op(3, 0x7f, 4, 0x7c));
  const prefix = fastPrefix(flagIndex, locals.count + 1);
  const body = join(declarations, prefix, original.subarray(locals.end));
  assert(body.subarray(declarations.length + prefix.length).equals(original.subarray(locals.end)));
  return { body, prefixBytes: prefix.length, declarationsBytes: declarations.length, originalDeclarationsBytes: locals.end };
}
export function patchSectionUpdates(input) {
  assert.equal(sha(input), INPUT_SHA, 'Input must be the current tint-enabled engine');
  const sections = readSections(input), one = id => sections.find(s => s.id === id).payload;
  const imports = one(2), ic = { p: 0 };
  assert.equal(readU(imports, ic), IMPORTS);
  const types = one(1), tc = { p: 0 }; readU(types, tc);
  assert(types.subarray(tc.p, tc.p + 4).equals(op(0x60, 1, 0x7f, 0)));
  const fnTypes = one(3), fc = { p: 0 }, count = readU(fnTypes, fc), indices = [];
  for (let i = 0; i < count; i++) indices.push(readU(fnTypes, fc));
  assert.equal(indices[FN - IMPORTS], 0); assert.equal(indices[RET - IMPORTS], 0);
  const bodies = codeBodies(one(10)), original = bodies[FN - IMPORTS];
  assert.equal(sha(original), shaBody, 'Section function preimage changed');
  assert.equal(sha(bodies[RET - IMPORTS]), RET_SHA, 'RET helper changed');
  const globals = one(6), gc = { p: 0 }, flagIndex = readU(globals, gc);
  assert.equal(flagIndex, 37);
  const newGlobals = join(uleb(flagIndex + 1), globals.subarray(gc.p), op(0x7f, 1, 0x41, 0, 0x0b));
  const exports = one(7), ec = { p: 0 }, exportsCount = readU(exports, ec);
  assert(!exports.includes(Buffer.from(FLAG_NAME)));
  const newExports = join(uleb(exportsCount + 1), exports.subarray(ec.p), name(FLAG_NAME), op(3), uleb(flagIndex));
  const details = patchedBody(original, flagIndex); bodies[FN - IMPORTS] = details.body;
  const newCode = join(uleb(bodies.length), bodies.flatMap(b => [uleb(b.length), b]));
  const replacements = new Map([[6, newGlobals], [7, newExports], [10, newCode]]);
  const output = join(input.subarray(0, 8), sections.map(s => replacements.has(s.id) ? section(s.id, replacements.get(s.id)) : s.raw));
  assert(WebAssembly.validate(output));
  return { output, report: { version: 3, inputSha256: sha(input), inputBytes: input.length, outputSha256: sha(output), outputBytes: output.length, flagIndex, flagExport: FLAG_NAME, defaultValue: 0, functionIndex: FN, retHelperIndex: RET, originalBodySha256: sha(original), patchedBodySha256: sha(details.body), prefixBytes: details.prefixBytes, declarationsBytes: details.declarationsBytes, originalDeclarationsBytes: details.originalDeclarationsBytes, signedNegativeCachedXEarlyReturn: true, layerReadDelayedUntilAfterNegativeCachedX: true, nonpositiveCoordinatesClampToPositiveZero: true, originalInstructionsPreserved: true, validatedByNode: true } };
}
