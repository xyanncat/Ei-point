import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import EmbeddedPostgres from '../helpers/embedded-postgres.mjs';
test('one-shot administrative bootstrap creates a separate passworded non-superuser application login',async()=>{
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const server=new EmbeddedPostgres({databaseDir:await mkdtemp(join(tmpdir(),'ei-bootstrap-')),port,user:'postgres',password:'isolated-test-only',persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
 let admin,application;
 try{
  await server.initialise();await server.start();
  const base=`postgresql://postgres:isolated-test-only@127.0.0.1:${port}`;
  const connection=new pg.Client({connectionString:base+'/postgres'});await connection.connect();await connection.query('CREATE DATABASE ei_point');await connection.end();
  admin=new pg.Client({connectionString:base+'/ei_point'});await admin.connect();
  const dir=new URL('../../infra/postgres/migrations/',import.meta.url);
  for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await admin.query(await readFile(new URL(name,dir),'utf8'));
  const appUrl=`postgresql://ei_point_app:isolated-application-password-32-chars@127.0.0.1:${port}/ei_point`;
  const output=execFileSync(process.execPath,[fileURLToPath(new URL('../../infra/postgres/bootstrap-role.mjs',import.meta.url))],{env:{...process.env,DATABASE_URL:base+'/ei_point',APPLICATION_DATABASE_URL:appUrl},encoding:'utf8'});
  assert.match(output,/least-privilege/);assert.doesNotMatch(output,/isolated-application-password/);
  application=new pg.Client({connectionString:appUrl});await application.connect();
  assert.equal((await application.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false);
  await application.query('SELECT count(*) FROM commerce.orders');
  await assert.rejects(application.query('CREATE ROLE audit_escalation SUPERUSER'),/permission denied/i);
 }finally{await application?.end();await admin?.end();await server.stop();}
});
