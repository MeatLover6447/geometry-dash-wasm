import fs from 'node:fs';
import {createGunzip,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {patchDownloadedAudio} from '../patches/downloaded-audio.mjs';
import {patchWasm} from '../patches/reduced-area-colors.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'dist/gd_assets.json'),'utf8'));
const upstream=JSON.parse(fs.readFileSync(path.join(root,'upstream/manifest.json'),'utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const originalEngine=gunzipSync(fs.readFileSync(path.join(root,'upstream/wasm.gz')));
assert.equal(hash(originalEngine),upstream.wasm.sha256,'Upstream native engine integrity');
assert.equal(hash(patchWasm(originalEngine).output),manifest.wasm.sha256,'Only the verified optional area-color patch may change the engine');
assert.equal(manifest.data.sha256,upstream.data.sha256,'Full game data must remain unchanged');
const combined=createHash('sha256');
for(const entry of [manifest.wasm,manifest.loader,...manifest.data.chunks]){
 const file=path.join(root,'dist',entry.url);assert.equal(fs.statSync(file).size,entry.compressedSize);
 const digest=createHash('sha256');let bytes=0;
 for await(const chunk of fs.createReadStream(file).pipe(createGunzip())){digest.update(chunk);bytes+=chunk.length;if(manifest.data.chunks.includes(entry))combined.update(chunk);}
 assert.equal(bytes,entry.size,entry.url);assert.equal(digest.digest('hex'),entry.sha256,entry.url);
}
assert.equal(combined.digest('hex'),manifest.data.sha256);
for(const [file,sha]of Object.entries(manifest.supportFiles))assert.equal(hash(fs.readFileSync(path.join(root,'dist',file))),sha,file);
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');assert(!/<script[^>]+src=["']https?:/i.test(html));
assert.equal(hash(html.replaceAll(manifest.build,'__GD_BUILD__')),manifest.wrapperSourceSha256,'Wrapper integrity');
const runtime=gunzipSync(fs.readFileSync(path.join(root,'dist',manifest.loader.url)));
assert.deepEqual(runtime,patchDownloadedAudio(gunzipSync(fs.readFileSync(path.join(root,'upstream/loader.gz')))));
console.log('Build integrity passed: all payloads, full data package, native engine, downloaded-audio patch and modified asset loader.');
