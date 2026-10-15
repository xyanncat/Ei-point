// Run only in the explicit migration container using its administrative DATABASE_URL.
import {readFile} from 'node:fs/promises';
import pg from 'pg';
function databaseUrl(name){
 try{const value=new URL(process.env[name]??'');if(!['postgres:','postgresql:'].includes(value.protocol))throw Error();return value;}
 catch{throw Error(`Invalid ${name}; connection credentials are never logged`);}
}
const admin=databaseUrl('DATABASE_URL');
const application=databaseUrl('APPLICATION_DATABASE_URL');
if(admin.hostname!==application.hostname||admin.port!==application.port||admin.pathname!==application.pathname||admin.pathname!=='/ei_point')throw Error('Migration and application URLs must address the same ei_point database');
const name=decodeURIComponent(application.username),password=decodeURIComponent(application.password);
if(name!=='ei_point_app'||password.length<24||password.includes('CHANGE_ME'))throw Error('Configure a strong password for the ei_point_app role');
if(name===decodeURIComponent(admin.username))throw Error('Migration administrator must be separate from the application role');
const client=new pg.Client({connectionString:admin.toString(),connectionTimeoutMillis:5000});
try{
 await client.connect();await client.query('BEGIN');
 await client.query(await readFile(new URL('./roles.sql',import.meta.url),'utf8'));
 const statement=(await client.query('SELECT format(\'ALTER ROLE %I PASSWORD %L\',$1::text,$2::text) AS sql',[name,password])).rows[0].sql;
 await client.query(statement);await client.query('COMMIT');
 console.log('Application role provisioned with least-privilege grants');
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw Error('Application role provisioning failed',{cause:error instanceof Error?new Error(error.name):undefined});}
finally{await client.end();}
