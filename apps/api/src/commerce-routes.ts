import { fulfillOrder } from "@ei-point/module-commerce";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export type CommerceQuery = (sql:string, params?:unknown[])=>Promise<Record<string,any>[]>;
export interface CommerceDeps {
 env: Record<string,string|undefined>;
 query: CommerceQuery;
 transaction: <T>(work:(query:CommerceQuery)=>Promise<T>)=>Promise<T>;
 authorize: (req:FastifyRequest,guildId:string,module:"commerce")=>Promise<{userId:string,isAdmin:boolean}>;
}
class PaymentError extends Error {constructor(readonly status:number,readonly code:string,message:string){super(message);}}
const fail=(status:number,code:string,message:string):never=>{throw new PaymentError(status,code,message)};
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const snowflake=(s:unknown):s is string=>typeof s==="string"&&/^\d{17,20}$/.test(s);
const publicId=(s:unknown):s is string=>typeof s==="string"&&/^RP-[A-Z0-9]{6}$/.test(s);
const cycle=()=>new Date().toISOString().slice(0,7);
const amount=(n:unknown)=>(Number(n)/100).toFixed(2);
export async function maintainCommerce(query:CommerceQuery):Promise<void>{
 await query("UPDATE commerce.orders SET status='expired' WHERE status='pending' AND expires_at<now()");
 await query("UPDATE commerce.rewards SET status='expired' WHERE status='reserved' AND cycle<$1",[cycle()]);
}
export function registerCommerceRoutes(app:FastifyInstance,deps:CommerceDeps){
 const {env,query,transaction}=deps;
 const origin=env.PAYMENT_ORIGIN??env.DASHBOARD_ORIGIN;
 const guild=env.COMMERCE_GUILD_ID;
 const usdtRate=Number(env.INR_PER_USDT),usdtFee=Number(env.USDT_REFERENCE_FEE??1);
 const methods=()=>({upi:!!env.UPI_PAYEE_NAME&&/^[-\w.]{2,}@[A-Za-z]{2,}$/.test(env.UPI_PAYEE_VPA??""),usdt:/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(env.USDT_TRC20_ADDRESS??"")&&Number.isFinite(usdtRate)&&usdtRate>0&&Number.isFinite(usdtFee)&&usdtFee>=0});
 const guard=()=>{if(!snowflake(guild)||!origin)fail(503,"payments-not-configured","Payments are not configured for this deployment.");};
 const run=(handler:(req:FastifyRequest,reply:any)=>Promise<unknown>)=>async(req:FastifyRequest,reply:any)=>{
  try{return await handler(req,reply);}catch(e){if(e instanceof PaymentError)return reply.code(e.status).send({code:e.code,error:e.message});
   if((e as any)?.code==="23505")return reply.code(409).send({code:"payment-conflict",error:"This payment proof or order already exists."});throw e;}
 };
 const limit=async(req:FastifyRequest)=>{
  const rows=await query(`INSERT INTO commerce.checkout_rate_limits(bucket) VALUES($1)
   ON CONFLICT(bucket) DO UPDATE SET requests=CASE WHEN commerce.checkout_rate_limits.window_started_at < now()-interval '1 minute' THEN 1 ELSE commerce.checkout_rate_limits.requests+1 END,
   window_started_at=CASE WHEN commerce.checkout_rate_limits.window_started_at < now()-interval '1 minute' THEN now() ELSE commerce.checkout_rate_limits.window_started_at END RETURNING requests`,[hash(req.ip)]);
  if(Number(rows[0]?.requests??1)>30)fail(429,"rate-limit","Too many payment requests. Retry shortly.");
 };
 const publicWrite=async(req:FastifyRequest)=>{guard();if(req.headers.origin!==origin)fail(403,"origin-denied","Payment requests require the configured website Origin.");await limit(req);const approved=(await query("SELECT guild_id FROM access.guilds WHERE guild_id=$1 AND approved",[guild]))[0];if(!approved)fail(403,"guild-not-approved","Commerce guild is not approved.");};
 const body=(req:FastifyRequest)=>req.body as Record<string,unknown>??{};
 // HttpOnly recovery cookie: reloads and lost responses resume the same order without
 // privileged secrets in localStorage or URLs. One checkout at a time is intentional.
 const recoveryCookie=(serviceId:string,orderId:string,token:string)=>{
  const secure=(origin??"").startsWith("https")?"; Secure":"";
  return `ei_checkout=${encodeURIComponent([serviceId,orderId,token].join("|"))}; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax${secure}`;
 };
 const readRecoveryCookie=(req:FastifyRequest):[string,string,string]|null=>{
  const header=req.headers.cookie;if(typeof header!=="string")return null;
  const match=header.split(";").map(p=>p.trim()).find(p=>p.startsWith("ei_checkout="));
  if(!match)return null;
  try{const [serviceId,orderId,token]=decodeURIComponent(match.slice("ei_checkout=".length)).split("|");if(!serviceId||!publicId(orderId)||!token)return null;return [serviceId,orderId,token];}catch{return null;}
 };
 const orderResponse=(order:Record<string,any>,token:string)=>{
  const vpa=env.UPI_PAYEE_VPA,name=env.UPI_PAYEE_NAME,wallet=env.USDT_TRC20_ADDRESS,method=order.method==="usdt"?"usdt":"upi";
  const note=`${order.public_id} Discord ${order.buyer_id}`,upiUri=`upi://pay?${new URLSearchParams({pa:vpa??"",pn:name??"",am:amount(order.amount_minor),cu:"INR",tn:note})}`;
  return {...view(order),token,orderToken:token,amountMinor:Number(order.amount_minor),currency:method==="upi"?"INR":"USDT",paymentMethod:method,paymentUri:method==="upi"?upiUri:wallet,destination:method==="upi"?vpa:wallet,expiresAt:order.expires_at,referralApplied:!!order.referral_code,qrPayload:method==="upi"?upiUri:wallet,
   ...(method==="upi"?{upiUri,payeeVpa:vpa,payeeName:name,note}:{walletAddress:wallet,network:"TRC-20 (Tron)",usdAmount:amount(order.amount_minor)}),notificationStatus:"not-configured"};
 };
 const key=(req:FastifyRequest)=>{const v=req.headers["idempotency-key"]??body(req).idempotencyKey;if(typeof v!=="string"||!/^[A-Za-z0-9:_-]{8,128}$/.test(v))fail(400,"invalid-idempotency-key","Supply an 8–128 character Idempotency-Key.");return v as string;};
 const view=(o:Record<string,any>)=>({orderId:o.public_id,status:o.status==="settled"?"confirmed":o.status==="pending"&&new Date(o.expires_at).getTime()<Date.now()?"expired":o.status,amount:amount(o.amount_minor),method:o.method,paymentMethod:o.method,currency:o.method==="upi"?"INR":"USDT",serviceName:o.service_name??o.name,name:o.service_name??o.name,expiresAt:o.expires_at});
 app.get("/api/payments/options",run(async()=>{const configured=snowflake(guild)&&!!origin&&(methods().upi||methods().usdt);const approved=configured&&(await query("SELECT guild_id FROM access.guilds WHERE guild_id=$1 AND approved",[guild])).length>0;return {enabled:!!approved,methods:methods(),notificationStatus:"not-configured"};}));
 app.get("/api/payments/catalog",run(async()=>{guard();return {services:await query("SELECT sku AS id,name,price_minor AS \"priceMinor\",currency,membership_days AS \"membershipDays\" FROM commerce.catalog WHERE active ORDER BY sku"),methods:methods()};}));
 app.post("/api/payments/upi-qr",run(async(req,reply)=>{
  await publicWrite(req);const b=body(req),method=b.paymentMethod??b.method??"upi",buyer=b.discordId??b.discordUserId,sku=b.serviceId;
  if(!snowflake(buyer)||typeof sku!=="string"||sku.length>100||!['upi','usdt'].includes(String(method)))fail(400,"invalid-checkout","Provide a valid service, Discord user ID and payment method.");
  if(b.amount!==undefined||b.price!==undefined)fail(400,"invalid-checkout","Prices are selected by the server.");
  const vpa=env.UPI_PAYEE_VPA,name=env.UPI_PAYEE_NAME,wallet=env.USDT_TRC20_ADDRESS;
  if(method==="upi"&&(!vpa||!name||!/^[-\w.]{2,}@[A-Za-z]{2,}$/.test(vpa)))fail(503,"payments-not-configured","UPI payments are not configured.");
  if(method==="usdt"&&!methods().usdt)fail(503,"payments-not-configured","TRC-20 payments require a configured wallet and INR_PER_USDT quote.");
  const idem=key(req),ref=b.referralCode??null;
  if(ref!==null&&(typeof ref!=="string"||!/^[A-Z0-9-]{6,24}$/.test(ref)))fail(400,"invalid-referral","Referral code is invalid.");
  const requestHash=hash(JSON.stringify([guild,buyer,sku,method,ref]));
  if(b.recoveryToken!==undefined&&(typeof b.recoveryToken!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(b.recoveryToken)))fail(400,"invalid-recovery-token","Supply a random 32-byte checkout secret.");
  const token=typeof b.recoveryToken==="string"?b.recoveryToken:randomBytes(32).toString("base64url"),id="RP-"+randomBytes(3).toString("hex").toUpperCase();
  const order=await transaction(async(q)=>{
   await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[idem]);
   const old=(await q("SELECT * FROM commerce.orders WHERE idempotency_key=$1",[idem]))[0];
   if(old){if(old.request_hash!==requestHash)fail(409,"idempotency-conflict","This key belongs to another checkout.");if(typeof b.recoveryToken!=="string"||old.order_token_hash!==hash(token))fail(409,"checkout-already-created","Checkout already exists. Use the original order and token.");return old;}
   const item=(await q("SELECT * FROM commerce.catalog WHERE sku=$1 AND active FOR SHARE",[sku]))[0];
   if(!item||item.currency!=="INR")fail(400,"invalid-service","Service is unavailable.");
   if(ref){const r=(await q("SELECT * FROM commerce.referrals WHERE code=$1 AND guild_id=$2 AND cycle=$3 FOR UPDATE",[ref,guild,cycle()]))[0];if(!r||r.referrer_id===buyer)fail(400,"invalid-referral","Referral is expired, unknown or belongs to you.");}
   const minor=method==="usdt"?Math.round(Number(item!.price_minor)/100/usdtRate+usdtFee)*100:Number(item!.price_minor);
   if(!Number.isSafeInteger(minor)||minor<=0)fail(503,"invalid-catalog","Service pricing is unavailable.");
   const rows=await q(`INSERT INTO commerce.orders(guild_id,buyer_id,sku,amount_minor,order_token_hash,idempotency_key,public_id,method,referral_code,request_hash,service_name,membership_days)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[guild,buyer,sku,minor,hash(token),idem,id,method,ref,requestHash,item!.name,item!.membership_days]);return rows[0]!;
  });
   reply.header("set-cookie",recoveryCookie(order.sku,order.public_id,token));
   return orderResponse(order,token);
  }));
  app.get("/api/payments/resume",run(async(req)=>{
   guard();await limit(req);
   const serviceId=String((req.query as Record<string,unknown>)?.serviceId??"");
   if(!serviceId||serviceId.length>100)fail(400,"invalid-service","A service id is required.");
   const cookie=readRecoveryCookie(req);
   if(!cookie||cookie[0]!==serviceId)return {resumed:false};
   const [,orderId,token]=cookie;
   const o=(await query("SELECT * FROM commerce.orders WHERE public_id=$1 AND guild_id=$2",[orderId,guild]))[0];
   if(!o||o.order_token_hash!==hash(token))return {resumed:false};
   return {...orderResponse(o,token),resumed:true};
  }));
  app.get<{Params:{orderId:string}}>("/api/payments/status/:orderId",run(async(req)=>{guard();await limit(req);const id=(req.params as any).orderId;if(!publicId(id))fail(400,"invalid-order","Order IDs look like RP-XXXXXX.");const o=(await query("SELECT o.*,c.name FROM commerce.orders o JOIN commerce.catalog c USING(sku) WHERE public_id=$1 AND guild_id=$2",[id,guild]))[0];if(!o)fail(404,"order-not-found","Order was not found.");return view(o!);}));
 app.post("/api/payments/claim",run(async(req)=>{
  await publicWrite(req);const b=body(req),id=b.orderId,token=b.token??b.orderToken;
  if(!publicId(id)||typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token))fail(400,"invalid-claim","Supply the order ID and original order token.");
  const idem=key(req);return transaction(async(q)=>{
   const o=(await q("SELECT * FROM commerce.orders WHERE public_id=$1 AND guild_id=$2 FOR UPDATE",[id,guild]))[0];
   const expBuf=Buffer.from(hash(token as string)),actBuf=Buffer.from(String(o?.order_token_hash??""));
   if(!o||expBuf.length!==actBuf.length||!timingSafeEqual(expBuf,actBuf))fail(403,"invalid-order-token","Order token is invalid.");
   const proof=o!.method==="usdt"?b.txid:b.utr;
   if(typeof proof!=="string"||!(o!.method==="usdt"?/^[a-fA-F0-9]{64}$/:/^\d{12}$/).test(proof))fail(400,"invalid-proof","Supply a 12-digit UTR or 64-character TRON transaction hash for this method.");
   const proofRef=`${o!.method}:${String(proof).toLowerCase()}`;
   if(o!.status==="claimed"){const c=(await q("SELECT * FROM commerce.claims WHERE order_id=$1",[o!.order_id]))[0];if(c?.proof_ref===proofRef)return {orderId:id,status:"claimed",notificationStatus:"not-configured"};}
   if(o!.status!=="pending")fail(409,"order-not-pending","Order cannot accept a claim.");
   if(new Date(o!.expires_at).getTime()<Date.now())fail(409,"order-expired","Order expired. Create a fresh checkout.");
   await q("INSERT INTO commerce.claims(order_id,proof_ref,idempotency_key) VALUES($1,$2,$3)",[o!.order_id,proofRef,idem]);
   await q("UPDATE commerce.orders SET status='claimed' WHERE order_id=$1",[o!.order_id]);return {orderId:id,status:"claimed",notificationStatus:"not-configured"};
  });
 }));
 const staff=async(req:FastifyRequest)=>{const id=(req.params as any).guildId;if(!snowflake(id))fail(400,"invalid-guild","Guild is invalid.");const s=await deps.authorize(req,id,"commerce");if(!s.isAdmin)fail(403,"admin-required","Administrator access is required for payment operations.");return s;};
 app.get("/api/guilds/:guildId/commerce/orders",run(async(req)=>{await staff(req);return {orders:await query(`SELECT o.public_id AS "orderId",o.buyer_id AS "buyerId",o.sku,o.service_name AS "serviceName",o.amount_minor AS "amountMinor",o.method,o.status,o.created_at AS "createdAt",o.expires_at AS "expiresAt",c.proof_ref AS "proofRef" FROM commerce.orders o LEFT JOIN commerce.claims c USING(order_id) WHERE o.guild_id=$1 ORDER BY o.created_at DESC LIMIT 100`,[(req.params as any).guildId])};}));
 for(const action of ["settle","reject"] as const)app.post(`/api/guilds/:guildId/commerce/orders/:orderId/${action}`,run(async(req)=>{
  const s=await staff(req),p=req.params as any;if(!publicId(p.orderId))fail(400,"invalid-order","Order is invalid.");const idem=key(req);
  return transaction(async(q)=>{const o=(await q("SELECT * FROM commerce.orders WHERE public_id=$1 AND guild_id=$2 FOR UPDATE",[p.orderId,p.guildId]))[0];if(!o)fail(404,"order-not-found","Order was not found.");
   const target=action==="settle"?"settled":"rejected";if(o!.status===target)return {orderId:p.orderId,status:target};
   if(action==="settle"?o!.status!=="claimed":!['pending','claimed'].includes(o!.status))fail(409,"invalid-order-state","Order cannot transition to that state.");
   if(action==="settle"){
    await q("INSERT INTO commerce.settlements(order_id,settled_by,idempotency_key) VALUES($1,$2,$3)",[o!.order_id,s.userId,idem]);
    await fulfillOrder(q,o!,Number(env.COMMERCE_REFERRAL_REWARD_MINOR??0));
   }
   await q("UPDATE commerce.orders SET status=$2 WHERE order_id=$1",[o!.order_id,target]);
   await q("UPDATE commerce.claims SET status=$2 WHERE order_id=$1",[o!.order_id,action==="settle"?"confirmed":"rejected"]);
   return {orderId:p.orderId,status:target};
  });
 }));
}

