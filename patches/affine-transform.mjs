import assert from 'node:assert/strict';
import {sha, readSections, readU, uleb, sleb, section, codeBodies, RESUME_PC, HEAP_BASE_SLOT, RET_SHA} from './reduced-area-colors.mjs';

const INPUT_SHA='72dfc0317b8c2b45a856a0a9b8a11be71e25d79d6b055ed04bc43c138efa1b4e';
const BODY_SHA='fff2415a73b937218148601ad80ed036c040b7af74b6b1f7eb7bc5c4393d1bc4';
const FN=4724, RET=2870, IMPORTS=151;
const join=(...parts)=>Buffer.concat(parts.flat());
const op=(...bytes)=>Buffer.from(bytes.flat());
const get=n=>join(op(0x20),uleb(n)), set=n=>join(op(0x21),uleb(n));
const ci=n=>join(op(0x41),sleb(n)), cl=n=>join(op(0x42),sleb(n));
const load=(code,offset=0)=>join(op(code,0),uleb(offset));
const store=(code,offset=0)=>join(op(code,0),uleb(offset));
const ext=value=>join(value,op(0xad));
function splitLocals(body){
  const cursor={p:0},groups=readU(body,cursor),entriesStart=cursor.p;let count=0;
  for(let i=0;i<groups;i++){count+=readU(body,cursor);cursor.p++;}
  return {groups,entriesStart,end:cursor.p,count};
}

// The low 128 bits of each native XMM register live 64 bytes apart.
// Keep the original operand and guest load/store order, including overlap.
function compactPrefix(firstLocal=18,retIndex=RET){
  const [base,a,b,d]=[0,1,2,3].map(i=>firstLocal+i);
  const [out,pa,pb,sp]=[0,1,2,3].map(i=>firstLocal+4+i);
  const x=Array.from({length:6},(_,i)=>firstLocal+9+i);
  const addr=(local,offset=0)=>join(get(local),load(0x2a,offset));
  const math=(target,left,right,opcode)=>join(left,right,op(opcode),set(x[target]));
  const put=(offset,local)=>join(get(d),get(local),store(0x38,offset));
  const maxBytes=join(op(0x3f,0),op(0xad),cl(65536),op(0x7e));
  const inBounds=(address,size)=>join(ext(address),cl(size),op(0x7c),maxBytes,op(0x58));
  const disjoint=(left,leftSize,right,rightSize)=>join(
    ext(left),cl(leftSize),op(0x7c),ext(right),op(0x58),
    ext(right),cl(rightSize),op(0x7c),ext(left),op(0x58,0x72),
  );
  const require=condition=>join(condition,op(0x45,0x0d,0));
  return join(
    op(0x02,0x40),
    require(join(ci(RESUME_PC),load(0x28),op(0x45))),
    require(inBounds(get(0),2048)),
    ci(HEAP_BASE_SLOT),load(0x28),set(base),
    get(0),load(0x29,8),set(out),get(0),load(0x29,16),set(pa),
    get(0),load(0x29,64),set(pb),get(0),load(0x29,32),set(sp),
    ...[[pa,a],[pb,b],[out,d]].map(([pointer,local])=>join(get(base),get(pointer),op(0xa7,0x6a),set(local))),
    ...[[a,24],[b,24],[d,24]].map(([local,size])=>require(inBounds(get(local),size))),
    require(inBounds(join(get(base),get(sp),op(0xa7,0x6a)),8)),
    ...[[a,24],[b,24],[d,24]].map(([local,size])=>require(disjoint(get(local),size,get(0),2048))),
    require(disjoint(join(get(base),get(sp),op(0xa7,0x6a)),8,get(0),2048)),
    ...[HEAP_BASE_SLOT,RESUME_PC].flatMap(slot=>[
      require(disjoint(get(d),24,ci(slot),4)),
      require(disjoint(get(0),2048,ci(slot),4)),
    ]),
    addr(a),set(x[3]),addr(a,4),set(x[2]),
    math(0,addr(b),get(x[3]),0x94),
    math(1,addr(b,8),get(x[2]),0x94),
    addr(b,12),set(x[5]),addr(a,16),set(x[4]),
    math(1,get(x[0]),get(x[1]),0x92),
    math(0,addr(b,4),get(x[3]),0x94),
    addr(a,12),set(x[3]),put(0,x[1]),
    math(1,get(x[2]),get(x[5]),0x94),
    // Loading A.c precedes the second output store in the original.
    addr(a,8),set(x[2]),math(1,get(x[1]),get(x[0]),0x92),
    math(0,addr(b),get(x[2]),0x94),
    math(2,addr(b,4),get(x[2]),0x94),
    put(4,x[1]),
    math(1,get(x[0]),join(addr(b,8),get(x[3]),op(0x94)),0x92),
    math(3,get(x[5]),get(x[3]),0x94),
    math(0,addr(b),get(x[4]),0x94),
    math(4,addr(b,4),get(x[4]),0x94),
    math(3,get(x[3]),get(x[2]),0x92),
    addr(a,20),set(x[2]),put(8,x[1]),
    math(1,join(addr(b,8),get(x[2]),op(0x94)),get(x[0]),0x92),
    math(2,get(x[5]),get(x[2]),0x94),
    put(12,x[3]),math(2,get(x[2]),get(x[4]),0x92),
    math(1,addr(b,16),get(x[1]),0x92),
    math(2,get(x[2]),addr(b,20),0x92),
    put(16,x[1]),put(20,x[2]),
    ...x.flatMap((local,i)=>[
      get(0),get(local),store(0x38,988+i*64),
      get(0),cl(0),store(0x37,992+i*64),
      get(0),ci(0),store(0x36,1000+i*64),
    ]),
    get(0),get(out),store(0x37,0),
    get(0),op(0x10),uleb(retIndex),op(0x0f,0x0b),
  );
}
function patchedBody(original){
  const locals=splitLocals(original);assert.equal(locals.count,17);
  const declarations=join(uleb(locals.groups+3),original.subarray(locals.entriesStart,locals.end),op(4,0x7f,5,0x7e,6,0x7d));
  const prefix=compactPrefix(locals.count+1);
  return {body:join(declarations,prefix,original.subarray(locals.end)),prefixBytes:prefix.length,declarationsBytes:declarations.length,originalDeclarationsBytes:locals.end};
}
export function patchAffine(input){
  assert.equal(sha(input),INPUT_SHA,'Refusing an unverified tint-enabled engine');
  const sections=readSections(input), one=id=>sections.find(s=>s.id===id).payload;
  const ic={p:0};assert.equal(readU(one(2),ic),IMPORTS);
  const fc={p:0},types=one(3),count=readU(types,fc),indices=[];
  for(let i=0;i<count;i++)indices.push(readU(types,fc));
  assert.equal(indices[FN-IMPORTS],0);assert.equal(indices[RET-IMPORTS],0);
  const bodies=codeBodies(one(10)),original=bodies[FN-IMPORTS];
  assert.equal(sha(original),BODY_SHA,'Affine function preimage changed');
  assert.equal(sha(bodies[RET-IMPORTS]),RET_SHA,'Native RET helper preimage changed');
  const changed=patchedBody(original);bodies[FN-IMPORTS]=changed.body;
  const newCode=join(uleb(bodies.length),bodies.flatMap(b=>[uleb(b.length),b]));
  const output=join(input.subarray(0,8),sections.map(s=>s.id===10?section(10,newCode):s.raw));
  assert(WebAssembly.validate(output));
  return {output,report:{inputSha256:sha(input),inputBytes:input.length,outputSha256:sha(output),outputBytes:output.length,functionIndex:FN,originalBodySha256:BODY_SHA,patchedBodySha256:sha(changed.body),originalBodyBytes:original.length,patchedBodyBytes:changed.body.length,prefixBytes:changed.prefixBytes,declarationsBytes:changed.declarationsBytes,originalDeclarationsBytes:changed.originalDeclarationsBytes,changedSections:[10],changedFunctions:[FN],originalFallbackPreserved:true,nonzeroResumeUsesOriginal:true,protectedMemoryAliasesUseOriginal:true,strictFloat32OperandOrder:true,validatedByNode:true}};
}
