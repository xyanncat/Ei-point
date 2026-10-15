import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {releaseServices} from '../../scripts/lib/operations.mjs';
const root=resolve(import.meta.dirname,'../..');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const unix=p=>p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(s,c)=>'/'+c.toLowerCase());
test('deploy uses immutable images, stops overlapping handlers, gates readiness and rollback preserves data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ei-deploy-'));
 try{
  const bin=join(dir,'bin'),backup=join(dir,'backup'),state=join(dir,'state'),log=join(dir,'calls');await mkdir(bin);await mkdir(backup);await mkdir(state);
  const release=join(dir,'release.json'),envFile=join(dir,'env');
  await writeFile(release,JSON.stringify({id:'test-release',images:Object.fromEntries(releaseServices.map(s=>[s,`example/${s}@sha256:${'c'.repeat(64)}`]))}));await writeFile(envFile,'# fixture only\n');
  const files={};for(const name of ['postgres.dump','roles.sql','artwork.tar.gz']){const bytes=Buffer.from('artifact fixture '+name);await writeFile(join(backup,name),bytes);files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
  await writeFile(join(backup,'backup.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),database:'ei_point',files}));
  async function mock(name,body){const p=join(bin,name);await writeFile(p,'#!/usr/bin/env bash\nset -euo pipefail\n'+body+'\n');await chmod(p,0o755);}
  await mock('docker',`printf 'DOCKER %s\n' "$*" >> "$MOCK_LOG"
if [[ "$1" == ps ]]; then echo api-id
elif [[ "$*" == *'ps -q postgres'* ]]; then echo pg-id; fi`);
  await mock('node',`if [[ "$1" == *scripts/health-fleet.mjs ]]; then echo '{"ok":true}'; exit "\${MOCK_HEALTH_EXIT:-0}"; fi
exec "$REAL_NODE" "$@"`);
  await mock('df',"printf 'Filesystem Blocks Used Available Capacity Mounted\nmock 1000 100 900 10%% /\n'");
  await mock('flock','exit 0');await mock('sleep','exit 0');
  const env={...process.env,MOCK_BIN:unix(bin),MOCK_LOG:unix(log),REAL_NODE:unix(process.execPath),ENV_FILE:unix(envFile),BACKUP_SNAPSHOT:unix(backup),RELEASE_STATE_DIR:unix(state)};
  const run=(script,extra={},argument=release)=>spawnSync(bash,['-c','export PATH="$MOCK_BIN:$PATH"; bash "$1" "$2"','--',unix(join(root,script)),unix(argument)],{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:30000});
  let result=run('scripts/deploy.sh');assert.equal(result.status,0,result.stderr);
  let calls=await readFile(log,'utf8');assert.match(calls,/pull postgres nginx api web workers/);assert.match(calls,/legacy-disabled stop bot-security bot-moderation/);assert.match(calls,/maintenance run --rm --no-deps migrate/);assert.ok(calls.indexOf('stanza-create')>=0&&calls.indexOf('stanza-create')<calls.indexOf('maintenance run --rm --no-deps migrate'),'WAL repository must be initialized before schema migrations');assert.ok(calls.indexOf(' check')<calls.indexOf('maintenance run --rm --no-deps migrate'),'WAL repository check must pass before schema migrations');assert.match(calls,/up -d --no-build/);assert.doesNotMatch(calls,/(?:^|\s)(?:down|build)(?:\s|$)/);
  const saved=await readFile(join(state,'current.json'),'utf8');
  result=run('scripts/deploy.sh',{MOCK_HEALTH_EXIT:'1'});assert.notEqual(result.status,0);assert.equal(await readFile(join(state,'current.json'),'utf8'),saved);assert.match(result.stderr,/readiness failed/);assert.match(result.stderr,/scripts\/rollback\.sh .*current\.json/);assert.doesNotMatch(result.stderr,/previous\.json/);
  result=run('scripts/rollback.sh',{},join(state,'current.json'));assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Previous application release is ready/);assert.equal(await readFile(join(state,'current.json'),'utf8'),saved);
  await writeFile(log,'');result=run('scripts/rollback.sh');assert.equal(result.status,0,result.stderr);calls=await readFile(log,'utf8');assert.doesNotMatch(calls,/\bdown\b|pg_restore|migrate|postgres.*up/);assert.match(calls,/up -d --no-build/);
  await writeFile(join(backup,'backup.json'),JSON.stringify({version:1,createdAt:new Date(Date.now()-60*60*1000).toISOString(),database:'ei_point',files}));await writeFile(log,'');result=run('scripts/deploy.sh',{DEPLOY_BACKUP_MAX_AGE_HOURS:'0.01'});assert.notEqual(result.status,0);assert.equal(await readFile(log,'utf8'),'');assert.equal(await readFile(join(state,'current.json'),'utf8'),saved);
  await writeFile(join(backup,'backup.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),database:'ei_point',files}));
  await writeFile(release,JSON.stringify({id:'bad',images:{}}));await writeFile(log,'');result=run('scripts/deploy.sh');assert.notEqual(result.status,0);assert.equal(await readFile(log,'utf8'),'');
 }finally{await rm(dir,{recursive:true,force:true});}
});
