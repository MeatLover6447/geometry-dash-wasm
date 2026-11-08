import http from 'node:http';
import {createReadStream,readFileSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Readable} from 'node:stream';
import {execFile} from 'node:child_process';

const root=fileURLToPath(new URL('./dist/',import.meta.url));
const manifest=JSON.parse(readFileSync(path.join(root,'gd_assets.json'),'utf8'));
const wasmPath=`/engine/${manifest.wasm.sha256}.wasm`;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.gz':'application/octet-stream','.wasm':'application/wasm'};
const allowedHosts=new Set(['boomlings.com','www.boomlings.com','accounts.boomlings.com','geometrydashcontent.com','www.geometrydashcontent.com','download.geometrydashcontent.com','geometrydashfiles.b-cdn.net','geometrydashcontent.b-cdn.net','newgrounds.com','www.newgrounds.com','audio.ngfiles.com','api.newgrounds.com']);
export function gameTarget(value){
  const target=new URL(value);
  if(!['http:','https:'].includes(target.protocol)||!allowedHosts.has(target.hostname)||target.username||target.password||target.port)throw Error('Unsupported game service');
  if(target.hostname.endsWith('boomlings.com'))target.protocol='https:';
  return target;
}
async function proxy(req,res,url){
  let target;try{target=gameTarget(url.searchParams.get('url'));}catch{res.writeHead(403).end('Unsupported game service');return;}
  if(!['GET','HEAD','POST'].includes(req.method)){res.writeHead(405).end();return;}
  let body,method=req.method;
  const song=/^\/audio\/download\/(\d{1,10})\/?$/.exec(target.pathname);
  if((target.hostname==='newgrounds.com'||target.hostname==='www.newgrounds.com')&&song&&method!=='POST'){
    // Resolve the game's legacy download URLs through its official song metadata.
    const info=await fetch('https://www.boomlings.com/database/getGJSongInfo.php',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':''},body:'songID='+song[1]+'&secret=Wmfd2893gb7'});
    if(!info.ok){res.writeHead(502).end('Song metadata unavailable');return;}
    const fields=(await info.text()).split('~|~');
    const key=fields.findIndex((value,index)=>index%2===0&&value==='10');
    if(fields[0]!=='1'||fields[1]!==song[1]||key<0||!fields[key+1]){res.writeHead(404).end('Song unavailable from the game service');return;}
    try{target=gameTarget(decodeURIComponent(fields[key+1]));}catch{res.writeHead(502).end('Unsupported song download address');return;}
  }
  if(method==='POST'){
    const chunks=[];let length=0;
    for await(const chunk of req){length+=chunk.length;if(length>16*1024*1024){res.writeHead(413).end('Request too large');return;}chunks.push(chunk);}
    body=Buffer.concat(chunks);
  }
  for(let hops=0;hops<6;hops++){
    const upstream=await fetch(target,{method,body,redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'Content-Type':req.headers['content-type']||'application/x-www-form-urlencoded','Accept':'*/*','User-Agent':''}});
    if([301,302,303,307,308].includes(upstream.status)&&upstream.headers.get('location')){
      const next=new URL(upstream.headers.get('location'),target);await upstream.body?.cancel();
      try{target=gameTarget(next.href);}catch{res.writeHead(403).end('Unsupported redirect');return;}
      if([301,302,303].includes(upstream.status)){method='GET';body=undefined;}continue;
    }
    res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/octet-stream','Cache-Control':'no-store'});
    if(method==='HEAD'||!upstream.body){res.end();return;}
    const stream=Readable.fromWeb(upstream.body);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
  }
  res.writeHead(502).end('Too many redirects');
}
export function createServer(){return http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/__proxy'){await proxy(req,res,url);return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    const nativeWasm=url.pathname===wasmPath;
    const pathname=decodeURIComponent(url.pathname),file=nativeWasm?path.resolve(root,manifest.wasm.url):path.resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
    if(!file.startsWith(root)){res.writeHead(403).end();return;}
    const info=await stat(file);if(!info.isFile()){res.writeHead(404).end();return;}
    let start=0,end=info.size-1,code=200;
    if(req.headers.range&&!nativeWasm){
      const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(!range||(!range[1]&&!range[2])){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
      if(range[1]){start=+range[1];if(range[2])end=Math.min(+range[2],end);}else start=Math.max(0,info.size-(+range[2]));
      if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}code=206;
    }
    const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':Math.max(0,end-start+1),'Accept-Ranges':'bytes','Cache-Control':pathname.startsWith('/payload/')?'public, max-age=31536000, immutable':'no-cache','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin','X-Content-Type-Options':'nosniff'};
    if(nativeWasm){headers['Content-Type']='application/wasm';headers['Content-Encoding']='gzip';headers['Cache-Control']='public, max-age=31536000, immutable';}
    if(code===206)headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
    res.writeHead(code,headers);if(req.method==='HEAD'||!info.size){res.end();return;}
    const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch(error){if(!res.headersSent)res.writeHead(error.code==='ENOENT'?404:502).end('Request failed');else res.destroy();}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4174),server=createServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Open http://127.0.0.1:${port} or set PORT to another number.`:error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${port}`;console.log(`Geometry Dash Native WASM: ${url}\nPress Ctrl+C to stop.`);
    if(process.argv.includes('--open')&&process.platform==='win32')execFile('cmd.exe',['/d','/c','start','',url]);
  });
}
