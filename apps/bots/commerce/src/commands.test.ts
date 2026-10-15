import {test} from "node:test";
import assert from "node:assert/strict";
import {respondToCommerceCommand,type CommerceCommandRequest} from "./commands.js";
import {canSettleCommerce} from "./authorization.js";
import {executeClaim,executeSettle} from "@ei-point/module-commerce";
const guild="100000000000000001",buyer="200000000000000001";
test("status scopes target guild and buyer; staff privilege stays within guild",async()=>{
 for(const canManage of [false,true]){let checked=false;let reply="";const pool={query:async(sql:string,p:unknown[])=>{assert.match(sql,/guild_id=\$2/);assert.match(sql,/buyer_id=\$3/);assert.deepEqual(p,["foreign-order",guild,buyer,canManage]);checked=true;return {rows:[]};}};
 await respondToCommerceCommand({name:"order",subcommand:"status",options:{order_id:"foreign-order"},guildId:guild,userId:buyer,canManage,isOwner:false,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,pool as any);assert.ok(checked);assert.match(reply,/not found/);}
});
test("claim and settlement reject a target outside their lock scope before writes",async()=>{
 for(const mode of ["claim","settle"]){let calls=0;const db={query:async(sql:string,p:unknown[])=>{calls++;assert.match(sql,/guild_id=\$2/);assert.equal(p[1],guild);assert.equal(p[2],mode==="claim"?buyer:null);return {rows:[],rowCount:0};}};
 const r=mode==="claim"?await executeClaim(db,{orderId:"foreign",guildId:guild,buyerId:buyer,proofRef:"proof",idempotencyKey:"claim-test"}):await executeSettle(db,{orderId:"foreign",guildId:guild,settledBy:buyer,idempotencyKey:"settle-test"});assert.equal(r.ok,false);assert.equal(calls,1);}
});

test("Discord checkout fails closed before database access when payee is missing or invalid",async()=>{
 for(const payeeVpa of ["","payments@", "bad-vpa"]){let queries=0,reply="";const pool={query:async()=>{queries++;throw Error("must not query unconfigured checkout");}};
 await respondToCommerceCommand({name:"order",subcommand:"create",options:{sku:"membership"},guildId:guild,userId:buyer,payeeVpa,payeeName:"Studio",paymentOrigin:"https://checkout.example",canManage:false,isOwner:false,userScopes:[],reply:async(s:string)=>{reply=s;}} as unknown as CommerceCommandRequest,pool as any);assert.equal(queries,0);assert.match(reply,/not configured/);}
});

test("only owners, Manage Server members or settlement-scoped staff may settle",()=>{
 assert.equal(canSettleCommerce({isOwner:false,canManage:false,userScopes:[]}),false);
 assert.equal(canSettleCommerce({isOwner:false,canManage:false,userScopes:["commerce-settle"]}),true);
 assert.equal(canSettleCommerce({isOwner:true,canManage:false,userScopes:[]}),true);
 assert.equal(canSettleCommerce({isOwner:false,canManage:true,userScopes:[]}),true);
});
