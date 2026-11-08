import assert from 'node:assert/strict';
import {Script} from 'node:vm';
export function patchDownloadedAudio(original){
 let source=original.toString();
 const before='        add(noDrive);\n        add("/Resources/" + noDrive);';
 assert.equal(source.split(before).length-1,1,'Expected the upstream audio path lookup');
 source=source.replace(before,'        add(noDrive);\n        add("/AppData/" + base);\n        add("/Resources/" + noDrive);');
 new Script(source,{filename:'audio-runtime.js'});
 return Buffer.from(source);
}
