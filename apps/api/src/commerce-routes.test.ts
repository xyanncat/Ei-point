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
