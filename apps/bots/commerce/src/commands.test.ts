import {test} from "node:test";
import assert from "node:assert/strict";
import {respondToCommerceCommand,type CommerceCommandRequest} from "./commands.js";
import {canSettleCommerce} from "./authorization.js";
import {executeClaim,executeSettle} from "@ei-point/module-commerce";
const guild="100000000000000001",buyer="200000000000000001";
test("status scopes target guild and buyer; staff privilege stays within guild",async()=>{
 for(const canManage of [false,true]){let checked=false;let reply="";const pool={query:async(sql:string,p:unknown[])=>{assert.match(sql,/guild_id=\$2/);assert.match(sql,/buyer_id=\$3/);assert.deepEqual(p,["foreign-order",guild,buyer,canManage]);checked=true;return {rows:[]};}};
 await respondToCommerceCommand({name:"orders",subcommand:"status",options:{order_id:"foreign-order"},guildId:guild,userId:buyer,canManage,isOwner:false,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,pool as any);assert.ok(checked);assert.match(reply,/not found/);}
});
test("claim and settlement reject a target outside their lock scope before writes",async()=>{
 for(const mode of ["claim","settle"]){let calls=0;const db={query:async(sql:string,p:unknown[])=>{calls++;assert.match(sql,/guild_id=\$2/);assert.equal(p[1],guild);assert.equal(p[2],mode==="claim"?buyer:null);return {rows:[],rowCount:0};}};
 const r=mode==="claim"?await executeClaim(db,{orderId:"foreign",guildId:guild,buyerId:buyer,proofRef:"proof",idempotencyKey:"claim-test"}):await executeSettle(db,{orderId:"foreign",guildId:guild,settledBy:buyer,idempotencyKey:"settle-test"});assert.equal(r.ok,false);assert.equal(calls,1);}
});

test("Discord checkout fails closed before database access when payee is missing or invalid",async()=>{
 for(const payeeVpa of ["","payments@", "bad-vpa"]){let queries=0,reply="";const pool={query:async()=>{queries++;throw Error("must not query unconfigured checkout");}};
 await respondToCommerceCommand({name:"orders",subcommand:"create",options:{sku:"membership"},guildId:guild,userId:buyer,payeeVpa,payeeName:"Studio",paymentOrigin:"https://checkout.example",canManage:false,isOwner:false,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,pool as any);assert.equal(queries,0);assert.match(reply,/not configured/);}
});

test("only owners, Manage Server members or settlement-scoped staff may settle",()=>{
 assert.equal(canSettleCommerce({isOwner:false,canManage:false,userScopes:[]}),false);
 assert.equal(canSettleCommerce({isOwner:false,canManage:false,userScopes:["commerce-settle"]}),true);
 assert.equal(canSettleCommerce({isOwner:true,canManage:false,userScopes:[]}),true);
 assert.equal(canSettleCommerce({isOwner:false,canManage:true,userScopes:[]}),true);
});

test("a redeemed referral is attached to one order and consumed in the same transaction", async () => {
 let savedCode: string | null = "EI-REFERRAL";
 let version = 1;
 let orderNumber = 0;
 const attachedCodes: unknown[] = [];
 const pool = {
  query: async (sql: string) => {
   assert.match(sql, /FROM commerce\.catalog/);
   return { rows: [{ sku: "membership", name: "Membership", price_minor: "500", currency: "INR", membership_days: 30 }] };
  },
  connect: async () => {
   let pendingCode: string | null | undefined;
   let inTransaction = false;
   return {
    query: async (sql: string, params: unknown[] = []) => {
     if (sql === "BEGIN") { inTransaction = true; return { rows: [] }; }
     if (sql === "COMMIT") { assert.ok(inTransaction); if (pendingCode !== undefined) { savedCode = pendingCode; version++; } inTransaction = false; return { rows: [] }; }
     if (sql === "ROLLBACK") { inTransaction = false; pendingCode = undefined; return { rows: [] }; }
     assert.ok(inTransaction, "referral lookup and order writes must stay transactional");
     if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
     if (/SELECT version, value FROM config\.settings/.test(sql)) return { rows: [{ version, value: { code: savedCode } }] };
     if (/FROM commerce\.referrals/.test(sql)) return { rows: [{ referrer_id: "another-user" }] };
     if (/INSERT INTO commerce\.orders/.test(sql)) { orderNumber++; attachedCodes.push(params[9] ?? null); return { rows: [{ order_id: `order-${orderNumber}` }] }; }
     if (/INSERT INTO config\.settings/.test(sql)) { pendingCode = (params[2] as { code: string | null }).code; return { rows: [] }; }
     throw new Error(`Unexpected query: ${sql}`);
    },
    release: () => {},
   };
  },
 };
 const makeRequest = (key: string) => ({ name: "orders", subcommand: "create", options: { sku: "membership" }, guildId: guild, userId: buyer, key, payeeVpa: "payee@bank", payeeName: "Studio", paymentOrigin: "https://checkout.example", canManage: false, isOwner: false, userScopes: [], defer: async () => {}, reply: async () => {} } as unknown as CommerceCommandRequest);
 await respondToCommerceCommand(makeRequest("interaction-1"), pool as any);
 assert.equal(savedCode, null);
 await respondToCommerceCommand(makeRequest("interaction-2"), pool as any);
 assert.equal(orderNumber, 2);
 assert.deepEqual(attachedCodes, ["EI-REFERRAL", null]);
 assert.equal(savedCode, null);
});
