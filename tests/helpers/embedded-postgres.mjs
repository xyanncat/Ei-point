import EmbeddedPostgres from 'embedded-postgres';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,join,basename,sep} from 'node:path';
const execute=promisify(execFile);
/** Pinned-library test adapter: Windows taskkill resolves on parent exit before file handles close. */
export default class TestPostgres extends EmbeddedPostgres {
 constructor(options){
  super({...options,persistent:true});
  this.testDirectory=resolve(options.databaseDir);
  this.removeAfterStop=options.persistent===false;
 }
 async stop(){
  if(this.cleanupFinished)return;
  const child=this.process; // embedded-postgres 17.5 exposes this TS-private field at runtime.
  const closed=child&&child.exitCode===null?once(child,'close'):Promise.resolve();
  if(child&&child.exitCode===null&&process.platform==='win32'){
   await execute(join(dirname(child.spawnfile),'pg_ctl.exe'),['-D',this.testDirectory,'-m','fast','-w','-t','20','stop'],{timeout:25000,windowsHide:true});
   await closed;
   this.process=undefined;
  }else{
   await super.stop();await closed;
  }
  if(this.removeAfterStop){
   const temporary=await realpath(tmpdir()),target=await realpath(this.testDirectory);
   if(!target.startsWith(temporary+sep)||!basename(target).startsWith('ei-'))throw Error('Refusing cleanup outside the named disposable test directory');
   await rm(target,{recursive:true,force:true});
  }
  this.cleanupFinished=true;
 }
}
