import assert from 'node:assert/strict';
import {createServer,gameTarget} from '../serve.mjs';
import {readFile} from 'node:fs/promises';
assert.equal(gameTarget('http://www.boomlings.com/database/getGJLevels21.php').protocol,'https:');
assert.equal(gameTarget('https://geometrydashcontent.b-cdn.net/songs/467339.mp3').hostname,'geometrydashcontent.b-cdn.net');
for(const url of ['http://127.0.0.1/','http://localhost/','file:///C:/Windows/win.ini','https://evil.example/','https://www.boomlings.com.evil.example/','https://user:secret@www.boomlings.com/','https://www.boomlings.com:444/'])assert.throws(()=>gameTarget(url));
for(const host of ['www.robtopgames.org','www.robtopgames.net']){
  assert.equal(gameTarget(`http://${host}/database/accounts/syncGJAccountNew.php`).protocol,'https:');
  assert.throws(()=>gameTarget(`https://${host}/database/unrelated.php`));
  assert.throws(()=>gameTarget(`https://${host}.evil.example/database/accounts/syncGJAccountNew.php`));
}
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
  const accountBody='accountID=0&gjp2=dummy&saveData=encoded%2B%2F%3D&secret=test';
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith(base))return originalFetch(url,options);
    assert.match(String(url),/^https:\/\/www\.robtopgames\.(org|net)\/database\/accounts\/(sync|backup)GJAccountNew\.php$/);
    assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded');assert.equal(options.body.toString(),accountBody);
    return new Response('test-save;test-levels;21;0',{headers:{'Content-Type':'text/plain'}});
  };
  try{
    for(const host of ['www.robtopgames.org','www.robtopgames.net'])for(const endpoint of ['syncGJAccountNew.php','backupGJAccountNew.php']){
      r=await fetch(base+'/__proxy?url='+encodeURIComponent(`http://${host}/database/accounts/${endpoint}`),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:accountBody});
      assert.equal(r.status,200);assert.equal(await r.text(),'test-save;test-levels;21;0');assert.equal(r.headers.get('cache-control'),'no-store');
    }
  }finally{globalThis.fetch=originalFetch;}
  r=await fetch(base+'/..%5c..%5cserve.mjs');assert.equal(r.status,403);
  const manifest=JSON.parse(await readFile(new URL('../dist/gd_assets.json',import.meta.url),'utf8'));
  r=await fetch(base+`/engine/${manifest.wasm.sha256}.wasm`,{method:'HEAD'});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/wasm');assert.equal(r.headers.get('content-encoding'),'gzip');assert.match(r.headers.get('cache-control'),/immutable/);
  console.log('Server checks passed: static files, ranges, path validation, game-service allowlist.');
}finally{await new Promise(resolve=>server.close(resolve));}
