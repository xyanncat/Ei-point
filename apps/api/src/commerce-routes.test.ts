import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerCommerceRoutes, type CommerceDeps } from "./commerce-routes.js";
const guild = "123456789012345678";
const session = (discordUserId: string | null = guild): CommerceDeps["session"] =>
  async () => (discordUserId === null ? null : { discordUserId });
function fixture(env: Record<string,string> = {}, query: CommerceDeps["query"] = async () => [], who: CommerceDeps["session"] = session(), admin = false) {
  const app = Fastify();
  registerCommerceRoutes(app, { env, query, session: who, transaction: async (work) => work(query), authorize: async () => ({userId:guild,isAdmin:admin}) });
  return app;
}
test("checkout fails truthfully when payment deployment is not configured", async () => {
 const app=fixture(); const res=await app.inject({method:"POST",url:"/api/payments/upi-qr",payload:{}});
 assert.equal(res.statusCode,503); assert.equal(res.json().code,"payments-not-configured"); await app.close();
});
const env={COMMERCE_GUILD_ID:guild,PAYMENT_ORIGIN:"http://localhost:3000",UPI_PAYEE_VPA:"merchant@bank",UPI_PAYEE_NAME:"Studio"};
test("public creation requires exact allowed Origin before database access", async () => {
 const app=fixture(env,async()=>{throw Error("must not query")});
 assert.equal((await app.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:"https://evil.example"},payload:{}})).statusCode,403); await app.close();
});
test("client price cannot create an order", async () => {
 const app=fixture(env,async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[]); const res=await app.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:"anything",amount:1}});
 assert.equal(res.statusCode,400);assert.equal(res.json().code,"invalid-checkout"); await app.close();
});
test("public RP status excludes buyer and proof and maps settled to confirmed",async()=>{
 const app=fixture(env,async()=>[{public_id:"RP-ABC123",status:"settled",amount_minor:"70000",method:"upi",name:"Membership",buyer_id:guild,proof_ref:"sensitive",expires_at:new Date(Date.now()+100000)}]);
 const res=await app.inject({url:"/api/payments/status/RP-ABC123"}); assert.equal(res.statusCode,200);
 assert.equal(res.json().status,"confirmed");assert.equal(res.json().amount,"700.00");assert.equal(res.json().serviceName,"Membership");assert.equal(res.json().buyer_id,undefined);assert.equal(res.json().proof_ref,undefined); await app.close();
});
test("staff settlement requires administrator scope",async()=>{
 const app=fixture(env); const res=await app.inject({method:"POST",url:`/api/guilds/${guild}/commerce/orders/RP-ABC123/settle`,payload:{}});assert.equal(res.statusCode,403);await app.close();
});

test("lost create response recovers only with original client secret",async()=>{
 let order:any;
 const app=fixture(env,async(sql,p)=>{
  if(sql.includes('access.guilds'))return [{guild_id:guild}];
  if(sql.includes('SELECT * FROM commerce.orders'))return order?[order]:[];
  if(sql.includes('commerce.catalog'))return [{sku:'membership',name:'Membership',price_minor:70000,currency:'INR',membership_days:30}];
  if(sql.includes('INSERT INTO commerce.orders')){order={guild_id:p![0],buyer_id:p![1],sku:p![2],amount_minor:p![3],order_token_hash:p![4],public_id:p![6],method:p![7],request_hash:p![9],service_name:p![10],expires_at:new Date(Date.now()+60000),status:'pending'};return [order];}return [];
 });
 const request={method:'POST' as const,url:'/api/payments/upi-qr',headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:'membership',discordId:guild,paymentMethod:'upi',idempotencyKey:'recover-key-123',recoveryToken:'a'.repeat(43)}};
 const first=await app.inject(request),retry=await app.inject(request);
 assert.equal(first.statusCode,200);assert.equal(retry.statusCode,200);assert.equal(first.json().token,retry.json().token);assert.equal(first.json().orderId,retry.json().orderId);
 const attacker=await app.inject({...request,payload:{...request.payload,recoveryToken:'b'.repeat(43)}});assert.equal(attacker.statusCode,409);await app.close();
});
test("commerce readers list minimized orders while settlement staff see buyer and proof",async()=>{
 const rows=[{orderId:"RP-ABC123",buyerId:"200000000000000001",sku:"membership",serviceName:"Membership",amountMinor:70000,method:"upi",status:"claimed",createdAt:new Date(),expiresAt:new Date(Date.now()+60000),proofRef:"upi:UTR-9"}];
 let admin=false;const app=Fastify();
 registerCommerceRoutes(app,{env,query:async()=>rows,session:session(),transaction:async(work)=>work(async()=>[]),authorize:async()=>({userId:guild,isAdmin:admin})});
 const reader=await app.inject({url:`/api/guilds/${guild}/commerce/orders`});assert.equal(reader.statusCode,200);
 const view=reader.json().orders[0];assert.equal(view.orderId,"RP-ABC123");assert.equal("buyerId" in view,false);assert.equal("proofRef" in view,false);assert.equal(view.status,"claimed");
 admin=true;const staff=await app.inject({url:`/api/guilds/${guild}/commerce/orders`});assert.equal(staff.statusCode,200);
 assert.equal(staff.json().orders[0].buyerId,"200000000000000001");assert.equal(staff.json().orders[0].proofRef,"upi:UTR-9");await app.close();
});
test("commerce readers cannot settle or reject orders",async()=>{
 const app=fixture(env);
 for(const action of ["settle","reject"])assert.equal((await app.inject({method:"POST",url:`/api/guilds/${guild}/commerce/orders/RP-ABC123/${action}`,payload:{}})).statusCode,403);
 await app.close();
});
test("public payment reads throttle per client address so one abuser fails alone",async()=>{
 const buckets=new Map(),row={public_id:"RP-ABC123",status:"claimed",amount_minor:"70000",method:"upi",name:"Membership",expires_at:new Date(Date.now()+100000)};
 const app=fixture(env,async(sql,p)=>{if(sql.includes("checkout_rate_limits")){const k=String(p![0]),n=(buckets.get(k)??0)+1;buckets.set(k,n);return [{requests:n}];}return sql.includes("commerce.orders")?[row]:[];});
 for(let i=1;i<=31;i++)assert.equal((await app.inject({url:"/api/payments/status/RP-ABC123",remoteAddress:`203.0.113.${i}`})).statusCode,200);
 let last=0;for(let i=0;i<31;i++)last=(await app.inject({url:"/api/payments/status/RP-ABC123",remoteAddress:"198.51.100.7"})).statusCode;
 assert.equal(last,429);assert.equal(buckets.size,32);await app.close();
});
test("internal verification requires the service token and answers by token or order id",async()=>{
 const token="s".repeat(48),rows=[{status:"claimed",amount_minor:"70000",method:"upi",sku_name:"Membership",expires_at:new Date(Date.now()+600000)}],seen:string[]=[];
 const app=fixture({...env,INTERNAL_SERVICE_TOKEN:token},async(sql,p)=>{if(sql.includes("checkout_rate_limits"))return [{requests:1}];if(sql.includes("commerce.orders")){seen.push(sql);const key=String(p![0]).toLowerCase();return key.includes("nope")?[]:key.includes("expird")?[{...rows[0],status:"pending",expires_at:new Date(Date.now()-1000)}]:rows;}return [];});
 assert.equal((await app.inject({url:"/api/internal/payments/verify?token="+"t".repeat(24)})).statusCode,403);
 assert.equal((await app.inject({url:"/api/internal/payments/verify?token="+"t".repeat(24),headers:{authorization:"Bearer "+"x".repeat(48)}})).statusCode,403);
 assert.equal((await app.inject({url:"/api/internal/payments/verify",headers:{authorization:`Bearer ${token}`}})).statusCode,400);
 assert.equal((await app.inject({url:"/api/internal/payments/verify?id=not-an-order",headers:{authorization:`Bearer ${token}`}})).statusCode,400);
 const byToken=await app.inject({url:"/api/internal/payments/verify?token="+"t".repeat(24),headers:{authorization:`Bearer ${token}`}});
 assert.equal(byToken.statusCode,200);assert.deepEqual(byToken.json(),{skuName:"Membership",amountMinor:70000,status:"claimed",currency:"INR"});
 assert.equal(byToken.headers["cache-control"],"no-store");
 const byId=await app.inject({url:"/api/internal/payments/verify?id=RP-ABC123",headers:{authorization:`Bearer ${token}`}});assert.equal(byId.statusCode,200);
 assert.equal(byId.json().status,"claimed");
 const expired=await app.inject({url:"/api/internal/payments/verify?id=RP-EXPIRD",headers:{authorization:`Bearer ${token}`}});assert.equal(expired.statusCode,200);assert.equal(expired.json().status,"expired");
 assert.equal((await app.inject({url:"/api/internal/payments/verify?id=RP-NOPE99",headers:{authorization:`Bearer ${token}`}})).statusCode,404);
 assert.ok(seen[0]!.includes("order_token_hash"));assert.ok(seen[1]!.includes("public_id"));await app.close();
});
test("internal verification throttles the forwarded visitor rather than the shared server",async()=>{
 const token="s".repeat(48),buckets=new Map(),row={status:"claimed",amount_minor:"70000",method:"upi",sku_name:"Membership",expires_at:new Date(Date.now()+600000)};
 const app=fixture({...env,INTERNAL_SERVICE_TOKEN:token},async(sql,p)=>{if(sql.includes("checkout_rate_limits")){const k=String(p![0]),n=(buckets.get(k)??0)+1;buckets.set(k,n);return [{requests:n}];}return sql.includes("commerce.orders")?[row]:[];});
 const verify=(ip:string)=>app.inject({url:"/api/internal/payments/verify?id=RP-ABC123",headers:{authorization:`Bearer ${token}`,"x-ei-client-ip":ip}});
 for(let i=1;i<=31;i++)assert.equal((await verify(`203.0.113.${i}`)).statusCode,200);
 let last=0;for(let i=0;i<31;i++)last=(await verify("198.51.100.7")).statusCode;assert.equal(last,429);
 for(let i=0;i<30;i++)assert.equal((await verify("198.51.100.7, 203.0.113.99")).statusCode,200);
 for(let i=0;i<31;i++)last=(await verify("garbage; drop table")).statusCode;assert.equal(last,429);
 await app.close();
});
test("web checkout requires a signed-in Discord identity and refuses typed buyer IDs",async()=>{
 const anonymous=fixture(env,async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[],session(null));
 const denied=await anonymous.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:"membership",paymentMethod:"upi",idempotencyKey:"anonymous-key-1234",recoveryToken:"a".repeat(43)}});
 assert.equal(denied.statusCode,401);assert.equal(denied.json().code,"auth-required");await anonymous.close();
 const forged=fixture(env,async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[]);
 const mismatch=await forged.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:"membership",discordId:"999999999999999999",paymentMethod:"upi",idempotencyKey:"forged-key-1234",recoveryToken:"b".repeat(43)}});
 assert.equal(mismatch.statusCode,400);assert.equal(mismatch.json().code,"invalid-checkout");await forged.close();
});
test("authenticated creation records the session identity as the buyer",async()=>{
 const caller="777777777777777777";let inserted:unknown[]|null=null;
 const app=fixture(env,async(sql,p)=>{
  if(sql.includes("access.guilds"))return [{guild_id:guild}];
  if(sql.includes("SELECT * FROM commerce.orders"))return [];
  if(sql.includes("commerce.catalog"))return [{sku:"membership",name:"Membership",price_minor:70000,currency:"INR",membership_days:30}];
  if(sql.includes("INSERT INTO commerce.orders")){inserted=p!;return [{guild_id:guild,buyer_id:p![1],sku:"membership",amount_minor:70000,order_token_hash:p![4],public_id:p![6],method:"upi",request_hash:p![9],service_name:"Membership",expires_at:new Date(Date.now()+60000),status:"pending"}];}
  return [];
 },async()=>({discordUserId:caller}));
 const res=await app.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:"membership",paymentMethod:"upi",idempotencyKey:"session-buyer-key",recoveryToken:"c".repeat(43)}});
 assert.equal(res.statusCode,200,res.body);assert.equal(inserted![1],caller);await app.close();
});
test("claims and resume require the order owner, not just the recovery token",async()=>{
 const owner="200000000000000001",other="200000000000000002",token="t".repeat(43);
 const orderRow=()=>({order_id:"11111111-2222-4333-8444-555555555555",public_id:"RP-ABC123",buyer_id:owner,sku:"membership",service_name:"Membership",amount_minor:"70000",method:"upi",status:"pending",order_token_hash:createHash("sha256").update(token).digest("hex"),expires_at:new Date(Date.now()+3600000),referral_code:null});
 const queries=async(sql:string)=>{if(sql.includes("checkout_rate_limits"))return [{requests:1}];if(sql.includes("access.guilds"))return [{guild_id:guild}];if(sql.includes("commerce.claims"))return [{proof_ref:"upi:123456789012"}];if(sql.includes("commerce.orders"))return [orderRow()];return [];};
 const recovery=`ei_checkout=${encodeURIComponent(["membership","RP-ABC123",token].join("|"))}`;
 const stranger=fixture(env,queries,async()=>({discordUserId:other}));
 const resumed=await stranger.inject({url:"/api/payments/resume?serviceId=membership",headers:{cookie:recovery}});
 assert.equal(resumed.statusCode,200);assert.equal(resumed.json().resumed,false);
 const stolen=await stranger.inject({method:"POST",url:"/api/payments/claim",headers:{origin:env.PAYMENT_ORIGIN},payload:{orderId:"RP-ABC123",token,utr:"123456789012",idempotencyKey:"claim-stranger-key"}});
 assert.equal(stolen.statusCode,403);assert.equal(stolen.json().code,"invalid-order-owner");await stranger.close();
 const ownerSession=fixture(env,queries,async()=>({discordUserId:owner}));
 const resumedByOwner=await ownerSession.inject({url:"/api/payments/resume?serviceId=membership",headers:{cookie:recovery}});
 assert.equal(resumedByOwner.statusCode,200);assert.equal(resumedByOwner.json().resumed,true);
 const claim=await ownerSession.inject({method:"POST",url:"/api/payments/claim",headers:{origin:env.PAYMENT_ORIGIN},payload:{orderId:"RP-ABC123",token,utr:"123456789012",idempotencyKey:"claim-owner-key"}});
 assert.equal(claim.statusCode,200,claim.body);assert.equal(claim.json().status,"claimed");await ownerSession.close();
});
test("claims refuse expired or settled orders without writing",async()=>{
 const token="t".repeat(43),proof="123456789012";
 const base=()=>({order_id:"o1",public_id:"RP-ABC123",buyer_id:guild,sku:"membership",service_name:"Membership",amount_minor:"70000",method:"upi",status:"pending",order_token_hash:createHash("sha256").update(token).digest("hex"),expires_at:new Date(Date.now()+3600000)});
 for(const [label,row,code] of [["expired",{...base(),expires_at:new Date(Date.now()-1000)},"order-expired"],["settled",{...base(),status:"settled"},"order-not-pending"]] as const){
  const writes:string[]=[];
  const app=fixture(env,async(sql,p)=>{if(sql.includes("checkout_rate_limits"))return [{requests:1}];if(sql.includes("access.guilds"))return [{guild_id:guild}];if(sql.includes("INSERT INTO commerce.claims")||sql.includes("UPDATE commerce.orders")){writes.push(sql);return [];}if(sql.includes("commerce.orders"))return [row];if(sql.includes("commerce.claims"))return [];return [];});
  const res=await app.inject({method:"POST",url:"/api/payments/claim",headers:{origin:env.PAYMENT_ORIGIN},payload:{orderId:"RP-ABC123",token,utr:proof,idempotencyKey:`claim-${label}-key`}});
  assert.equal(res.statusCode,409,label);assert.equal(res.json().code,code,label);assert.deepEqual(writes,[],label);
  await app.close();
 }
});
test("a repeat claim with the same proof is idempotent; a different proof is refused",async()=>{
 const token="t".repeat(43);
 const claimedRow={order_id:"o1",public_id:"RP-ABC123",buyer_id:guild,sku:"membership",service_name:"Membership",amount_minor:"70000",method:"upi",status:"claimed",order_token_hash:createHash("sha256").update(token).digest("hex"),expires_at:new Date(Date.now()+3600000)};
 for(const [proof,expected] of [["123456789012",200],["999999999999",409]] as const){
  const writes:string[]=[];
  const app=fixture(env,async(sql,p)=>{if(sql.includes("checkout_rate_limits"))return [{requests:1}];if(sql.includes("access.guilds"))return [{guild_id:guild}];if(sql.includes("INSERT INTO commerce.claims")||sql.includes("UPDATE commerce.orders")){writes.push(sql);return [];}if(sql.includes("commerce.orders"))return [claimedRow];if(sql.includes("commerce.claims"))return [{proof_ref:"upi:123456789012"}];return [];});
  const res=await app.inject({method:"POST",url:"/api/payments/claim",headers:{origin:env.PAYMENT_ORIGIN},payload:{orderId:"RP-ABC123",token,utr:proof,idempotencyKey:`claim-${proof}`}});
  assert.equal(res.statusCode,expected);assert.deepEqual(writes,[]);if(expected===200)assert.equal(res.json().status,"claimed");
  await app.close();
 }
});
test("a duplicate payment reference maps to a conflict instead of a second claim",async()=>{
 const token="t".repeat(43);
 const app=fixture(env,async(sql,p)=>{if(sql.includes("checkout_rate_limits"))return [{requests:1}];if(sql.includes("access.guilds"))return [{guild_id:guild}];if(sql.includes("INSERT INTO commerce.claims"))throw Object.assign(Error("duplicate"),{code:"23505"});if(sql.includes("commerce.orders"))return [{order_id:"o1",public_id:"RP-ABC123",buyer_id:guild,sku:"membership",service_name:"Membership",amount_minor:"70000",method:"upi",status:"pending",order_token_hash:createHash("sha256").update(token).digest("hex"),expires_at:new Date(Date.now()+3600000)}];return [];});
 const res=await app.inject({method:"POST",url:"/api/payments/claim",headers:{origin:env.PAYMENT_ORIGIN},payload:{orderId:"RP-ABC123",token,utr:"123456789012",idempotencyKey:"dup-proof-claim"}});
 assert.equal(res.statusCode,409);assert.equal(res.json().code,"payment-conflict");await app.close();
});

// --- Razorpay hosted payment page (owner decision 2026-10-16: no API keys; buyers pay the exact amount on the page and submit the payment reference for staff verification) ---
const rpEnv={...env,RAZORPAY_PAYMENT_PAGE:"https://razorpay.me/@subrodluffy"};
const rpOrderRow=(over:Record<string,unknown>={})=>({order_id:"11111111-2222-4333-8444-555555555555",public_id:"RP-RZP001",buyer_id:guild,sku:"membership",service_name:"Membership",amount_minor:70000,method:"razorpay",status:"pending",order_token_hash:"h",request_hash:"r",expires_at:new Date(Date.now()+600000),referral_code:null,...over});

test("razorpay page is offered only with a valid hosted page URL",async()=>{
 const on=await fixture(rpEnv,async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[]).inject({url:"/api/payments/options"});
 assert.equal(on.json().methods.razorpay,true);assert.equal(on.json().enabled,true);
 const off=await fixture(env,async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[]).inject({url:"/api/payments/options"});
 assert.equal(off.json().methods.razorpay,false);
 for(const page of ["http://razorpay.me/@handle","https://evil.example/@handle","https://razorpay.me/","not-a-url"]){
  const bad=await fixture({...env,RAZORPAY_PAYMENT_PAGE:page},async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[]).inject({url:"/api/payments/options"});
  assert.equal(bad.json().methods.razorpay,false,page);
 }
});

test("razorpay checkout points at the hosted page with the server-priced amount",async()=>{
 const token="r".repeat(43);let inserted:unknown[]|null=null;
 const app=fixture(rpEnv,async(sql,p)=>{
  if(sql.includes("checkout_rate_limits"))return [{requests:1}];
  if(sql.includes("access.guilds"))return [{guild_id:guild}];
  if(sql.includes("SELECT * FROM commerce.orders"))return [];
  if(sql.includes("commerce.catalog"))return [{sku:"membership",name:"Membership",price_minor:70000,currency:"INR",membership_days:30}];
  if(sql.includes("INSERT INTO commerce.orders")){inserted=p!;return [rpOrderRow({order_token_hash:String(p![4]),request_hash:String(p![9])})];}
  return [];
 });
 const res=await app.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:"membership",paymentMethod:"razorpay",idempotencyKey:"page-key-1234",recoveryToken:token}});
 assert.equal(res.statusCode,200,res.body);const j=res.json();
 assert.equal(j.paymentMethod,"razorpay");assert.equal(j.currency,"INR");assert.equal(j.amountMinor,70000);
 assert.equal(j.paymentUri,rpEnv.RAZORPAY_PAYMENT_PAGE);assert.equal(j.destination,rpEnv.RAZORPAY_PAYMENT_PAGE);assert.equal(j.qrPayload,rpEnv.RAZORPAY_PAYMENT_PAGE);
 assert.equal(j.keyId,undefined);assert.equal(j.providerOrderId,undefined);
 assert.equal(inserted![3],70000,"the order is priced by the server");
 assert.equal(inserted![7],"razorpay");
 const offApp=fixture(env,async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[]);
 const denied=await offApp.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:"membership",paymentMethod:"razorpay",idempotencyKey:"page-key-1235",recoveryToken:"s".repeat(43)}});
 assert.equal(denied.statusCode,503);assert.equal(denied.json().code,"payments-not-configured");
 await offApp.close();await app.close();
});

test("razorpay claim records the payment reference for staff review",async()=>{
 const token="t".repeat(43);const writes:unknown[][]=[];
 const row=rpOrderRow({order_token_hash:createHash("sha256").update(token).digest("hex")});
 const app=fixture(rpEnv,async(sql,p)=>{
  if(sql.includes("checkout_rate_limits"))return [{requests:1}];
  if(sql.includes("access.guilds"))return [{guild_id:guild}];
  if(sql.includes("INSERT INTO commerce.claims")||sql.includes("UPDATE commerce.orders")){writes.push(p!);return [];}
  if(sql.includes("commerce.orders"))return [row];
  return [];
 });
 const claim=(payload:Record<string,unknown>)=>app.inject({method:"POST",url:"/api/payments/claim",headers:{origin:env.PAYMENT_ORIGIN},payload:{orderId:"RP-RZP001",token,...payload}});
 assert.equal((await claim({utr:"123456789012",idempotencyKey:"rzp-claim-utr"})).statusCode,400,"a razorpay order cannot be claimed with the UPI field");
 assert.equal((await claim({reference:"abc",idempotencyKey:"rzp-claim-short"})).statusCode,400);
 const ok=await claim({reference:"pay_QAZFRESH1ABC",idempotencyKey:"rzp-claim-ref"});
 assert.equal(ok.statusCode,200,ok.body);assert.equal(ok.json().status,"claimed");
 assert.equal(writes[0]![1],"razorpay:pay_QAZFRESH1ABC","the reference is stored with its method for staff matching");
 assert.equal(writes[0]![2],"rzp-claim-ref");
 await app.close();
});

test("razorpay order resumes the hosted page and fails closed without one",async()=>{
 const token="t".repeat(43);const order=rpOrderRow({order_token_hash:createHash("sha256").update(token).digest("hex")});
 const queries:CommerceDeps["query"]=async(sql)=>{if(sql.includes("checkout_rate_limits"))return [{requests:1}];if(sql.includes("commerce.orders"))return [order];return [];};
 const recovery=`ei_checkout=${encodeURIComponent(["membership","RP-RZP001",token].join("|"))}`;
 const on=fixture(rpEnv,queries,async()=>({discordUserId:guild}));
 const resumed=await on.inject({url:"/api/payments/resume?serviceId=membership",headers:{cookie:recovery}});
 assert.equal(resumed.statusCode,200,resumed.body);
 assert.equal(resumed.json().resumed,true);assert.equal(resumed.json().paymentMethod,"razorpay");
 assert.equal(resumed.json().paymentUri,rpEnv.RAZORPAY_PAYMENT_PAGE);
 await on.close();
 const off=fixture(env,queries,async()=>({discordUserId:guild}));
 const closed=await off.inject({url:"/api/payments/resume?serviceId=membership",headers:{cookie:recovery}});
 assert.equal(closed.statusCode,200);assert.equal(closed.json().resumed,false,"a deployment without the page must not hand out a dead payment link");
 await off.close();
});

// --- A12/7C: staff notifications, reward redemption and membership revocation ---
const staffChannel="300000000000000001",notifyEnv={...env,COMMERCE_STAFF_CHANNEL_ID:staffChannel};

test("staff notification status reports the real deployment state",async()=>{
 const options=(e:Record<string,string>,q:CommerceDeps["query"]=async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[])=>fixture(e,q).inject({url:"/api/payments/options"});
 assert.equal((await options(env)).json().notificationStatus,"disabled","no staff channel means notifications are off, honestly");
 assert.equal((await options({...env,COMMERCE_STAFF_CHANNEL_ID:"staff"})).json().notificationStatus,"misconfigured","a channel id that is not a snowflake is misconfiguration");
 const controls=(pref:Record<string,unknown>,enabled=true):CommerceDeps["query"]=>async(sql)=>sql.includes("guild_controls")?[{notifications_enabled:enabled,notification_preferences:pref}]:sql.includes("access.guilds")?[{guild_id:guild}]:[];
 assert.equal((await options(notifyEnv,controls({}))).json().notificationStatus,"enabled");
 assert.equal((await options(notifyEnv,controls({},false))).json().notificationStatus,"disabled","the guild control can switch order notifications off");
 assert.equal((await options(notifyEnv,controls({orders:false}))).json().notificationStatus,"disabled","the per-category preference can switch order notifications off");
});

test("a fresh claim enqueues exactly one durable staff notification",async()=>{
 const token="t".repeat(43),outbox:unknown[][]=[];
 const row={order_id:"11111111-2222-4333-8444-555555555555",public_id:"RP-ABC123",buyer_id:guild,sku:"membership",service_name:"Membership",amount_minor:"70000",method:"upi",status:"pending",order_token_hash:createHash("sha256").update(token).digest("hex"),expires_at:new Date(Date.now()+3600000),referral_code:null};
 const app=fixture(notifyEnv,async(sql,p)=>{
  if(sql.includes("guild_controls"))return [{notifications_enabled:true,notification_preferences:{}}];
  if(sql.includes("checkout_rate_limits"))return [{requests:1}];
  if(sql.includes("access.guilds"))return [{guild_id:guild}];
  if(sql.includes("INSERT INTO ops.outbox")){outbox.push(p!);return [];}
  if(sql.includes("INSERT INTO commerce.claims")||sql.includes("UPDATE commerce.orders"))return [];
  if(sql.includes("commerce.orders"))return [row];
  if(sql.includes("commerce.claims"))return [];
  return [];
 });
 const res=await app.inject({method:"POST",url:"/api/payments/claim",headers:{origin:env.PAYMENT_ORIGIN},payload:{orderId:"RP-ABC123",token,utr:"123456789012",idempotencyKey:"notify-claim-key"}});
 assert.equal(res.statusCode,200,res.body);
 assert.equal(res.json().notificationStatus,"enabled");
 assert.equal(outbox.length,1,"one outbox event per fresh claim");
 const [guildParam,payload,correlation]=outbox[0]!;
 assert.equal(guildParam,guild);
 assert.deepEqual(JSON.parse(String(payload)),{category:"orders",orderId:"RP-ABC123",buyerId:guild,serviceName:"Membership",amountMinor:70000,method:"upi",proofRef:"upi:123456789012"});
 assert.equal(correlation,"claim:notify-claim-key");
 await app.close();
});

test("a buyer's reserved rewards reduce the server-side price and are reserved on the order",async()=>{
 const token="c".repeat(43);let inserted:unknown[]|null=null;const reserves:unknown[][]=[];
 const app=fixture(env,async(sql,p)=>{
  if(sql.includes("checkout_rate_limits"))return [{requests:1}];
  if(sql.includes("access.guilds"))return [{guild_id:guild}];
  if(sql.includes("WHERE idempotency_key"))return [];
  if(sql.includes("commerce.catalog"))return [{sku:"membership",name:"Membership",price_minor:70000,currency:"INR",membership_days:30}];
  if(sql.includes("FROM commerce.rewards"))return [{reward_id:"r1",amount_minor:"2000"},{reward_id:"r2",amount_minor:"3000"}];
  if(sql.includes("INSERT INTO commerce.orders")){inserted=p!;return [{guild_id:p![0],buyer_id:p![1],sku:p![2],amount_minor:p![3],order_token_hash:p![4],public_id:p![6],method:p![7],referral_code:p![8],request_hash:p![9],service_name:p![10],membership_days:p![11],credit_applied_minor:p![12],order_id:"11111111-2222-4333-8444-555555555555",status:"pending",expires_at:new Date(Date.now()+60000)}];}
  if(sql.includes("UPDATE commerce.rewards SET status='redeemed'")){reserves.push(p!);return [];}
  return [];
 });
 const res=await app.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:"membership",paymentMethod:"upi",idempotencyKey:"credit-key-1234",recoveryToken:token}});
 assert.equal(res.statusCode,200,res.body);
 assert.equal(inserted![3],65000,"the buyer pays the credit-reduced price");
 assert.equal(inserted![12],5000);
 assert.equal(res.json().creditAppliedMinor,5000);
 assert.deepEqual(reserves[0],[["r1","r2"],"11111111-2222-4333-8444-555555555555"]);
 await app.close();
});

test("membership revocation is an admin review control with honest outcomes",async()=>{
 const member="200000000000000001",base=`/api/guilds/${guild}/commerce/memberships/${member}/revoke`;
 const denied=await fixture(env,async()=>[],session(),false).inject({method:"POST",url:base});
 assert.equal(denied.statusCode,403);assert.equal(denied.json().code,"admin-required");
 const revokes:unknown[][]=[];
 const app=fixture(env,async(sql,p)=>{if(sql.includes("commerce.memberships")){if(sql.includes("SELECT"))return [{user_id:member}];revokes.push(p!);return [];}return [];},session(),true);
 const res=await app.inject({method:"POST",url:base});
 assert.equal(res.statusCode,200,res.body);assert.deepEqual(res.json(),{userId:member,status:"revoked"});
 assert.deepEqual(revokes[0],[guild,member]);
 assert.equal((await app.inject({method:"POST",url:`/api/guilds/${guild}/commerce/memberships/123/revoke`})).statusCode,400);
 await app.close();
 const missing=fixture(env,async()=>[],session(),true);
 assert.equal((await missing.inject({method:"POST",url:base})).statusCode,404);
 await missing.close();
});
