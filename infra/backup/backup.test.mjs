import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,readFile,mkdir,chmod,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyBackup} from '../../scripts/lib/operations.mjs';
const root=resolve(import.meta.dirname,'../..');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const unix=p=>p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(s,c)=>'/'+c.toLowerCase());
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'ei-backup-test-'));
 const bin=join(directory,'bin');await mkdir(bin);
 const log=join(directory,'calls');const envFile=join(directory,'deployment.env');
 await writeFile(envFile,"POSTGRES_ADMIN_PASSWORD=test-only\nPOSTGRES_ADMIN_USER=ei_admin\nPOSTGRES_DB=ei_point\n");
 async function mock(name,body){const path=join(bin,name);await writeFile(path,'#!/usr/bin/env bash\nset -euo pipefail\n'+body+'\n');await chmod(path,0o755);}
 await mock('flock','exit "${MOCK_LOCK_EXIT:-0}"');
 if(process.platform==='win32')await mock('python3','exec python "$@"');
 const env={...process.env,ENV_FILE:unix(envFile),BACKUP_ROOT:unix(join(directory,'snapshots')),MOCK_LOG:unix(log),MOCK_BIN:unix(bin)};
 const run=(script,extra={})=>spawnSync(bash,['-c','export PATH="$MOCK_BIN:$PATH"; bash "$1"','--',unix(join(root,script))],{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:120000});
 return {directory,bin,log,envFile,mock,env,run,cleanup:()=>rm(directory,{recursive:true,force:true})};
}
test('all backup shell entrypoints parse',()=>{
 for(const file of ['infra/backup/local-backup.sh','infra/backup/restic-backup.sh','scripts/restore-drill.sh']){
  const result=spawnSync(bash,['-n',unix(join(root,file))],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 }
});
test('bundle records exact artifact hashes and rejects corruption',async()=>{
 const f=await fixture();try{
  for(const name of ['postgres.dump','roles.sql','artwork.tar.gz'])await writeFile(join(f.directory,name),name);
  let r=spawnSync(process.execPath,[join(root,'infra/backup/bundle.mjs'),'create',f.directory,'ei_point'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  assert.equal((await verifyBackup(f.directory)).database,'ei_point');
  await writeFile(join(f.directory,'postgres.dump'),'corrupt');await assert.rejects(verifyBackup(f.directory),/integrity/);
 }finally{await f.cleanup();}
});
test('restore validates artifacts before any Docker call and requires explicit snapshot',async()=>{
 const f=await fixture();try{
  await f.mock('docker','printf "%s\\n" "$*" >> "$MOCK_LOG"; exit 99');
  assert.notEqual(f.run('scripts/restore-drill.sh',{BACKUP_SNAPSHOT:''}).status,0);
  assert.notEqual(f.run('scripts/restore-drill.sh',{BACKUP_SNAPSHOT:unix(f.directory)}).status,0);
  for(const name of ['postgres.dump','roles.sql','artwork.tar.gz'])await writeFile(join(f.directory,name),'fixture');
  const generated=spawnSync(process.execPath,[join(root,'infra/backup/bundle.mjs'),'create',f.directory,'ei_point'],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  await writeFile(join(f.directory,'postgres.dump'),'tampered');
  const corrupt=f.run('scripts/restore-drill.sh',{BACKUP_SNAPSHOT:unix(f.directory)});assert.notEqual(corrupt.status,0);assert.match(corrupt.stderr,/Backup integrity failed/);
  await assert.rejects(readFile(f.log),/ENOENT/);
 }finally{await f.cleanup();}
});
test('restic refuses to run when a required private durable asset is missing',async()=>{
  const f=await fixture();try{
    await f.mock('docker','printf "%s\\n" "$*" >> "$MOCK_LOG"');
    await f.mock('restic','printf "restic %s\\n" "$*" >> "$MOCK_LOG"');
    const r=f.run('infra/backup/restic-backup.sh',{RESTIC_REPOSITORY:'s3:https://example.invalid/bucket',RESTIC_PASSWORD:'test-secret'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/durable asset is missing|no private paths/i);
    await assert.rejects(readFile(f.log),/ENOENT/); // no docker/restic call was ever made
  }finally{await f.cleanup();}
});
test('restic fails on repository errors without auto-init and discovers actual named volumes',async()=>{
 const f=await fixture();try{
  const artwork=join(f.directory,'artwork'),physical=join(f.directory,'physical');await mkdir(artwork);await mkdir(physical);
  await mkdir(join(physical,'backup','ei-point','20261014-120000F'),{recursive:true});await writeFile(join(physical,'backup','ei-point','backup.info'),'fixture');await writeFile(join(physical,'backup','ei-point','20261014-120000F','backup.manifest'),'fixture');
  // §9B/A19: the unique/private host assets must ride the encrypted off-host set.
  await writeFile(join(f.directory,'cyrene-reference.mp3'),'reference-bytes');
  await writeFile(join(f.directory,'persona.md'),'persona-bytes');
  await appendFile(f.envFile,`CYRENE_REFERENCE_AUDIO_PATH=${unix(join(f.directory,'cyrene-reference.mp3'))}\nCYRENE_PERSONA_MEMORY_FILE=${unix(join(f.directory,'persona.md'))}\n`);
  await f.mock('docker',`printf '%s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == *'volume ls'* ]]; then [[ "$*" == *'=artwork'* ]] && echo artwork-id || echo pgbackrest-id
elif [[ "$*" == *artwork-id* ]]; then echo '${unix(artwork)}'
else echo '${unix(physical)}'; fi`);
  await f.mock('restic','printf "restic %s\\n" "$*" >> "$MOCK_LOG"; [[ "$1" != snapshots ]]');
  const r=f.run('infra/backup/restic-backup.sh',{RESTIC_REPOSITORY:'s3:https://example.invalid/bucket',RESTIC_PASSWORD:'test-secret'});assert.notEqual(r.status,0);
  const log=await readFile(f.log,'utf8');assert.match(log,/project=ei-point/);assert.match(log,/volume inspect/);assert.match(log,/restic snapshots/);assert.doesNotMatch(log,/restic init|restic backup|restic forget/);
  // Regression guard: BOTH restic volumes must be discovered — artwork (unique/private)
  // and pgbackrest (physical backup + WAL repository); dropping either breaks recovery.
  assert.match(log,/label=com\.docker\.compose\.volume=artwork/);
  assert.match(log,/label=com\.docker\.compose\.volume=pgbackrest/);
 }finally{await f.cleanup();}
});
test('a healthy restic run backs up exactly the inventory set: private paths, env, artwork and pgbackrest volumes',async()=>{
  const f=await fixture();try{
    const artwork=join(f.directory,'artwork'),physical=join(f.directory,'physical');await mkdir(artwork);await mkdir(physical);
    await mkdir(join(physical,'backup','ei-point','20261014-120000F'),{recursive:true});await writeFile(join(physical,'backup','ei-point','backup.info'),'fixture');await writeFile(join(physical,'backup','ei-point','20261014-120000F','backup.manifest'),'fixture');
    const reference=join(f.directory,'cyrene-reference.mp3'),persona=join(f.directory,'persona.md');
    await writeFile(reference,'reference-bytes');await writeFile(persona,'persona-bytes');
    await appendFile(f.envFile,`CYRENE_REFERENCE_AUDIO_PATH=${unix(reference)}\nCYRENE_PERSONA_MEMORY_FILE=${unix(persona)}\n`);
    await f.mock('docker',`printf '%s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == *'volume ls'* ]]; then [[ "$*" == *'=artwork'* ]] && echo artwork-id || echo pgbackrest-id
elif [[ "$*" == *artwork-id* ]]; then echo '${unix(artwork)}'
else echo '${unix(physical)}'; fi`);
    await f.mock('restic','printf "restic %s\\n" "$*" >> "$MOCK_LOG"; exit 0');
    const r=f.run('infra/backup/restic-backup.sh',{RESTIC_REPOSITORY:'s3:https://example.invalid/bucket',RESTIC_PASSWORD:'test-secret'});
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/Off-host encrypted backup completed/);
    const log=await readFile(f.log,'utf8');
    // The exact durable set: private host paths from the inventory, the env file,
    // and both private volumes' mountpoints (artwork + physical backup/WAL).
    // MSYS path conversion means the log may carry Windows or POSIX forms.
    const normalize=(p)=>String(p).replace(/\\/g,'/').replace(/([A-Za-z]):(?=\/)/gu,(s,c)=>'/'+c.toLowerCase()).toLowerCase();
    const backupLine=log.split('\n').find(l=>l.includes('restic backup'));
    assert.ok(backupLine,'restic backup must run after a healthy snapshots check');
    for(const path of [f.envFile,reference,persona,artwork,physical])
      assert.ok(normalize(backupLine).includes(normalize(path)),`backup must include ${path}: ${backupLine}`);
    assert.match(backupLine,/--tag ei-point/);
    assert.match(backupLine,/--tag physical-and-private/);
    assert.match(log,/restic forget --tag ei-point --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --prune/);
  }finally{await f.cleanup();}
});
test('local backup fails closed on lock contention before Docker and does not prune unrelated directories',async()=>{
 const f=await fixture();try{
  await mkdir(join(f.directory,'snapshots','operator-data'),{recursive:true});
  await f.mock('docker','printf "%s\\n" "$*" >> "$MOCK_LOG"; exit 99');
  const r=f.run('infra/backup/local-backup.sh',{MOCK_LOCK_EXIT:'1'});assert.notEqual(r.status,0);assert.match(r.stderr,/Another backup/);
  await assert.rejects(readFile(f.log),/ENOENT/);assert.ok((await readdir(join(f.directory,'snapshots'))).includes('operator-data'));
 }finally{await f.cleanup();}
});
test('logical restore reads genuine artifacts with error-stop flags, checks artwork, and cleans isolated resources',async()=>{
 const f=await fixture();try{
  const artwork=join(f.directory,'source');await mkdir(artwork);await writeFile(join(artwork,'card.txt'),'original artwork bytes');
  const tar=spawnSync(bash,['-c','tar -czf "$1" -C "$2" .','--',unix(join(f.directory,'artwork.tar.gz')),unix(artwork)],{encoding:'utf8'});assert.equal(tar.status,0,tar.stderr);
  await writeFile(join(f.directory,'postgres.dump'),'real fixture dump');await writeFile(join(f.directory,'roles.sql'),'-- fixture roles');
  const manifest=spawnSync(process.execPath,[join(root,'infra/backup/bundle.mjs'),'create',f.directory,'ei_point'],{encoding:'utf8'});assert.equal(manifest.status,0,manifest.stderr);
  await f.mock('docker',`printf '%s\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == *' exec '* ]]; then exit 2; fi
if [[ "$*" == *'pg_restore'* || "$*" == *'psql -X -v ON_ERROR_STOP=1'* && "$*" != *'SELECT count'* ]]; then cat >/dev/null; fi
exit 0`);
  const result=f.run('scripts/restore-drill.sh',{BACKUP_SNAPSHOT:unix(f.directory)});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Logical bundle restore PASS/);assert.match(result.stdout,/Artwork verified: 1/);
  assert.match(await readFile(join(f.directory,'restore-verified.json'),'utf8'),/verifiedAt/,'a passing drill must persist its restore-age record');
  const log=await readFile(f.log,'utf8');assert.match(log,/--network none/);assert.match(log,/pg_restore --exit-on-error/);assert.match(log,/ON_ERROR_STOP=1/);assert.match(log,/pg_isready -h 127\.0\.0\.1/);assert.match(log,/rm -f ei-point-restore/);assert.doesNotMatch(log,/migrations/);
 }finally{await f.cleanup();}
});
test('restore readiness failure is bounded and never records PASS',async()=>{
 const f=await fixture();try{
  for(const name of ['postgres.dump','roles.sql','artwork.tar.gz'])await writeFile(join(f.directory,name),'fixture');
  const manifest=spawnSync(process.execPath,[join(root,'infra/backup/bundle.mjs'),'create',f.directory,'ei_point'],{encoding:'utf8'});assert.equal(manifest.status,0,manifest.stderr);
  await f.mock('docker','printf "%s\\n" "$*" >> "$MOCK_LOG"; [[ "$*" != *pg_isready* ]]');
  const result=f.run('scripts/restore-drill.sh',{BACKUP_SNAPSHOT:unix(f.directory),READY_SECONDS:'1'});assert.notEqual(result.status,0);assert.match(result.stderr,/readiness timeout/);assert.doesNotMatch(result.stdout,/PASS/);
  assert.match(await readFile(f.log,'utf8'),/rm -f ei-point-restore/);
 }finally{await f.cleanup();}
});
test('local backup publishes hashed bundle only after real physical commands succeed and prunes timestamp names only',async()=>{
 const f=await fixture();try{
  const snapshots=join(f.directory,'snapshots');await mkdir(join(snapshots,'20000101T000000Z'),{recursive:true});await mkdir(join(snapshots,'operator-data'));await mkdir(join(snapshots,'orphan.partial'));
  await f.mock('docker',`printf '%s\n' "$*" >> "$MOCK_LOG"
if [[ "$1" == ps ]]; then echo pg-id
elif [[ "$1" == volume ]]; then echo artwork-id
elif [[ "$*" == *pg_dumpall* ]]; then printf '%s\n' '-- roles fixture'
elif [[ "$*" == *pg_dump* ]]; then printf '%s\n' 'dump fixture'
elif [[ "$1" == run ]]; then
 for arg in "$@"; do if [[ "$arg" == *:/dst ]]; then printf '%s\n' 'archive fixture' > "\${arg%:/dst}/artwork.tar.gz"; fi; done
elif [[ "$*" == *pgbackrest* && "$*" == *' backup' && "\${MOCK_PHYSICAL_FAIL:-0}" == 1 ]]; then exit 45
fi`);
  let result=f.run('infra/backup/local-backup.sh',{LOCAL_BACKUP_KEEP:'1',MOCK_PHYSICAL_FAIL:'1'});assert.notEqual(result.status,0);assert.ok((await readdir(snapshots)).includes('20000101T000000Z'));
  assert.equal((await readdir(snapshots)).filter(n=>/^20[1-9]\d{5}T/.test(n)).length,0);
  result=f.run('infra/backup/local-backup.sh',{LOCAL_BACKUP_KEEP:'1'});assert.equal(result.status,0,result.stderr);
  const names=await readdir(snapshots);assert.ok(names.includes('operator-data'));assert.ok(names.includes('orphan.partial'));assert.ok(!names.includes('20000101T000000Z'));
  const published=names.find(n=>/^\d{8}T\d{6}Z$/.test(n));assert.ok(published);assert.equal((await verifyBackup(join(snapshots,published))).database,'ei_point');
  const log=await readFile(f.log,'utf8');assert.match(log,/--user postgres.*stanza-create/);assert.match(log,/--user postgres.* check/);assert.match(log,/--type=incr backup/);assert.match(log,/artwork-id:\/src:ro/);
 }finally{await f.cleanup();}
});
