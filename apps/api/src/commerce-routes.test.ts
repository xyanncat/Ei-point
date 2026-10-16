import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerCommerceRoutes, type CommerceDeps } from "./commerce-routes.js";
const guild = "123456789012345678";
const session = (discordUserId: string | null = guild): CommerceDeps["session"] =>
  async () => (discordUserId === null ? null : { discordUserId });
function fixture(env: Record<string,string> = {}, query: CommerceDeps["query"] = async () => [], who: CommerceDeps["session"] = session()) {
  const app = Fastify();
  registerCommerceRoutes(app, { env, query, session: who, transaction: async (work) => work(query), authorize: async () => ({userId:guild,isAdmin:false}) });
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
