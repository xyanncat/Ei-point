import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertOptionalAssetWritesAllowed} from '../../scripts/lib/resource-guard.mjs';
const root=resolve(import.meta.dirname,'../..');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const unix=p=>p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(s,c)=>'/'+c.toLowerCase());
test('optional writes reject disk marker and 90% filesystem usage, permit lower usage and fail closed on unknown capacity',async()=>{
 const absent=async()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});};
 await assert.rejects(assertOptionalAssetWritesAllowed(root,{checkMarker:async()=>{},filesystem:async()=>{throw Error('must not inspect');}}),/disk hold/);
 await assert.rejects(assertOptionalAssetWritesAllowed(root,{checkMarker:absent,filesystem:async()=>({blocks:100,bavail:10})}),/90%/);
 await assertOptionalAssetWritesAllowed(root,{checkMarker:absent,filesystem:async()=>({blocks:100,bavail:11})});
 await assert.rejects(assertOptionalAssetWritesAllowed(root,{checkMarker:absent,filesystem:async()=>({blocks:0,bavail:0})}),/Cannot determine/);
});
test('actual asset build and import entrypoints stop on hold before optional writes or database connect',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-asset-hold-'));try{
  const marker=join(dir,'disk-hold');await writeFile(marker,'hold');
  for(const [file,args] of [['scripts/build-project-assets.mjs',[]],['scripts/import-project-assets.mjs',['--apply']]]){
   const result=spawnSync(process.execPath,[join(root,file),...args],{env:{...process.env,DISK_HOLD_FILE:marker,DATABASE_URL:''},encoding:'utf8',timeout:10000});assert.notEqual(result.status,0);assert.match(result.stderr,/disk hold marker/);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('watchdog scopes canonical fleet, bounds restarts, reports missing/no-health services, honors grace and consumes disk hold',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-watchdog-'));try{
  const bin=join(dir,'bin'),state=join(dir,'state'),log=join(dir,'calls');await mkdir(bin);await mkdir(state);
  async function mock(name,body){const file=join(bin,name);await writeFile(file,'#!/usr/bin/env bash\nset -euo pipefail\n'+body+'\n');await chmod(file,0o755);}
  await mock('flock','exit "${MOCK_LOCK_EXIT:-0}"');
  await mock('logger','printf "LOG %s\\n" "$*" >> "$MOCK_LOG"');
  await mock('df',`printf 'Filesystem 1024-blocks Used Available Capacity Mounted\nmock 100 90 10 %s%% /\n' "\${MOCK_DISK:-92}"`);
  await mock('docker',`printf 'DOCKER %s\n' "$*" >> "$MOCK_LOG"
if [[ "$1" == ps ]]; then
 [[ "$*" == *'label=com.docker.compose.project=ei-point'* ]] || exit 88
 svc="\${!#}"; svc="\${svc##*=}"
 [[ "$svc" == bot-himiko && "\${MOCK_MISSING:-1}" == 1 ]] || echo "$svc-id"
elif [[ "$1" == inspect ]]; then
 cid="\${!#}"
 if [[ "$cid" == bot-kafka-id ]]; then printf 'true|%s|unhealthy\n' "\${MOCK_STARTED:-2000-01-01T00:00:00Z}"
 elif [[ "$cid" == workers-id && "\${MOCK_NO_HEALTH:-1}" == 1 ]]; then echo 'true|2000-01-01T00:00:00Z|none'
 else echo 'true|2000-01-01T00:00:00Z|healthy'; fi
fi`);
  const script=join(root,'infra/systemd/ei-point-watchdog.sh');
  const syntax=spawnSync(bash,['-n',unix(script)],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
  const env={...process.env,MOCK_BIN:unix(bin),MOCK_LOG:unix(log),WATCHDOG_STATE_DIR:unix(state),WATCHDOG_FAIL_THRESHOLD:'1',WATCHDOG_MAX_RESTARTS:'1'};
  const run=(extra={})=>spawnSync(bash,['-c','export PATH="$MOCK_BIN:$PATH"; bash "$1"','--',unix(script)],{env:{...env,...extra},encoding:'utf8',timeout:30000});
  let result=run();assert.equal(result.status,1,result.stderr);
  let calls=await readFile(log,'utf8');assert.match(calls,/UNHEALTHY bot-himiko.*found 0/);assert.match(calls,/UNHEALTHY workers: no Docker healthcheck/);assert.match(calls,/optional asset build\/import writes held/);await access(join(state,'disk-hold'));
  assert.equal((calls.match(/DOCKER restart/g)??[]).length,1);assert.match(calls,/restart --time 15 bot-kafka-id/);assert.doesNotMatch(calls,/bot-security|bot-moderation/);
  for(const line of calls.split('\n').filter(l=>l.startsWith('DOCKER ps')))assert.match(line,/label=com.docker.compose.project=ei-point/);
  result=run();assert.equal(result.status,1,result.stderr);calls=await readFile(log,'utf8');assert.equal((calls.match(/DOCKER restart/g)??[]).length,1);assert.match(calls,/restart budget exhausted/);
  result=run({MOCK_STARTED:new Date().toISOString(),MOCK_MISSING:'0',MOCK_NO_HEALTH:'0',MOCK_DISK:'20'});assert.equal(result.status,0,result.stderr);await assert.rejects(access(join(state,'disk-hold')),/ENOENT/);calls=await readFile(log,'utf8');assert.match(calls,/STARTING bot-kafka/);
  await writeFile(log,'');result=run({MOCK_LOCK_EXIT:'1'});assert.equal(result.status,0);assert.equal(await readFile(log,'utf8'),'');
 }finally{await rm(dir,{recursive:true,force:true});}
});
