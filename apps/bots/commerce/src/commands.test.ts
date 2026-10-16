import {test} from "node:test";
import assert from "node:assert/strict";
import {respondToCommerceCommand,catalogChoices,type CommerceCommandRequest} from "./commands.js";
import {canSettleCommerce} from "./authorization.js";
import {executeClaim,executeReject,executeSettle} from "@ei-point/module-commerce";
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
test("orders list pages the caller's own history instead of the catalog",async()=>{
 let reply="";const seen:string[]=[];
 const pool={query:async(sql:string,p:unknown[])=>{seen.push(sql);if(/count\(\*\)/.test(sql)){assert.deepEqual(p,[guild,buyer]);return {rows:[{total:7}]};}assert.match(sql,/WHERE guild_id=\$1 AND buyer_id=\$2/);assert.match(sql,/ORDER BY created_at DESC LIMIT \$3 OFFSET \$4/);assert.deepEqual(p,[guild,buyer,5,5]);return {rows:[{order_id:"11111111-2222-4333-8444-555555555555",public_id:"RP-AAA111",sku:"membership",service_name:"Membership",amount_minor:"70000",status:"claimed",created_at:new Date("2026-10-01T00:00:00Z")}]};}};
 await respondToCommerceCommand({name:"orders",subcommand:"list",options:{page:2},guildId:guild,userId:buyer,isOwner:false,canManage:false,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,pool as any);
 assert.equal(seen.length,2);assert.ok(!seen.some((sql)=>sql.includes("commerce.catalog")));
 assert.match(reply,/Membership/);assert.match(reply,/RP-AAA111/);assert.match(reply,/CLAIMED/);assert.match(reply,/page 2 of 2/i);
});
test("orders list reports an empty history honestly",async()=>{
 let reply="";
 const pool={query:async(sql:string)=> /count\(\*\)/.test(sql)?{rows:[{total:0}]}:{rows:[]}};
 await respondToCommerceCommand({name:"orders",subcommand:"list",options:{},guildId:guild,userId:buyer,isOwner:false,canManage:false,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,pool as any);
 assert.match(reply,/no orders/i);
});
test("staff review lists claimed orders with proof; non-staff are denied before any query",async()=>{
 let reply="";let queries=0;
 await respondToCommerceCommand({name:"orders",subcommand:"review",options:{},guildId:guild,userId:buyer,isOwner:false,canManage:false,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,{query:async()=>{queries++;return {rows:[]};}} as any);
 assert.equal(queries,0);assert.match(reply,/Permission denied/);
 const seen:string[]=[];
 const pool={query:async(sql:string,p:unknown[])=>{seen.push(sql);if(/count\(\*\)/.test(sql)){assert.deepEqual(p,[guild]);return {rows:[{total:1}]};}assert.match(sql,/status='claimed'/);assert.match(sql,/LEFT JOIN commerce\.claims/);assert.deepEqual(p,[guild,5,0]);return {rows:[{order_id:"11111111-2222-4333-8444-555555555555",public_id:"RP-REV123",service_name:"Membership",amount_minor:"70000",status:"claimed",proof_ref:"upi:123456789012",created_at:new Date("2026-10-02T00:00:00Z")}]};}};
 reply="";
 await respondToCommerceCommand({name:"orders",subcommand:"review",options:{},guildId:guild,userId:"300000000000000009",isOwner:false,canManage:true,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,pool as any);
 assert.equal(seen.length,2);assert.match(reply,/RP-REV123/);assert.match(reply,/11111111-2222-4333-8444-555555555555/);assert.match(reply,/upi:123456789012/);
});
test("staff rejection transitions once and refuses non-staff before any database work",async()=>{
 let reply="";let touched=0;
 await respondToCommerceCommand({name:"orders",subcommand:"reject",options:{order_id:"uuid-1"},guildId:guild,userId:buyer,isOwner:false,canManage:false,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,{query:async()=>{touched++;return {rows:[]};},connect:async()=>{touched++;throw Error("must not connect");}} as any);
 assert.equal(touched,0);assert.match(reply,/Permission denied/);
 const statements:string[]=[];let committed=false;
 const client={query:async(sql:string)=>{statements.push(sql);if(sql==="BEGIN"||sql==="ROLLBACK")return {rows:[],rowCount:null};if(sql==="COMMIT"){committed=true;return {rows:[],rowCount:null};}if(/FOR UPDATE/.test(sql))return {rows:[{order_id:"uuid-1",status:"claimed"}],rowCount:1};if(/UPDATE commerce\.orders SET status = 'rejected'/.test(sql))return {rows:[],rowCount:1};if(/UPDATE commerce\.claims SET status = 'rejected'/.test(sql))return {rows:[],rowCount:1};throw Error(`Unexpected query: ${sql}`);},release:()=>{}};
 reply="";
 await respondToCommerceCommand({name:"orders",subcommand:"reject",options:{order_id:"uuid-1"},guildId:guild,userId:"300000000000000009",isOwner:false,canManage:true,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,{connect:async()=>client} as any);
 assert.equal(committed,true);assert.ok(statements.some((sql)=>/UPDATE commerce\.orders SET status = 'rejected'/.test(sql)));assert.ok(statements.some((sql)=>/UPDATE commerce\.claims SET status = 'rejected'/.test(sql)));assert.match(reply,/rejected/i);
});
test("catalog autocomplete offers active services for the sku option",async()=>{
 const seen:Array<{sql:string;params:unknown[]}>=[];const pool={query:async(sql:string,params:unknown[])=>{seen.push({sql,params});return {rows:[{sku:"membership",name:"Membership"},{sku:"genshin-main-event",name:"Genshin Main Event"}]};}};
 const choices=await catalogChoices(pool as any,"mem");
 assert.equal(seen.length,1);assert.match(seen[0]!.sql,/FROM commerce\.catalog/);assert.match(seen[0]!.sql,/active=true/);assert.match(seen[0]!.sql,/LIMIT 25/);assert.deepEqual(seen[0]!.params,["mem"]);
 assert.deepEqual(choices,[{name:"Membership (membership)",value:"membership"},{name:"Genshin Main Event (genshin-main-event)",value:"genshin-main-event"}]);
});
