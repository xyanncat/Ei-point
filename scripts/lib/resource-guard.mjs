import {access,statfs} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
// Only optional asset writes use this guard. Never gate payments, DB or WAL.
export async function assertOptionalAssetWritesAllowed(target,{env=process.env,checkMarker=access,filesystem=statfs}={}){
 const marker=env.DISK_HOLD_FILE??'/var/lib/ei-point/watchdog/disk-hold';
 try{await checkMarker(marker);throw Error('Optional asset writes are paused by the disk hold marker.');}catch(error){if(error.code!=='ENOENT')throw error;}
 let path=resolve(target),info;
 while(true){try{info=await filesystem(path);break;}catch(error){if(error.code!=='ENOENT'||dirname(path)===path)throw error;path=dirname(path);}}
 const total=Number(info.blocks),free=Number(info.bavail);
 if(!Number.isFinite(total)||total<=0||!Number.isFinite(free)||free<0)throw Error('Cannot determine optional asset filesystem capacity.');
 if((total-free)/total>=0.9)throw Error('Optional asset writes are paused: destination filesystem is at least 90% full.');
}
