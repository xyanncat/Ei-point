import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateRelease,verifyBackup,readyPayload,probeFleet} from '../../scripts/lib/operations.mjs';
const services=['postgres','nginx','api','web','workers','tts-qwen','hy-mt2','bot-kafka','bot-himiko','bot-community','bot-ai','bot-music','bot-commerce'];
test('release refuses mutable tags, incomplete fleet and legacy overlapping identities',()=>{
 const images=Object.fromEntries(services.map(s=>[s,`example/${s}@sha256:${'a'.repeat(64)}`]));
 assert.doesNotThrow(()=>validateRelease({id:'release-1',images}));
 assert.throws(()=>validateRelease({id:'release-1',images:{...images,api:'example/api:latest'}}));
 const incomplete={...images};delete incomplete['bot-himiko'];assert.throws(()=>validateRelease({id:'r',images:incomplete}));
 assert.throws(()=>validateRelease({id:'r',images:{...images,'bot-security':images['bot-kafka']}}));
});
test('rollback can still validate a release manifest created before the local model services',()=>{
 const oldImages=Object.fromEntries(services.filter(s=>!['tts-qwen','hy-mt2'].includes(s)).map(s=>[s,`example/${s}@sha256:${'d'.repeat(64)}`]));
 assert.throws(()=>validateRelease({id:'old-release',images:oldImages}));
 assert.doesNotThrow(()=>validateRelease({id:'old-release',images:oldImages},{allowMissingTts:true,allowMissingHyMt2:true}));
});
test('release roster omits local models from old manifests but includes them for current releases',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-roster-'));
 try{
  const oldImages=Object.fromEntries(services.filter(s=>!['tts-qwen','hy-mt2'].includes(s)).map(s=>[s,`example/${s}@sha256:${'f'.repeat(64)}`]));
  const oldPath=join(dir,'old.json');await writeFile(oldPath,JSON.stringify({id:'old-release',images:oldImages}));
  const script=fileURLToPath(new URL('../../scripts/release-roster.mjs',import.meta.url));
  const oldResult=spawnSync(process.execPath,[script,oldPath,'--services'],{encoding:'utf8'});
  assert.equal(oldResult.status,0,oldResult.stderr);assert.doesNotMatch(oldResult.stdout,/tts-qwen|hy-mt2/);
  const currentPath=join(dir,'current.json');await writeFile(currentPath,JSON.stringify({id:'current-release',images:Object.fromEntries(services.map(s=>[s,`example/${s}@sha256:${'1'.repeat(64)}`]))}));
  const currentResult=spawnSync(process.execPath,[script,currentPath,'--services'],{encoding:'utf8'});
  assert.equal(currentResult.status,0,currentResult.stderr);assert.match(currentResult.stdout,/tts-qwen/);assert.match(currentResult.stdout,/hy-mt2/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('release compose wires actual local-model client keys only when the manifest includes the models',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-release-compose-'));
 try{
  const script=fileURLToPath(new URL('../../scripts/release-manifest.mjs',import.meta.url));
  const oldImages=Object.fromEntries(services.filter(s=>!['tts-qwen','hy-mt2'].includes(s)).map(s=>[s,`example/${s}@sha256:${'2'.repeat(64)}`]));
  const oldPath=join(dir,'old.json');await writeFile(oldPath,JSON.stringify({id:'old-release',images:oldImages}));
  const oldOutput=join(dir,'old.compose.json');
  const oldResult=spawnSync(process.execPath,[script,oldPath,oldOutput,'--allow-missing-tts','--allow-missing-hy-mt2'],{encoding:'utf8'});
  assert.equal(oldResult.status,0,oldResult.stderr);
  const oldCompose=JSON.parse(await readFile(oldOutput,'utf8'));
  assert.equal(oldCompose.services['bot-ai'].environment,undefined);
  assert.equal(await readFile(`${oldOutput}.hy-mt2`,'utf8'),'0\n');

  const currentPath=join(dir,'current.json');await writeFile(currentPath,JSON.stringify({id:'current-release',images:Object.fromEntries(services.map(s=>[s,`example/${s}@sha256:${'3'.repeat(64)}`]))}));
  const currentOutput=join(dir,'current.compose.json');
  const currentResult=spawnSync(process.execPath,[script,currentPath,currentOutput],{encoding:'utf8'});
  assert.equal(currentResult.status,0,currentResult.stderr);
  const currentCompose=JSON.parse(await readFile(currentOutput,'utf8'));
  assert.deepEqual(currentCompose.services['bot-ai'].environment,{QWEN_TTS_URL:'http://tts-qwen:3120/v1/audio/speech',HY_MT2_URL:'http://hy-mt2:3121/v1/chat/completions'});
  assert.equal(await readFile(`${currentOutput}.hy-mt2`,'utf8'),'1\n');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('release manifest generation survives an empty roster without inventing bot services',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-release-empty-'));
 try{
  const script=fileURLToPath(new URL('../../scripts/release-manifest.mjs',import.meta.url));
  const images=Object.fromEntries(['postgres','nginx','api','web','workers','tts-qwen','hy-mt2'].map(s=>[s,`example/${s}@sha256:${'5'.repeat(64)}`]));
  const source=join(dir,'empty.json');await writeFile(source,JSON.stringify({id:'empty-roster',bots:[],images}));
  const output=join(dir,'empty.compose.json');
  const result=spawnSync(process.execPath,[script,source,output],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const compose=JSON.parse(await readFile(output,'utf8'));
  assert.equal(compose.services['bot-ai'],undefined);
  assert.equal(compose.services['bot-kafka'],undefined);
  assert.equal(await readFile(`${output}.bots`,'utf8'),'\n');
  assert.equal(await readFile(`${output}.tts`,'utf8'),'1\n');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Kafka-only and Robin-only rosters render without attempting a Cyrene environment',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-release-single-'));
 try{
  const script=fileURLToPath(new URL('../../scripts/release-manifest.mjs',import.meta.url));
  for(const [id,bot] of [['kafka-only',{service:'bot-kafka',botKey:'kafka',port:3108}],['robin-only',{service:'bot-music',botKey:'robin',port:3105}]]){
   const names=['postgres','nginx','api','web','workers','tts-qwen','hy-mt2',bot.service];
   const source=join(dir,`${id}.json`);await writeFile(source,JSON.stringify({id,bots:[bot],images:Object.fromEntries(names.map(s=>[s,`example/${s}@sha256:${'6'.repeat(64)}`]))}));
   const output=join(dir,`${id}.compose.json`);
   const result=spawnSync(process.execPath,[script,source,output],{encoding:'utf8'});
   assert.equal(result.status,0,`${id}: ${result.stderr}`);
   const compose=JSON.parse(await readFile(output,'utf8'));
   assert.equal(compose.services['bot-ai'],undefined,id);
   assert.equal(compose.services[bot.service].image,`example/${bot.service}@sha256:${'6'.repeat(64)}`,id);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Cyrene-only roster wires Qwen and Hy-MT2 client keys for the one bot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-release-cyrene-'));
 try{
  const script=fileURLToPath(new URL('../../scripts/release-manifest.mjs',import.meta.url));
  const names=['postgres','nginx','api','web','workers','tts-qwen','hy-mt2','bot-ai'];
  const source=join(dir,'cyrene.json');await writeFile(source,JSON.stringify({id:'cyrene-only',bots:[{service:'bot-ai',botKey:'cyrene',port:3104}],images:Object.fromEntries(names.map(s=>[s,`example/${s}@sha256:${'7'.repeat(64)}`]))}));
  const output=join(dir,'cyrene.compose.json');
  const result=spawnSync(process.execPath,[script,source,output],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const compose=JSON.parse(await readFile(output,'utf8'));
  assert.deepEqual(compose.services['bot-ai'].environment,{QWEN_TTS_URL:'http://tts-qwen:3120/v1/audio/speech',HY_MT2_URL:'http://hy-mt2:3121/v1/chat/completions'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a roster that includes Cyrene without the local model images is rejected before render',()=>{
 const images=Object.fromEntries(['postgres','nginx','api','web','workers','bot-ai'].map(s=>[s,`example/${s}@sha256:${'8'.repeat(64)}`]));
 assert.throws(()=>validateRelease({id:'cyrene-without-models',bots:[{service:'bot-ai',botKey:'cyrene',port:3104}],images}),/tts-qwen/);
});
test('an explicit release roster supports a variable number of registered bot services',()=>{
 const names=['postgres','nginx','api','web','workers','tts-qwen','hy-mt2','bot-custom'];
 const release={id:'custom',bots:[{service:'bot-custom',botKey:'custom',port:3190}],images:Object.fromEntries(names.map(name=>[name,`example/${name}@sha256:${'b'.repeat(64)}`]))};
 assert.doesNotThrow(()=>validateRelease(release));
 assert.throws(()=>validateRelease({...release,bots:[...release.bots,{service:'bot-custom',botKey:'duplicate',port:3191}]}));
});
test('readiness rejects alive-only, disconnected, false and misleading string payloads',()=>{
 assert.equal(readyPayload({alive:true}),false);
 assert.equal(readyPayload({ok:false}),false);
 assert.equal(readyPayload({ready:false,message:'ok'}),false);
 assert.equal(readyPayload({ready:true}),true);
 assert.equal(readyPayload({ok:true}),true);
 assert.equal(readyPayload({status:'ready'}),true);
 assert.equal(readyPayload({status:'ok',dbReady:true}),true);
 assert.equal(readyPayload({status:'ok',dbReady:false}),false);
});
test('fleet probe uses readiness and rejects HTTP errors even with a successful body',async()=>{
 const urls=[];
 const result=await probeFleet([{name:'bot',url:'http://test/health/ready',kind:'json'}],async url=>{urls.push(url);return new Response(JSON.stringify({ready:true}),{status:503});});
 assert.equal(result.ok,false);assert.deepEqual(urls,['http://test/health/ready']);
});
test('fleet model health requires the model server readiness response',async()=>{
 const healthy=await probeFleet([{name:'hy-mt2',url:'http://test/health',kind:'model'}],async()=>new Response(JSON.stringify({status:'ok'}),{status:200}));
 assert.equal(healthy.ok,true);
 const loading=await probeFleet([{name:'hy-mt2',url:'http://test/health',kind:'model'}],async()=>new Response(JSON.stringify({status:'loading'}),{status:503}));
 assert.equal(loading.ok,false);
});
test('backup verification requires real nonempty artifacts and detects corruption or traversal',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-backup-test-'));
 const files={};
 for(const name of ['postgres.dump','roles.sql','artwork.tar.gz']){const data=Buffer.from(`fixture ${name}`);await writeFile(join(dir,name),data);files[name]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};}
 await writeFile(join(dir,'backup.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),database:'ei_point',files}));
 assert.equal((await verifyBackup(dir)).database,'ei_point');
 assert.equal((await verifyBackup(dir,{maxAgeMs:60000})).database,'ei_point');
 await writeFile(join(dir,'backup.json'),JSON.stringify({version:1,createdAt:new Date(Date.now()-2*60*60*1000).toISOString(),database:'ei_point',files}));
 await assert.rejects(verifyBackup(dir,{maxAgeMs:60*60*1000}),/older than maximum/);
 assert.equal((await verifyBackup(dir)).database,'ei_point');
 await writeFile(join(dir,'postgres.dump'),'tampered');await assert.rejects(verifyBackup(dir),/integrity/);
 files['../escape']={bytes:1,sha256:'a'.repeat(64)};
 await writeFile(join(dir,'backup.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),database:'ei_point',files}));
 await assert.rejects(verifyBackup(dir));
});
