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
let sessionUser=buyer;
const origin='https://checkout.example.test';
before(async()=>{
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 server=new EmbeddedPostgres({databaseDir:await mkdtemp(join(tmpdir(),'ei-commerce-')),port,user:'postgres',password:'isolated-test-only',persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
 await server.initialise();await server.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'isolated-test-only',database:'postgres',max:8});
 const dir=new URL('../../infra/postgres/migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await pool.query(await readFile(new URL(f,dir),'utf8'));
 await pool.query("INSERT INTO access.guilds(guild_id,name,owner_id,approved) VALUES($1,'Commerce',$2,true)",[guild,buyer]);
 await pool.query("INSERT INTO commerce.referrals(code,guild_id,referrer_id,cycle) VALUES('ABC234',$1,$2,$3)",[guild,referrer,new Date().toISOString().slice(0,7)]);
 app=Fastify();registerCommerceRoutes(app,{env:{COMMERCE_GUILD_ID:guild,PAYMENT_ORIGIN:origin,UPI_PAYEE_VPA:'merchant@bank',UPI_PAYEE_NAME:'Studio',USDT_TRC20_ADDRESS:'T'+'A'.repeat(33),INR_PER_USDT:'87.5',COMMERCE_REFERRAL_REWARD_MINOR:'5000'},query:async(sql,p)=>(await pool.query(sql,p)).rows,transaction:async(work)=>{const c=await pool.connect();try{await c.query('BEGIN');const v=await work(async(sql,p)=>(await c.query(sql,p)).rows);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},session:async()=>(sessionUser?{discordUserId:sessionUser}:null),authorize:async()=>({userId:buyer,isAdmin:true})});
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
test('web checkout ownership: sessions own orders, strangers cannot claim, Discord staff rejection is final',async()=>{
 sessionUser=null;
 const anonymous=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'account-management-membership',paymentMethod:'upi',idempotencyKey:'phase4-anon-key',recoveryToken:'a'.repeat(43)}});
 assert.equal(anonymous.statusCode,401);
 sessionUser=buyer;
 const forged=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'account-management-membership',discordId:referrer,paymentMethod:'upi',idempotencyKey:'phase4-forge-key',recoveryToken:'a'.repeat(43)}});
 assert.equal(forged.statusCode,400);
 const created=await app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'account-management-membership',paymentMethod:'upi',idempotencyKey:'phase4-session-key',recoveryToken:'e'.repeat(43)}});
 assert.equal(created.statusCode,200,created.body);
 const order=(await pool.query("SELECT * FROM commerce.orders WHERE idempotency_key='phase4-session-key'")).rows[0];
 assert.equal(order.buyer_id,buyer);
 const cookie=`ei_checkout=${encodeURIComponent([order.sku,order.public_id,'e'.repeat(43)].join('|'))}`;
 sessionUser=referrer;
 assert.equal((await app.inject({url:`/api/payments/resume?serviceId=${encodeURIComponent(order.sku)}`,headers:{cookie}})).json().resumed,false);
 assert.equal((await app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:order.public_id,token:'e'.repeat(43),utr:'777777777777',idempotencyKey:'phase4-stolen-key'}})).statusCode,403);
 sessionUser=buyer;
 assert.equal((await app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:order.public_id,token:'e'.repeat(43),utr:'777777777777',idempotencyKey:'phase4-owner-key'}})).statusCode,200);
 const {respondToCommerceCommand}=await import('../../apps/bots/commerce/dist/commands.js');
 const staffCommand=async(subcommand,options={})=>{let reply='';await respondToCommerceCommand({name:'orders',subcommand,userId:referrer,guildId:guild,isOwner:false,canManage:true,userScopes:[],key:`phase4-${subcommand}-${order.order_id}`,options:{order_id:order.order_id,...options},reply:async(s)=>{reply=s;}},pool);return reply;};
 assert.match(await staffCommand('reject'),/rejected/i);
 assert.equal((await pool.query('SELECT status FROM commerce.orders WHERE order_id=$1',[order.order_id])).rows[0].status,'rejected');
 assert.equal((await pool.query('SELECT status FROM commerce.claims WHERE order_id=$1',[order.order_id])).rows[0].status,'rejected');
 assert.match(await staffCommand('reject'),/failed/i);
 assert.match(await staffCommand('settle'),/failed/i);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM commerce.settlements WHERE order_id=$1',[order.order_id])).rows[0].n,0);
 assert.doesNotMatch(await staffCommand('review'),new RegExp(order.public_id));
 sessionUser=buyer;
});

// --- Razorpay hosted payment page: server-priced orders, reference claims, staff settlement (A12/7B; owner decision 2026-10-16, no API keys) ---
const buyer2='200000000000000002',buyer3='200000000000000003';
const pageUrl='https://razorpay.me/@subrodluffy';
const queryP=async(sql,p)=>(await pool.query(sql,p)).rows;
const txP=async(work)=>{const c=await pool.connect();try{await c.query('BEGIN');const v=await work(async(sql,p)=>(await c.query(sql,p)).rows);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
function pageApp(admin=true){const a=Fastify();registerCommerceRoutes(a,{env:{COMMERCE_GUILD_ID:guild,PAYMENT_ORIGIN:origin,UPI_PAYEE_VPA:'merchant@bank',UPI_PAYEE_NAME:'Studio',RAZORPAY_PAYMENT_PAGE:pageUrl,COMMERCE_REFERRAL_REWARD_MINOR:'5000'},query:queryP,transaction:txP,session:async()=>(sessionUser?{discordUserId:sessionUser}:null),authorize:async()=>({userId:buyer,isAdmin:admin})});return a;}
const pageOrder=(app,token,key)=>app.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'account-management-membership',paymentMethod:'razorpay',idempotencyKey:key,recoveryToken:token}});
const pageClaim=(app,order,ref,key)=>app.inject({method:'POST',url:'/api/payments/claim',headers:{origin},payload:{orderId:order.orderId,token:order.token,reference:ref,idempotencyKey:key}});

test('razorpay page: options offered, one server-priced order per checkout, page URL is the only destination',async()=>{
 sessionUser=buyer2;const app2=pageApp();
 await pool.query('DELETE FROM commerce.checkout_rate_limits');
 const opts=(await app2.inject({url:'/api/payments/options'})).json();
 assert.equal(opts.enabled,true);assert.equal(opts.methods.razorpay,true);
 const created=await pageOrder(app2,'f'.repeat(43),'phase4-page-key-1');assert.equal(created.statusCode,200,created.body);const o=created.json();
 assert.equal(o.paymentMethod,'razorpay');assert.equal(o.currency,'INR');assert.equal(o.amountMinor,70000);
 assert.equal(o.paymentUri,pageUrl);assert.equal(o.destination,pageUrl);assert.equal(o.qrPayload,pageUrl);
 assert.equal(o.keyId,undefined);assert.equal(o.providerOrderId,undefined,'no provider order exists without API keys');
 const stored=(await pool.query('SELECT method,amount_minor,status FROM commerce.orders WHERE public_id=$1',[o.orderId])).rows[0];
 assert.equal(stored.method,'razorpay');assert.equal(stored.amount_minor,'70000');assert.equal(stored.status,'pending');
 const retry=await pageOrder(app2,'f'.repeat(43),'phase4-page-key-1');assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().orderId,o.orderId);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM commerce.orders WHERE idempotency_key=$1',['phase4-page-key-1'])).rows[0].n,1);
 await app2.close();
});

test('razorpay page: a reference claim is staff-verified and settles exactly once',async()=>{
 sessionUser=buyer2;const app2=pageApp();
 await pool.query('DELETE FROM commerce.checkout_rate_limits');
 const created=await pageOrder(app2,'g'.repeat(43),'phase4-page-key-2');assert.equal(created.statusCode,200,created.body);const o=created.json();
 assert.equal((await pageClaim(app2,o,'ab','phase4-claim-short')).statusCode,400,'a too-short reference must not be claimable');
 const first=await pageClaim(app2,o,'pay_PHASE4REF1','phase4-claim-1');assert.equal(first.statusCode,200,first.body);assert.equal(first.json().status,'claimed');
 const claimRow=(await pool.query('SELECT c.proof_ref FROM commerce.claims c JOIN commerce.orders ord USING(order_id) WHERE ord.public_id=$1',[o.orderId])).rows[0];
 assert.equal(claimRow.proof_ref,'razorpay:pay_PHASE4REF1');
 const replay=await pageClaim(app2,o,'pay_PHASE4REF1','phase4-claim-replay');assert.equal(replay.statusCode,200,replay.body);
 assert.equal((await pageClaim(app2,o,'pay_PHASE4REF2','phase4-claim-2')).statusCode,409,'a different reference cannot claim a claimed order');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM commerce.claims c JOIN commerce.orders ord USING(order_id) WHERE ord.public_id=$1',[o.orderId])).rows[0].n,1);
 const settle=await app2.inject({method:'POST',url:`/api/guilds/${guild}/commerce/orders/${o.orderId}/settle`,payload:{idempotencyKey:'phase4-page-settle-1'}});
 assert.equal(settle.statusCode,200,settle.body);assert.equal(settle.json().status,'settled');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM commerce.memberships WHERE guild_id=$1 AND user_id=$2',[guild,buyer2])).rows[0].n,1);
 const again=await app2.inject({method:'POST',url:`/api/guilds/${guild}/commerce/orders/${o.orderId}/settle`,payload:{idempotencyKey:'phase4-page-settle-2'}});
 assert.equal(again.statusCode,200,again.body);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM commerce.memberships WHERE guild_id=$1 AND user_id=$2',[guild,buyer2])).rows[0].n,1,'a re-settle must never stack memberships');
 await app2.close();
});

test('razorpay page: resume hands back the same page and a deployment without one fails closed',async()=>{
 sessionUser=buyer3;const app2=pageApp();
 await pool.query('DELETE FROM commerce.checkout_rate_limits');
 const created=await pageOrder(app2,'h'.repeat(43),'phase4-page-key-3');assert.equal(created.statusCode,200,created.body);const o=created.json();
 const cookie=created.headers['set-cookie'];
 const resumed=await app2.inject({url:'/api/payments/resume?serviceId=account-management-membership',headers:{cookie}});
 assert.equal(resumed.statusCode,200,resumed.body);const r=resumed.json();
 assert.equal(r.resumed,true);assert.equal(r.orderId,o.orderId);assert.equal(r.paymentMethod,'razorpay');assert.equal(r.paymentUri,pageUrl);
 await app2.close();
 const off=Fastify();
 registerCommerceRoutes(off,{env:{COMMERCE_GUILD_ID:guild,PAYMENT_ORIGIN:origin,UPI_PAYEE_VPA:'merchant@bank',UPI_PAYEE_NAME:'Studio'},query:queryP,transaction:txP,session:async()=>({discordUserId:buyer3}),authorize:async()=>({userId:buyer,isAdmin:true})});
 const denied=await off.inject({method:'POST',url:'/api/payments/upi-qr',headers:{origin},payload:{serviceId:'account-management-membership',paymentMethod:'razorpay',idempotencyKey:'phase4-page-key-4',recoveryToken:'j'.repeat(43)}});
 assert.equal(denied.statusCode,503,denied.body);assert.equal(denied.json().code,'payments-not-configured');
 const closed=await off.inject({url:'/api/payments/resume?serviceId=account-management-membership',headers:{cookie}});
 assert.equal(closed.statusCode,200);assert.equal(closed.json().resumed,false,'a deployment without the page must not resume a dead payment link');
 assert.equal(closed.json().paymentUri,undefined);
 await off.close();
});

// --- A12/7C: settlement-month attribution, reward redemption, membership revocation (real PostgreSQL) ---
const {fulfillOrder}=await import('../../packages/modules/commerce/dist/index.js');
const nowCycle=async()=>(await pool.query("SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM') AS c")).rows[0].c;

test('referral settlement months: an earlier cycle code still pays, credited to the settlement cycle',async()=>{
 for(const [settleAt,expectedCycle] of [[new Date('2000-01-31T23:59:59.000Z'),'2000-01'],[new Date('2000-02-01T00:00:00.000Z'),'2000-02']]){
  const code=`OLD${expectedCycle.replace('-','')}`;
  await pool.query('INSERT INTO commerce.referrals(code,guild_id,referrer_id,cycle) VALUES($1,$2,$3,$4)',[code,guild,referrer,'2000-01']);
  const order=(await pool.query(`INSERT INTO commerce.orders(guild_id,buyer_id,sku,amount_minor,order_token_hash,idempotency_key,public_id,method,referral_code,request_hash,service_name,membership_days,expires_at)
   VALUES($1,$2,'account-management-membership',70000,$3,$4,$5,'upi',$6,'rh','Account Management Membership',0,now()+interval '1 day') RETURNING order_id,public_id,sku`,[guild,buyer,`tok-${code}`,`idem-${code}`,`RP-M${expectedCycle.slice(5)}010`,code])).rows[0];
  await pool.query('INSERT INTO commerce.claims(order_id,proof_ref,idempotency_key) VALUES($1,$2,$3)',[order.order_id,`upi:${expectedCycle.slice(5)}0000000001`,code]);
  const row=(await pool.query('SELECT * FROM commerce.orders WHERE order_id=$1',[order.order_id])).rows[0];
  await fulfillOrder(queryP,row,5000,settleAt);
  const reward=(await pool.query("SELECT cycle,amount_minor,status FROM commerce.rewards WHERE idempotency_key=$1",[`checkout:${order.order_id}`])).rows[0];
  assert.equal(reward.cycle,expectedCycle,`settlement at ${settleAt.toISOString()} credits ${expectedCycle}`);
  assert.equal(reward.amount_minor,'5000');assert.equal(reward.status,'reserved');
  assert.equal((await pool.query('SELECT uses FROM commerce.referrals WHERE code=$1',[code])).rows[0].uses,1,'the code is consumed across the month boundary');
  assert.equal((await pool.query('SELECT status FROM commerce.claims WHERE order_id=$1',[order.order_id])).rows[0].status,'confirmed');
 }
});

test('reward redemption: credit applies at checkout, pays exactly once on settlement',async()=>{
 await pool.query('DELETE FROM commerce.checkout_rate_limits');
 await pool.query("INSERT INTO commerce.rewards(guild_id,user_id,cycle,amount_minor,idempotency_key) VALUES($1,$2,$3,2000,'seed-7c-1')",[guild,buyer3,await nowCycle()]);
 sessionUser=buyer3;const app3=pageApp();
 const created=await pageOrder(app3,'k'.repeat(43),'phase4-credit-key-1');
 assert.equal(created.statusCode,200,created.body);const o=created.json();
 assert.equal(o.amountMinor,68000,'the reward reduces the server-priced amount');assert.equal(o.creditAppliedMinor,2000);
 const stored=(await pool.query("SELECT r.status,r.order_id,ord.amount_minor,ord.credit_applied_minor FROM commerce.rewards r JOIN commerce.orders ord ON ord.order_id=r.order_id WHERE r.idempotency_key='seed-7c-1'")).rows[0];
 assert.equal(stored.status,'redeemed');assert.equal(stored.amount_minor,'68000');assert.equal(stored.credit_applied_minor,'2000');
 const claim=await pageClaim(app3,o,'pay_PHASE4CREDIT','phase4-credit-claim');assert.equal(claim.statusCode,200,claim.body);
 assert.ok((await pool.query("SELECT count(*)::int AS n FROM ops.outbox WHERE type='commerce.notification' AND aggregate_id=$1",[guild])).rows[0].n>=1,'a fresh claim enqueues a durable staff notification');
 const settle=await app3.inject({method:'POST',url:`/api/guilds/${guild}/commerce/orders/${o.orderId}/settle`,payload:{idempotencyKey:'phase4-credit-settle-1'}});
 assert.equal(settle.statusCode,200,settle.body);
 assert.equal((await pool.query("SELECT status FROM commerce.rewards WHERE idempotency_key='seed-7c-1'")).rows[0].status,'paid');
 const again=await app3.inject({method:'POST',url:`/api/guilds/${guild}/commerce/orders/${o.orderId}/settle`,payload:{idempotencyKey:'phase4-credit-settle-2'}});
 assert.equal(again.statusCode,200);
 assert.equal((await pool.query("SELECT status FROM commerce.rewards WHERE idempotency_key='seed-7c-1'")).rows[0].status,'paid','duplicate approval must not double-pay');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM commerce.rewards WHERE user_id=$1',[buyer3])).rows[0].n,1);
 await app3.close();
});

test('reward reservation survives response loss, releases on rejection and never double-spends',async()=>{
 await pool.query('DELETE FROM commerce.checkout_rate_limits');
 await pool.query("INSERT INTO commerce.rewards(guild_id,user_id,cycle,amount_minor,idempotency_key) VALUES($1,$2,$3,3000,'seed-7c-2')",[guild,buyer3,await nowCycle()]);
 sessionUser=buyer3;const app3=pageApp();
 const first=await pageOrder(app3,'m'.repeat(43),'phase4-credit-key-2');assert.equal(first.statusCode,200,first.body);
 const o=first.json();assert.equal(o.amountMinor,67000);assert.equal(o.creditAppliedMinor,3000);
 const replay=await pageOrder(app3,'m'.repeat(43),'phase4-credit-key-2');assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().orderId,o.orderId);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM commerce.orders WHERE idempotency_key=$1',['phase4-credit-key-2'])).rows[0].n,1);
 assert.equal((await pool.query("SELECT status FROM commerce.rewards WHERE idempotency_key='seed-7c-2'")).rows[0].status,'redeemed');
 const other=await pageOrder(app3,'n'.repeat(43),'phase4-credit-key-3');assert.equal(other.statusCode,200,other.body);
 assert.equal(other.json().creditAppliedMinor,0,'a reserved reward cannot be spent on a second order');assert.equal(other.json().amountMinor,70000);
 const rejection=await app3.inject({method:'POST',url:`/api/guilds/${guild}/commerce/orders/${o.orderId}/reject`,payload:{idempotencyKey:'phase4-credit-reject'}});
 assert.equal(rejection.statusCode,200,rejection.body);
 const released=(await pool.query("SELECT status,order_id FROM commerce.rewards WHERE idempotency_key='seed-7c-2'")).rows[0];
 assert.equal(released.status,'reserved','a rejected order returns the credit to the buyer');assert.equal(released.order_id,null);
 await app3.close();
});

test('order expiry releases reserved credit; past-cycle releases expire honestly',async()=>{
 await pool.query('DELETE FROM commerce.checkout_rate_limits');
 const expiryBuyer='200000000000000005';
 await pool.query("INSERT INTO commerce.rewards(guild_id,user_id,cycle,amount_minor,idempotency_key) VALUES($1,$2,$3,4000,'seed-7c-3')",[guild,expiryBuyer,await nowCycle()]);
 sessionUser=expiryBuyer;const app3=pageApp();
 const o=(await pageOrder(app3,'p'.repeat(43),'phase4-credit-key-4')).json();assert.equal(o.creditAppliedMinor,4000);
 await pool.query("UPDATE commerce.orders SET expires_at=now()-interval '1 minute' WHERE public_id=$1",[o.orderId]);
 await maintainCommerce(queryP);
 const released=(await pool.query("SELECT status,order_id FROM commerce.rewards WHERE idempotency_key='seed-7c-3'")).rows[0];
 assert.equal(released.status,'reserved');assert.equal(released.order_id,null);
 assert.equal((await pool.query('SELECT status FROM commerce.orders WHERE public_id=$1',[o.orderId])).rows[0].status,'expired');
 const buyer4='200000000000000004';
 await pool.query("INSERT INTO commerce.rewards(guild_id,user_id,cycle,amount_minor,idempotency_key) VALUES($1,$2,'2000-01',5000,'seed-7c-4')",[guild,buyer4]);
 sessionUser=buyer4;
 const second=(await pageOrder(app3,'q'.repeat(43),'phase4-credit-key-5')).json();
 assert.equal(second.creditAppliedMinor,0,'past-cycle rewards are never quoted');
 await pool.query("UPDATE commerce.rewards SET status='redeemed',order_id=(SELECT order_id FROM commerce.orders WHERE public_id=$1) WHERE idempotency_key='seed-7c-4'",[second.orderId]);
 await pool.query("UPDATE commerce.orders SET expires_at=now()-interval '1 minute' WHERE public_id=$1",[second.orderId]);
 await maintainCommerce(queryP);
 assert.equal((await pool.query("SELECT status FROM commerce.rewards WHERE idempotency_key='seed-7c-4'")).rows[0].status,'expired','a past-cycle release expires instead of returning to the pool');
 await app3.close();
});

test('membership revocation: admin-only, immediate, idempotent, and re-purchase restarts the term',async()=>{
 const member=buyer2;
 const before=(await pool.query('SELECT expires_at FROM commerce.memberships WHERE guild_id=$1 AND user_id=$2',[guild,member])).rows[0];
 assert.ok(before,'fixture expects the razorpay settlement membership');
 const app4=pageApp();
 const revoke=await app4.inject({method:'POST',url:`/api/guilds/${guild}/commerce/memberships/${member}/revoke`});
 assert.equal(revoke.statusCode,200,revoke.body);assert.deepEqual(revoke.json(),{userId:member,status:'revoked'});
 const revoked=(await pool.query('SELECT expires_at,revoked_at FROM commerce.memberships WHERE guild_id=$1 AND user_id=$2',[guild,member])).rows[0];
 assert.ok(revoked.revoked_at);assert.ok(new Date(revoked.expires_at).getTime()<=Date.now(),'revocation takes effect immediately');
 assert.equal((await app4.inject({method:'POST',url:`/api/guilds/${guild}/commerce/memberships/${member}/revoke`})).statusCode,200,'repeat revocation stays idempotent');
 assert.equal((await app4.inject({method:'POST',url:`/api/guilds/${guild}/commerce/memberships/900000000000000009/revoke`})).statusCode,404);
 const denied=await pageApp(false).inject({method:'POST',url:`/api/guilds/${guild}/commerce/memberships/${member}/revoke`});
 assert.equal(denied.statusCode,403);assert.equal(denied.json().code,'admin-required','losing staff permission loses the revoke control');
 await pool.query('DELETE FROM commerce.checkout_rate_limits');
 sessionUser=member;
 const created=await pageOrder(app4,'r'.repeat(43),'phase4-credit-key-6');assert.equal(created.statusCode,200,created.body);
 const o=created.json();
 assert.equal((await pageClaim(app4,o,'pay_PHASE4RESTART','phase4-credit-claim-2')).statusCode,200);
 assert.equal((await app4.inject({method:'POST',url:`/api/guilds/${guild}/commerce/orders/${o.orderId}/settle`,payload:{idempotencyKey:'phase4-credit-settle-3'}})).statusCode,200);
 const after=(await pool.query('SELECT expires_at FROM commerce.memberships WHERE guild_id=$1 AND user_id=$2',[guild,member])).rows[0];
 const remaining=new Date(after.expires_at).getTime()-Date.now();
 assert.ok(remaining>29*86400000&&remaining<=30*86400000+120000,'a re-purchase restarts the membership from now instead of stacking on the revoked term');
 await app4.close();
});
