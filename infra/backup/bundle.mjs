import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
const [action,directory,database]=process.argv.slice(2);
if(action!=='create'||!directory||!/^\w{1,63}$/.test(database??''))throw Error('Usage: bundle.mjs create DIRECTORY DATABASE');
const files={};
for(const name of ['postgres.dump','roles.sql','artwork.tar.gz']){
 const file=join(directory,name),info=await stat(file);
 if(!info.isFile()||info.size<1)throw Error(`Empty backup artifact: ${name}`);
 const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);
 files[name]={bytes:info.size,sha256:digest.digest('hex')};
}
await writeFile(join(directory,'backup.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),database,files},null,2)+'\n',{mode:0o600});
