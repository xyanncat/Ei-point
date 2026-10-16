import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerCommerceRoutes, type CommerceDeps } from "./commerce-routes.js";
const guild = "123456789012345678";
function fixture(env: Record<string,string> = {}, query: CommerceDeps["query"] = async () => []) {
  const app = Fastify();
  registerCommerceRoutes(app, { env, query, transaction: async (work) => work(query), authorize: async () => ({userId:guild,isAdmin:false}) });
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
test("client price and invalid buyer cannot create an order", async () => {
 const app=fixture(env,async(sql)=>sql.includes("access.guilds")?[{guild_id:guild}]:[]); const res=await app.inject({method:"POST",url:"/api/payments/upi-qr",headers:{origin:env.PAYMENT_ORIGIN},payload:{serviceId:"anything",discordUserId:"1",amount:1}});
 assert.equal(res.statusCode,400); await app.close();
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
 registerCommerceRoutes(app,{env,query:async()=>rows,transaction:async(work)=>work(async()=>[]),authorize:async()=>({userId:guild,isAdmin:admin})});
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
