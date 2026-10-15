import {verifyBackup} from './lib/operations.mjs';
if(!process.argv[2])throw Error('BACKUP_SNAPSHOT directory required');
const args=process.argv.slice(3);
let options={};
if(args.length){
 if(args.length!==2||args[0]!=='--max-age-hours')throw Error('Usage: verify-backup.mjs directory [--max-age-hours hours]');
 const hours=Number(args[1]);
 if(!Number.isFinite(hours)||hours<=0)throw Error('Maximum backup age must be a positive number of hours');
 options={maxAgeMs:hours*60*60*1000};
}
const manifest=await verifyBackup(process.argv[2],options);
console.log(JSON.stringify({database:manifest.database,createdAt:manifest.createdAt,verified:true}));
