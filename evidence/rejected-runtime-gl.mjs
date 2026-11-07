import assert from 'node:assert/strict';

export function patchRuntime(source) {
const changes = [
  [
    '  GLctx.bufferData(target, data ? HEAPU8.subarray(data >>> 0, data + size >>> 0) : size, usage);',
    '  if (data && size > 0 && data + size <= HEAPU8.length)\n' +
    '    GLctx.bufferData(target, HEAPU8, usage, data, size);\n' +
    '  else GLctx.bufferData(target, data ? HEAPU8.subarray(data >>> 0, data + size >>> 0) : size, usage);'
  ],
  [
    '  GLctx.bufferSubData(target, offset, HEAPU8.subarray(data >>> 0, data + size >>> 0));',
    '  if (size > 0 && data + size <= HEAPU8.length)\n' +
    '    GLctx.bufferSubData(target, offset, HEAPU8, data, size);\n' +
    '  else GLctx.bufferSubData(target, offset, HEAPU8.subarray(data >>> 0, data + size >>> 0));'
  ],
  [
    '      GLctx.bufferSubData(34962, 0, HEAPU8.subarray(cb.ptr >>> 0, cb.ptr + size >>> 0));',
    '      if (size > 0 && (cb.ptr >>> 0) + size <= HEAPU8.length)\n' +
    '        GLctx.bufferSubData(34962, 0, HEAPU8, cb.ptr >>> 0, size);\n' +
    '      else GLctx.bufferSubData(34962, 0, HEAPU8.subarray(cb.ptr >>> 0, cb.ptr + size >>> 0));'
  ],
  [
    '    GLctx.bufferSubData(34963, 0, HEAPU8.subarray(indices >>> 0, indices + size >>> 0));',
    '    if (size > 0 && indices + size <= HEAPU8.length)\n' +
    '      GLctx.bufferSubData(34963, 0, HEAPU8, indices, size);\n' +
    '    else GLctx.bufferSubData(34963, 0, HEAPU8.subarray(indices >>> 0, indices + size >>> 0));'
  ],
  [
    '  GLctx.compressedTexImage2D(target, level, internalFormat, width, height, border, HEAPU8.subarray((data) >>> 0, data + imageSize >>> 0));',
    '  if (imageSize > 0 && data + imageSize <= HEAPU8.length)\n' +
    '    GLctx.compressedTexImage2D(target, level, internalFormat, width, height, border, HEAPU8, data, imageSize);\n' +
    '  else GLctx.compressedTexImage2D(target, level, internalFormat, width, height, border, HEAPU8.subarray((data) >>> 0, data + imageSize >>> 0));'
  ],
  [
    'function _glUniformMatrix4fv(location, count, transpose, value) {\n  value >>>= 0;',
    'function _glUniformMatrix4fv(location, count, transpose, value) {\n  value >>>= 0;\n' +
    '  // WebGL2 accepts a heap range directly; retain the old zero/invalid-range behavior below.\n' +
    '  if (count > 0 && count * 16 <= HEAPF32.length - (value >>> 2)) {\n' +
    '    GLctx.uniformMatrix4fv(webglGetUniformLocation(location), !!transpose, HEAPF32, value >>> 2, count * 16);\n' +
    '    return;\n' +
    '  }'
  ]
];
for (const [before, after] of changes) {
  assert.equal(source.split(before).length - 1, 1, `Expected exactly one upstream upload site: ${before.slice(0, 70)}`);
  source = source.replace(before, after);
}
return source;
}
