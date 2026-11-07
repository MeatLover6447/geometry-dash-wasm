import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
const payload=gzipSync(Buffer.from('native test payload'));
const engine={sha256:'a'.repeat(64),compressedSize:payload.length,parts:['/game/payload/wasm-a.gz'],assetBase:'https://raw.githubusercontent.com/MeatLover6447/geometry-dash-wasm/test/dist/',remotePaths:['payload/wasm-a.gz','payload/data-b.gz']};
const source=fs.readFileSync(new URL('../hosting/worker.mjs',import.meta.url),'utf8').replace('__ENGINE_INFO__',JSON.stringify(engine));
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const originalFetch=globalThis.fetch;let remote=0,local=0;
const env={ASSETS:{fetch:async()=>{local++;return new Response('local shell');}}};
globalThis.fetch=async(url,options)=>{remote++;assert.equal(options.method,'GET');assert.equal(String(url),engine.assetBase+'payload/wasm-a.gz');return new Response(payload);};
try{
 let response=await worker.fetch(new Request('https://game.test/'),env);assert.equal(response.status,302);
 response=await worker.fetch(new Request(`https://game.test/engine/${engine.sha256}.wasm`,{method:'HEAD'}),env);assert.equal(response.status,200);assert.equal(response.body,null);assert.equal(remote,0);
 response=await worker.fetch(new Request(`https://game.test/engine/${engine.sha256}.wasm`),env);assert.equal(response.headers.get('content-type'),'application/wasm');assert.equal(response.headers.get('content-encoding'),'gzip');
 assert.equal(gunzipSync(Buffer.from(await response.arrayBuffer())).toString(),'native test payload');assert.equal(remote,1);
 response=await worker.fetch(new Request('https://game.test/game/payload/wasm-a.gz'),env);assert.deepEqual(Buffer.from(await response.arrayBuffer()),payload);assert.equal(remote,2);
 response=await worker.fetch(new Request('https://game.test/game/payload/unknown.gz'),env);assert.equal(await response.text(),'local shell');assert.equal(remote,2);assert.equal(local,1);
 response=await worker.fetch(new Request('https://game.test/__proxy?url=http://localhost/'),env);assert.equal(response.status,403);assert.equal(remote,2);
 console.log('Worker checks passed: pinned asset allowlist, streaming native gzip, HEAD, local fallback, restricted service proxy.');
}finally{globalThis.fetch=originalFetch;}
