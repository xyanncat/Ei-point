import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from '../helpers/embedded-postgres.mjs';
import Fastify from '../../apps/api/node_modules/fastify/fastify.js';
import {registerCommerceRoutes,maintainCommerce} from '../../apps/api/dist/commerce-routes.js';
let server,pool,app;
const guild='100000000000000001',buyer='200000000000000001',referrer='300000000000000001';
const origin='https://checkout.example.test';
before(async()=>{
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 server=new EmbeddedPostgres({databaseDir:await mkdtemp(join(tmpdir(),'ei-commerce-')),port,user:'postgres',password:'isolated-test-only',persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
 await server.initialise();await server.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'isolated-test-only',database:'postgres',max:8});
 const dir=new URL('../../infra/postgres/migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await pool.query(await readFile(new URL(f,dir),'utf8'));
 await pool.query("INSERT INTO access.guilds(guild_id,name,owner_id,approved) VALUES($1,'Commerce',$2,true)",[guild,buyer]);
 await pool.query("INSERT INTO commerce.referrals(code,guild_id,referrer_id,cycle) VALUES('ABC234',$1,$2,$3)",[guild,referrer,new Date().toISOString().slice(0,7)]);
 app=Fastify();registerCommerceRoutes(app,{env:{COMMERCE_GUILD_ID:guild,PAYMENT_ORIGIN:origin,UPI_PAYEE_VPA:'merchant@bank',UPI_PAYEE_NAME:'Studio',USDT_TRC20_ADDRESS:'T'+'A'.repeat(33),INR_PER_USDT:'87.5',COMMERCE_REFERRAL_REWARD_MINOR:'5000'},query:async(sql,p)=>(await pool.query(sql,p)).rows,transaction:async(work)=>{const c=await pool.connect();try{await c.query('BEGIN');const v=await work(async(sql,p)=>(await c.query(sql,p)).rows);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},authorize:async()=>({userId:buyer,isAdmin:true})});
},{timeout:120000});
after(async()=>{await app?.close();await pool?.end();await server?.stop();});
async function create(key,referralCode){const r=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'account-management-membership',discordId:buyer,paymentMethod:'upi',idempotencyKey:key,...(referralCode?{referralCode}:{})}});assert.equal(r.statusCode,200,r.body);return r.json();}
test('real PG authoritative checkout, token claim, concurrent settlement and monthly referral persist exactly once',async()=>{
 const order=await create('first-checkout-key','ABC234');assert.equal(order.amountMinor,70000);assert.match(order.orderId,/^RP-[A-Z0-9]{6}$/);assert.match(order.paymentUri,/am=700.00/);
 assert.equal((await app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:order.orderId,token:'a'.repeat(43),utr:'123456789012',idempotencyKey:'bad-token-key'}})).statusCode,403);
 const claim={method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:order.orderId,token:order.token,utr:'123456789012',idempotencyKey:'claim-first-key'}};
 const claims=await Promise.all([app.inject(claim),app.inject(claim)]);assert.deepEqual(claims.map(r=>r.statusCode),[200,200]);
 const settle={method:'POST',url:`/api/guilds/${guild}/commerce/orders/${order.orderId}/settle`,payload:{idempotencyKey:'settle-first-key'}};
 const results=await Promise.all([app.inject(settle),app.inject(settle)]);assert.deepEqual(results.map(r=>r.statusCode),[200,200]);
 assert.equal((await pool.query('SELECT count(*) FROM commerce.settlements')).rows[0].count,'1');
 assert.equal((await pool.query('SELECT count(*) FROM commerce.memberships')).rows[0].count,'1');
 const expiry=(await pool.query('SELECT expires_at FROM commerce.memberships')).rows[0].expires_at;assert.ok(expiry.getTime()>Date.now()+29*86400000);assert.ok(expiry.getTime()<Date.now()+31*86400000);
 assert.equal((await pool.query('SELECT uses FROM commerce.referrals')).rows[0].uses,1);assert.equal((await pool.query('SELECT amount_minor FROM commerce.rewards')).rows[0].amount_minor,'5000');
 const status=(await app.inject({url:`/api/payments/status/${order.orderId}`})).json();assert.equal(status.status,'confirmed');assert.ok(!JSON.stringify(status).includes(buyer));
});
test('proof reuse rolls back second claim, expired orders reject proofs, idempotency keys cannot change checkout',async()=>{
 const order=await create('second-checkout-key');
 const reused=await app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:order.orderId,token:order.token,utr:'123456789012',idempotencyKey:'second-claim-key'}});assert.equal(reused.statusCode,409,reused.body);
 assert.equal((await pool.query('SELECT status FROM commerce.orders WHERE public_id=$1',[order.orderId])).rows[0].status,'pending');
 await pool.query("UPDATE commerce.orders SET expires_at=now()-interval '1 day' WHERE public_id=$1",[order.orderId]);
 assert.equal((await app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:order.orderId,token:order.token,utr:'999999999999',idempotencyKey:'expired-claim-key'}})).statusCode,409);
 const replay=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'genshin-main-event',discordId:buyer,paymentMethod:'upi',idempotencyKey:'second-checkout-key'}});assert.equal(replay.statusCode,409);
});
test('USDT snapshot uses configured quote, TRON proof validates, and maintenance durably expires old rows',async()=>{
 const r=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'account-management-membership',discordId:buyer,paymentMethod:'usdt',idempotencyKey:'usdt-checkout-key'}});assert.equal(r.statusCode,200,r.body);const o=r.json();assert.equal(o.amountMinor,900);assert.equal(o.currency,'USDT');
 assert.equal((await app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:o.orderId,token:o.token,utr:'777777777777',idempotencyKey:'wrong-usdt-proof'}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:o.orderId,token:o.token,txid:'a'.repeat(64),idempotencyKey:'usdt-proof-valid'}})).statusCode,200);
 await pool.query("INSERT INTO commerce.rewards(guild_id,user_id,cycle,amount_minor,status,idempotency_key) VALUES($1,$2,'2000-01',10,'reserved','old-month-reward')",[guild,referrer]);
 await maintainCommerce(async(sql,p)=>(await pool.query(sql,p)).rows);
 assert.equal((await pool.query("SELECT status FROM commerce.orders WHERE idempotency_key='second-checkout-key'")).rows[0].status,'expired');
 assert.equal((await pool.query("SELECT status FROM commerce.rewards WHERE idempotency_key='old-month-reward'")).rows[0].status,'expired');
});
test('checkout resume recovers the same order and claim authority without storing secrets in the URL',async()=>{
 const key='resume-key-1',secret='b'.repeat(43);
 const first=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'account-management-membership',discordId:buyer,paymentMethod:'upi',idempotencyKey:key,recoveryToken:secret}});
 assert.equal(first.statusCode,200,first.body);
 const order=first.json();
 const cookie=first.headers['set-cookie'];
 assert.ok(cookie, 'checkout creation must set a recovery cookie');
 assert.match(String(cookie),/HttpOnly/);
 const resumed=await app.inject({method:'GET',url:'/api/payments/resume?serviceId=account-management-membership',headers:{cookie}});
 assert.equal(resumed.statusCode,200,resumed.body);
 const recovered=resumed.json();
 assert.equal(recovered.resumed,true);
 assert.equal(recovered.orderId,order.orderId);
 assert.equal(recovered.token,secret);
 const claim=await app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:recovered.orderId,token:recovered.token,utr:'987654321012',idempotencyKey:'resume-claim-key'}});
 assert.equal(claim.statusCode,200,claim.body);
 assert.equal((await app.inject({method:'GET',url:'/api/payments/resume?serviceId=genshin-main-event',headers:{cookie}})).json().resumed,false);
 assert.equal((await app.inject({method:'GET',url:'/api/payments/resume?serviceId=account-management-membership'})).json().resumed,false);
});
test('a lost creation response replays the same order for the same key and recovery token',async()=>{
 const key='lost-response-key',secret='c'.repeat(43);
 const payload={serviceId:'account-management-membership',discordId:buyer,paymentMethod:'upi',idempotencyKey:key,recoveryToken:secret};
 const first=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload});
 assert.equal(first.statusCode,200,first.body);
 const replay=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload});
 assert.equal(replay.statusCode,200,replay.body);
 assert.equal(replay.json().orderId,first.json().orderId);
 assert.equal((await pool.query('SELECT count(*) FROM commerce.orders WHERE idempotency_key=$1',[key])).rows[0].count,'1');
 assert.equal((await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{...payload,recoveryToken:'d'.repeat(43)}})).statusCode,409);
});
test('rejection is terminal and does not activate another membership',async()=>{
 const o=await create('rejected-checkout-key');
 const rejection=await app.inject({method:'POST',url:`/api/guilds/${guild}/commerce/orders/${o.orderId}/reject`,payload:{idempotencyKey:'reject-order-key'}});assert.equal(rejection.statusCode,200);
 const settled=await app.inject({method:'POST',url:`/api/guilds/${guild}/commerce/orders/${o.orderId}/settle`,payload:{idempotencyKey:'reject-settle-key'}});assert.equal(settled.statusCode,409);
 assert.equal((await pool.query('SELECT count(*) FROM commerce.settlements')).rows[0].count,'1');
});

test('Discord commerce scopes buyer and guild and shares transactional membership/referral fulfillment',async()=>{
 const {respondToCommerceCommand}=await import('../../apps/bots/commerce/dist/commands.js');
 const o=await create('discord-settlement-key','ABC234');
 const row=(await pool.query('SELECT * FROM commerce.orders WHERE public_id=$1',[o.orderId])).rows[0];
 async function command(name,subcommand,userId,guildId,canManage=false,options={}){let reply='';await respondToCommerceCommand({name,subcommand,userId,guildId,canManage,isOwner:false,userScopes:[],key:`interaction-${name}-${subcommand}-${guildId}-${userId}`,options:{order_id:row.order_id,...options},reply:async(s)=>{reply=s;}},pool);return reply;}
 assert.match(await command('orders','status',referrer,guild),/not found/);
 assert.match(await command('orders','status',referrer,'999999999999999999',true),/not found/);
 assert.match(await command('orders','claim',referrer,guild,false,{proof:'foreign-proof'}),/failed/);
 assert.equal((await pool.query('SELECT status FROM commerce.orders WHERE order_id=$1',[row.order_id])).rows[0].status,'pending');
 assert.match(await command('orders','claim',buyer,guild,false,{proof:'upi:555555555555'}),/Submitted/);
 assert.match(await command('orders','settle',referrer,'999999999999999999',true),/failed/);
 const before=(await pool.query('SELECT expires_at FROM commerce.memberships WHERE guild_id=$1 AND user_id=$2',[guild,buyer])).rows[0].expires_at;
 assert.match(await command('orders','settle',referrer,guild,true),/successfully/);
 assert.equal((await pool.query('SELECT status FROM commerce.claims WHERE order_id=$1',[row.order_id])).rows[0].status,'confirmed');
 const after=(await pool.query('SELECT expires_at FROM commerce.memberships WHERE guild_id=$1 AND user_id=$2',[guild,buyer])).rows[0].expires_at;
 assert.equal(after-before,30*86400000);
 assert.equal((await pool.query("SELECT uses FROM commerce.referrals WHERE code='ABC234'")).rows[0].uses,2);
 await command('orders','settle',referrer,guild,true);
 assert.equal((await pool.query('SELECT expires_at FROM commerce.memberships WHERE guild_id=$1 AND user_id=$2',[guild,buyer])).rows[0].expires_at.getTime(),after.getTime());
});

test('Discord-created membership captures immutable service and duration snapshot',async()=>{
 const {respondToCommerceCommand}=await import('../../apps/bots/commerce/dist/commands.js');let reply='';
 await respondToCommerceCommand({name:'orders',subcommand:'create',userId:buyer,guildId:guild,isOwner:false,canManage:false,userScopes:[],key:'discord-create-membership',options:{sku:'account-management-membership'},paymentOrigin:origin,payeeVpa:'merchant@bank',payeeName:'Studio',usdtAddress:'',reply:async(s)=>{reply=s;}},pool);
 assert.match(reply,/Successfully/);
 const row=(await pool.query("SELECT * FROM commerce.orders WHERE idempotency_key='ord-discord-create-membership'")).rows[0];assert.equal(row.membership_days,30);assert.ok(row.service_name);assert.match(row.public_id,/^RP-[A-Z0-9]{6}$/);assert.match(reply,new RegExp(`verify\\?id=${row.public_id}`));
});
