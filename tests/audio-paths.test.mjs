import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {patchDownloadedAudio} from '../patches/downloaded-audio.mjs';
const source=patchDownloadedAudio(gunzipSync(fs.readFileSync(new URL('../upstream/loader.gz',import.meta.url)))).toString();
const start=source.indexOf('      candidates: function(path) {'),end=source.indexOf('      play: function(soundId, groupId, paused) {',start);
assert(start>0&&end>start);
const bytes=new Uint8Array([79,103,103,83]);let reads=[],decodes=0;
const audio=runInNewContext('({'+source.slice(start,end)+'})',{
 Module:{FS:{readFile(path){reads.push(path);if(path!=='/AppData/10013017.ogg')throw Error('File not found');return bytes;}}},
 fetch(){throw Error('A downloaded file must not fall through to HTTP');}
});
audio.next=1;audio.sounds={};audio.ensure=()=>({decodeAudioData:async buffer=>{assert.deepEqual(new Uint8Array(buffer),bytes);decodes++;return {duration:42};}});
for(const name of ['10013017.ogg','C:\\10013017.ogg']){
 const id=audio.soundNew(name,true);await Promise.resolve();
 assert.equal(audio.sounds[id].state,1);assert.equal(audio.sounds[id].len,42000);
}
assert.equal(decodes,2);
assert(reads.includes('/AppData/10013017.ogg'));assert(audio.candidates('StereoMadness.mp3').includes('/Resources/StereoMadness.mp3'));
assert(audio.candidates('C:\\StereoMadness.mp3').includes('/Resources/StereoMadness.mp3'));
console.log('Audio checks passed: native downloaded file opens from AppData and decodes without an HTTP fallback; resource lookup retained.');
