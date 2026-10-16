"use client";
import {useEffect,useState,useRef} from "react";
import {api} from "../lib/api";
type Order={orderId:string;buyerId?:string;serviceName:string;amountMinor:number|string;method:string;status:string;createdAt:string;proofRef?:string|null};
export function CommerceOrders({guildId,scopes}:{guildId:string;scopes:string[]}){
 const [orders,setOrders]=useState<Order[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const admin=scopes.includes("*")||scopes.includes("commerce-settle"),read=admin||scopes.includes("commerce"),base=`/api/guilds/${encodeURIComponent(guildId)}/commerce/orders`;
 const context=useRef(base),sequence=useRef(0);context.current=base;
 async function load(){const source=base,request=++sequence.current;setBusy(true);setError("");try{const result=await api<{orders:Order[]}>(source);if(context.current===source&&sequence.current===request)setOrders(result.orders);}catch(e){if(context.current===source&&sequence.current===request)setError(e instanceof Error?e.message:"Orders are unavailable.");}finally{if(context.current===source&&sequence.current===request)setBusy(false);}}
 useEffect(()=>{setOrders([]);setNotice("");if(read)void load();return()=>{sequence.current++;};},[guildId,read]);
 async function action(order:Order,value:"settle"|"reject"){
  if(value==="settle"&&!window.confirm(`Confirm you matched ${order.orderId} against the payment statement. Settling activates membership and referral rewards. Continue?`))return;
  if(value==="reject"&&!window.confirm(`Reject ${order.orderId}? This order cannot be reopened.`))return;
  const source=base;setBusy(true);setError("");setNotice("");try{const {csrfToken}=await api<{csrfToken:string}>("/api/auth/csrf");if(context.current!==source)return;await api(`${base}/${order.orderId}/${value}`,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify({idempotencyKey:`${value}-${order.orderId}`})});if(context.current!==source)return;setNotice(`${order.orderId} ${value==="settle"?"settled":"rejected"}.`);await load();}catch(e){if(context.current===source)setError(e instanceof Error?e.message:"Order action failed.");}finally{if(context.current===source)setBusy(false);}
 }
 if(!read)return null;
 return <section className="wc-panel"><h2>Payment review</h2><p className="wc-detail">{admin?"Review transfers against your statement. Settling confirms an order and applies its membership and referral credit.":"Read-only order overview. Payment proofs and settlement actions stay with settlement staff."}</p>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}<button disabled={busy} onClick={()=>void load()}>{busy?"Loading…":"Refresh orders"}</button>{!busy&&!orders.length&&<p>No commerce orders in this guild.</p>}<div className="ei-commerce-orders">{orders.map(o=><article className="ei-commerce-order" key={o.orderId}><header><h3>{o.orderId}</h3><span>{o.status}</span></header><p>{o.serviceName} · {(Number(o.amountMinor)/100).toFixed(2)} {o.method==="upi"?"INR":"USDT"}</p><dl>{o.buyerId!==undefined&&<><dt>Buyer Discord ID</dt><dd>{o.buyerId}</dd></>}{o.proofRef!==undefined&&<><dt>Payment proof</dt><dd>{o.proofRef??"No proof submitted"}</dd></>}<dt>Created</dt><dd>{new Date(o.createdAt).toLocaleString()}</dd></dl><footer>{admin&&o.status==="claimed"&&<button disabled={busy} onClick={()=>void action(o,"settle")}>Settle verified transfer</button>}{admin&&["pending","claimed"].includes(o.status)&&<button disabled={busy} onClick={()=>void action(o,"reject")}>Reject order</button>}</footer></article>)}</div></section>;
}

