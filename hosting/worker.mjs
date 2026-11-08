const engine=__ENGINE_INFO__;
async function assets(request,env){
 const pathname=new URL(request.url).pathname;
 const relative=pathname.startsWith('/game/')?pathname.slice(6):'';
 if(engine.assetBase&&engine.remotePaths.includes(relative)){
  return fetch(new URL(relative,engine.assetBase),{method:request.method,cf:{cacheEverything:true,cacheTtl:86400}});
 }
 return env.ASSETS.fetch(request);
}
const hosts=new Set(['boomlings.com','www.boomlings.com','accounts.boomlings.com','geometrydashcontent.com','www.geometrydashcontent.com','download.geometrydashcontent.com','geometrydashfiles.b-cdn.net','geometrydashcontent.b-cdn.net','newgrounds.com','www.newgrounds.com','audio.ngfiles.com','api.newgrounds.com']);
export function gameTarget(value){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||!hosts.has(url.hostname)||url.username||url.password||url.port)throw Error('Unsupported game service');
 if(url.hostname.endsWith('boomlings.com'))url.protocol='https:';
 return url;
}
async function gameProxy(request,url){
 let target;try{target=gameTarget(url.searchParams.get('url'));}catch{return new Response('Unsupported game service',{status:403});}
 if(!['GET','HEAD','POST'].includes(request.method))return new Response(null,{status:405});
 let method=request.method,body;
 const song=/^\/audio\/download\/(\d{1,10})\/?$/.exec(target.pathname);
 if((target.hostname==='newgrounds.com'||target.hostname==='www.newgrounds.com')&&song&&method!=='POST'){
  // Resolve the game's legacy download URLs through its official song metadata.
  const info=await fetch('https://www.boomlings.com/database/getGJSongInfo.php',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':''},body:'songID='+song[1]+'&secret=Wmfd2893gb7'});
  if(!info.ok)return new Response('Song metadata unavailable',{status:502});
  const fields=(await info.text()).split('~|~');
  const key=fields.findIndex((value,index)=>index%2===0&&value==='10');
  if(fields[0]!=='1'||fields[1]!==song[1]||key<0||!fields[key+1])return new Response('Song unavailable from the game service',{status:404});
  try{target=gameTarget(decodeURIComponent(fields[key+1]));}catch{return new Response('Unsupported song download address',{status:502});}
 }
 if(method==='POST'){
  const chunks=[],reader=request.body?.getReader();let size=0;
  if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16*1024*1024){await reader.cancel();return new Response('Request too large',{status:413});}chunks.push(part.value);}
  body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
 }
 for(let hops=0;hops<6;hops++){
  const response=await fetch(target,{method,body,redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'Content-Type':request.headers.get('content-type')||'application/x-www-form-urlencoded','Accept':'*/*','User-Agent':''}});
  if([301,302,303,307,308].includes(response.status)&&response.headers.get('location')){
   const next=new URL(response.headers.get('location'),target);await response.body?.cancel();
   try{target=gameTarget(next.href);}catch{return new Response('Unsupported redirect',{status:403});}
   if([301,302,303].includes(response.status)){method='GET';body=undefined;}continue;
  }
  return new Response(method==='HEAD'?null:response.body,{status:response.status,headers:{'Content-Type':response.headers.get('content-type')||'application/octet-stream','Cache-Control':'no-store'}});
 }
 return new Response('Too many redirects',{status:502});
}
function nativeWasm(request,env){
 const headers={'Content-Type':'application/wasm','Content-Encoding':'gzip','Content-Length':String(engine.compressedSize),'Cache-Control':'public, max-age=31536000, immutable'};
 if(request.method==='HEAD')return new Response(null,{headers,encodeBody:'manual'});
 let index=0,reader;
 const body=new ReadableStream({
  async pull(controller){
   while(!reader){
    if(index===engine.parts.length){controller.close();return;}
    const asset=await assets(new Request(new URL(engine.parts[index++],request.url)),env);
    if(!asset.ok||!asset.body){controller.error(Error('Engine asset unavailable'));return;}
    reader=asset.body.getReader();
   }
   const next=await reader.read();
   if(next.done){reader=null;return this.pull(controller);}
   controller.enqueue(next.value);
  },
  cancel(reason){return reader?.cancel(reason);}
 });
 return new Response(body,{headers,encodeBody:'manual'});
}
export default {
 async fetch(request,env){
  try{
   const url=new URL(request.url);
   if(url.pathname==='/')return Response.redirect(new URL('/game/index.html',url),302);
   if(url.pathname==='/__proxy')return await gameProxy(request,url);
   if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
   if(url.pathname===`/engine/${engine.sha256}.wasm`)return nativeWasm(request,env);
   return await assets(request,env);
  }catch{return new Response('Request failed',{status:502});}
 }
};
