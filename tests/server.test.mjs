import assert from 'node:assert/strict';
import {createServer,gameTarget} from '../serve.mjs';
import {readFile} from 'node:fs/promises';
assert.equal(gameTarget('http://www.boomlings.com/database/getGJLevels21.php').protocol,'https:');
assert.equal(gameTarget('https://geometrydashcontent.b-cdn.net/songs/467339.mp3').hostname,'geometrydashcontent.b-cdn.net');
for(const url of ['http://127.0.0.1/','http://localhost/','file:///C:/Windows/win.ini','https://evil.example/','https://www.boomlings.com.evil.example/','https://user:secret@www.boomlings.com/','https://www.boomlings.com:444/'])assert.throws(()=>gameTarget(url));
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const base=`http://127.0.0.1:${server.address().port}`;
  let r=await fetch(base);assert.equal(r.status,200);assert.match(await r.text(),/Module\._gd_boot/);
  r=await fetch(base+'/gd_assets.json',{headers:{Range:'bytes=0-99'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,100);
  r=await fetch(base+'/gd_assets.json',{headers:{Range:'bytes=999999999-'}});assert.equal(r.status,416);
  r=await fetch(base+'/__proxy?url='+encodeURIComponent('http://localhost/'));assert.equal(r.status,403);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith(base))return originalFetch(url,options);
    if(String(url).endsWith('/getGJSongInfo.php'))return new Response('1~|~404117~|~10~|~'+encodeURIComponent('https://audio.ngfiles.com/404000/404117.mp3'));
    assert.equal(String(url),'https://audio.ngfiles.com/404000/404117.mp3');return new Response('ID3test',{headers:{'Content-Type':'audio/mpeg'}});
  };
  try{r=await fetch(base+'/__proxy?url='+encodeURIComponent('https://www.newgrounds.com/audio/download/404117'));assert.equal(r.status,200);assert.equal(await r.text(),'ID3test');}finally{globalThis.fetch=originalFetch;}
  r=await fetch(base+'/..%5c..%5cserve.mjs');assert.equal(r.status,403);
  const manifest=JSON.parse(await readFile(new URL('../dist/gd_assets.json',import.meta.url),'utf8'));
  r=await fetch(base+`/engine/${manifest.wasm.sha256}.wasm`,{method:'HEAD'});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/wasm');assert.equal(r.headers.get('content-encoding'),'gzip');assert.match(r.headers.get('cache-control'),/immutable/);
  console.log('Server checks passed: static files, ranges, path validation, game-service allowlist.');
}finally{await new Promise(resolve=>server.close(resolve));}
