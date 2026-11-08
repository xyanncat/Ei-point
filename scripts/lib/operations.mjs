import {readFile,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,basename,sep} from 'node:path';
export const releaseServices=['postgres','nginx','api','web','workers','tts','hy-mt2','bot-kafka','bot-himiko','bot-community','bot-ai','bot-music','bot-commerce'];
export const defaultBots=[['bot-kafka','kafka',3108],['bot-himiko','himiko',3107],['bot-community','silverwolf',3103],['bot-ai','cyrene',3104],['bot-music','robin',3105],['bot-commerce','cipher',3106]].map(([service,botKey,port])=>({service,botKey,port}));

/**
 * Which local model services the selected providers still need
 * (redesign infrastructure §6/§10 phase 3). Unset or `local` keeps the model
 * container; any hosted provider removes it from the normal runtime. The
 * mapping is the single source of truth for deploy, release and health checks.
 */
export function localModelServices(env=process.env){
  const normalized=name=>String(env?.[name]??'').trim().toLowerCase();
  const tts=normalized('TTS_PROVIDER');
  const translation=normalized('TRANSLATION_PROVIDER');
  return {tts:tts===''||tts==='local','hy-mt2':translation===''||translation==='local'};
}

/** The full release roster with model services removed when hosted providers are configured. */
export function releaseServicesFor(env=process.env){
  const local=localModelServices(env);
  return releaseServices.filter(name=>name==='tts'||name==='hy-mt2'?local[name]:true);
}

/** Fleet readiness targets for a release, or for the provider selection when no release is given. */
export function fleetTargets(release=null,env=process.env){
  const bots=release?.bots??defaultBots;
  const local=localModelServices(env);
  const includeModels=release?Object.hasOwn(release.images??{},'hy-mt2'):local['hy-mt2'];
  return [
    {name:'nginx',url:'http://127.0.0.1:8080/healthz',kind:'text'},
    {name:'api',url:'http://127.0.0.1:3001/readyz',kind:'json'},
    ...(includeModels?[{name:'hy-mt2',url:'http://127.0.0.1:3121/health',kind:'model'}]:[]),
    ...bots.map(({botKey:name,port})=>({name,url:`http://127.0.0.1:${port}/health/ready`,kind:'json'})),
  ];
}
export function validateRelease(value,{allowMissingTts=false,allowMissingHyMt2=false}={}){
 if(!value||typeof value.id!=='string'||!/^[-a-zA-Z0-9_.]{1,80}$/.test(value.id)||!value.images||typeof value.images!=='object')throw Error('Invalid release manifest');
 const bots=value.bots??defaultBots;
 if(!Array.isArray(bots)||bots.some(b=>!/^bot-[a-z0-9-]+$/.test(b.service)||['bot-security','bot-moderation'].includes(b.service)||!/^[-a-z0-9]+$/.test(b.botKey)||!Number.isInteger(b.port)||b.port<1024||b.port>65535)||new Set(bots.map(b=>b.service)).size!==bots.length||new Set(bots.map(b=>b.botKey)).size!==bots.length||new Set(bots.map(b=>b.port)).size!==bots.length)throw Error('Invalid or overlapping bot roster');
 const expected=['postgres','nginx','api','web','workers',...(allowMissingTts&&!Object.hasOwn(value.images,'tts')?[]:['tts']),...(allowMissingHyMt2&&!Object.hasOwn(value.images,'hy-mt2')?[]:['hy-mt2']),...bots.map(b=>b.service)];
 if(Object.keys(value.images).some(key=>!expected.includes(key)))throw Error('Unsupported or overlapping release service');
 for(const name of expected)if(typeof value.images[name]!=='string'||!/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(value.images[name]))throw Error(`Immutable image digest required: ${name}`);
 value.bots=bots;
 return value;
}
export function readyPayload(value){return !!value&&typeof value==='object'&&(value.ready===true||value.ok===true||value.status==='ready'||(value.status==='ok'&&value.dbReady===true))&&value.ready!==false&&value.ok!==false&&value.dbReady!==false;}
export async function probeFleet(targets,fetchFn=fetch){
 const results=await Promise.all(targets.map(async target=>{
  try{const response=await fetchFn(target.url,{signal:AbortSignal.timeout(5000),redirect:'error'});
   const payload=target.kind==='text'?await response.text():target.kind==='http'?null:await response.json();
   const ok=response.ok&&(target.kind==='text'?payload.trim()==='healthy':target.kind==='http'?true:target.kind==='model'?payload?.status==='ok':readyPayload(payload));
   return {name:target.name,ok};
  }catch{return {name:target.name,ok:false};}
 }));
 return {ok:results.every(result=>result.ok),results};
}
export async function verifyBackup(directory,{maxAgeMs=Infinity}={}){
 const root=await realpath(directory);
 const manifest=JSON.parse(await readFile(join(root,'backup.json'),'utf8'));
 const createdAt=Date.parse(manifest.createdAt);
 if(!(maxAgeMs===Infinity||(Number.isFinite(maxAgeMs)&&maxAgeMs>=0)))throw Error('Invalid maximum backup age');
 if(Date.now()-createdAt>maxAgeMs)throw Error('Backup is older than maximum permitted age');
 if(manifest.version!==1||typeof manifest.database!=='string'||!/^\w{1,63}$/.test(manifest.database)||!Number.isFinite(Date.parse(manifest.createdAt))||Date.parse(manifest.createdAt)>Date.now()+60000||!manifest.files)throw Error('Invalid backup manifest');
 for(const name of ['postgres.dump','roles.sql','artwork.tar.gz'])if(!manifest.files[name])throw Error(`Required backup artifact missing: ${name}`);
 for(const [name,expected] of Object.entries(manifest.files)){
  if(name!==basename(name)||name.includes('\\')||name.includes('..'))throw Error('Invalid backup artifact path');
  const target=await realpath(resolve(root,name));
  if(!target.startsWith(root+sep))throw Error('Backup artifact escaped directory');
  const info=await stat(target);
  if(!info.isFile()||info.size<1||!Number.isSafeInteger(expected.bytes)||info.size!==expected.bytes||!/[a-f0-9]{64}/.test(expected.sha256))throw Error(`Backup integrity failed: ${name}`);
  const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);
  if(hash.digest('hex')!==expected.sha256)throw Error(`Backup integrity failed: ${name}`);
 }
 return manifest;
}
