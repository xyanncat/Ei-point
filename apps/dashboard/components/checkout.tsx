"use client";
import { useRef, useState, useEffect, type FormEvent } from "react";
import QRCode from "qrcode";
import { api } from "../lib/api";
type Method = "upi" | "usdt";
type Options = {enabled:boolean;methods:{upi:boolean;usdt:boolean}};
type Order = {orderId:string;token:string;amountMinor:number;currency:string;paymentMethod:Method;paymentUri:string;destination:string;network?:string;expiresAt:string;referralApplied:boolean};
const REFERRAL_KEY="royal-referral-code";
function referral(){try {const value=new URLSearchParams(location.search).get("ref")?.trim().toUpperCase();if(value&&/^[A-Z0-9-]{6,24}$/.test(value)){localStorage.setItem(REFERRAL_KEY,value);return value;}return localStorage.getItem(REFERRAL_KEY)??"";}catch{return "";}}
export function CheckoutButton({serviceId,name}:{serviceId:string;name:string}){
 const dialog=useRef<HTMLDialogElement>(null),secret=useRef(""),attempt=useRef(""),alive=useRef(true);
 const [options,setOptions]=useState<Options|null>(null),[buyer,setBuyer]=useState(""),[method,setMethod]=useState<Method>("upi"),[ref,setRef]=useState(""),[order,setOrder]=useState<Order|null>(null),[qr,setQr]=useState(""),[proof,setProof]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[claimed,setClaimed]=useState(false),[status,setStatus]=useState("");
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function open(){dialog.current?.showModal();setError("");setRef(referral());if(order)return;setBusy(true);try {const o=await api<Options>("/api/payments/options");if(alive.current){setOptions(o);setMethod(o.methods.upi?"upi":"usdt");}}catch(e){if(alive.current)setError(e instanceof Error?e.message:"Payment options are unavailable.");}finally{if(alive.current)setBusy(false);}}
 async function checkout(e:FormEvent){e.preventDefault();setError("");setBusy(true);attempt.current ||= crypto.randomUUID();secret.current ||= btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");try {
  const o=await api<Order>("/api/payments/upi-qr",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({serviceId,discordId:buyer,paymentMethod:method,idempotencyKey:attempt.current,recoveryToken:secret.current,...(ref?{referralCode:ref.trim().toUpperCase()}:{})})});
  if(!/^RP-[A-Z0-9]{6}$/.test(o.orderId)||!o.token||!o.paymentUri)throw Error("The payment service returned an incomplete order.");
  setOrder(o);setStatus("pending");setQr(await QRCode.toDataURL(o.paymentUri,{width:256,margin:2,color:{dark:"#251322",light:"#ffffff"}}));
  if(o.referralApplied){try{localStorage.removeItem(REFERRAL_KEY);}catch{}}
 }catch(e){setError(e instanceof Error?e.message:"Could not create checkout.");}finally{setBusy(false);}}
 async function claim(e:FormEvent){e.preventDefault();if(!order)return;setBusy(true);setError("");try{await api("/api/payments/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({orderId:order.orderId,token:order.token,idempotencyKey:`claim-${order.orderId}`,...(order.paymentMethod==="upi"?{utr:proof}:{txid:proof})})});setClaimed(true);setStatus("claimed");}catch(e){setError(e instanceof Error?e.message:"Could not submit payment proof.");}finally{setBusy(false);}}
 async function refresh(){if(!order)return;setBusy(true);setError("");try{const o=await api<{status:string}>(`/api/payments/status/${order.orderId}`);setStatus(o.status);}catch(e){setError(e instanceof Error?e.message:"Could not check order status.");}finally{setBusy(false);}}
 return <><button className="ei-action ei-checkout-open" type="button" onClick={()=>void open()}>Checkout <span aria-hidden="true">↗</span></button>
 <dialog className="ei-checkout" ref={dialog} onClick={e=>{if(e.target===dialog.current)dialog.current.close();}} aria-labelledby={`checkout-${serviceId}`}>
  <div className="ei-checkout-card"><button className="ei-checkout-close" type="button" aria-label="Close checkout" onClick={()=>dialog.current?.close()}>×</button><p className="ei-checkout-eyebrow">Ei point · Secure checkout</p><h2 id={`checkout-${serviceId}`}>{name}</h2>
  {error&&<p className="ei-checkout-error" role="alert">{error}</p>}
  {!order?<>{busy&&!options&&<p role="status">Loading payment options…</p>}{options&&!options.enabled?<p role="status">Payments are not configured for this deployment. Contact your server staff for availability.</p>:options&&<form onSubmit={checkout} className="ei-checkout-form">
   <p>The server confirms your current price before showing payment instructions.</p><label>Discord user ID<input required inputMode="numeric" pattern="[0-9]{17,20}" maxLength={20} autoComplete="off" value={buyer} onChange={e=>{setBuyer(e.target.value);attempt.current="";secret.current="";}} placeholder="Your 17–20 digit user ID"/></label>
   <label>Payment method<select value={method} onChange={e=>{setMethod(e.target.value as Method);attempt.current="";secret.current="";}}>{options.methods.upi&&<option value="upi">UPI · INR</option>}{options.methods.usdt&&<option value="usdt">USDT · TRC-20</option>}</select></label>
   <label>Referral code <small>(optional)</small><input value={ref} onChange={e=>{setRef(e.target.value.toUpperCase());attempt.current="";secret.current="";}} maxLength={24} autoComplete="off"/></label>
   <button className="ei-action" disabled={busy} type="submit">{busy?"Creating your order…":"Show payment instructions"}</button>
  </form>}</>:<div className="ei-checkout-order">
   {qr&&<img className="ei-checkout-qr" src={qr} width={256} height={256} alt={`Payment QR code for order ${order.orderId}`}/>}
   <strong className="ei-checkout-amount">{order.currency==="INR"?"₹":""}{(order.amountMinor/100).toFixed(2)} {order.currency==="USDT"?"USDT":""}</strong>
   <dl><div><dt>Order</dt><dd>{order.orderId}</dd></div><div><dt>{order.paymentMethod==="upi"?"UPI ID":"Wallet"}</dt><dd>{order.destination}</dd></div>{order.network&&<div><dt>Network</dt><dd>{order.network}</dd></div>}<div><dt>Expires</dt><dd>{new Date(order.expiresAt).toLocaleString()}</dd></div><div><dt>Status</dt><dd>{status}</dd></div></dl>
   {order.paymentMethod==="upi"&&order.paymentUri.startsWith("upi://pay?")?<a className="ei-action" href={order.paymentUri}>Open UPI app ↗</a>:<p>Send the exact amount using TRC-20 only. Check the wallet and network before paying.</p>}
   {order.referralApplied&&<p>Your referral is recorded. Credit applies after staff settlement.</p>}
   {!claimed&&status==="pending"?<form className="ei-checkout-form" onSubmit={claim}><label>{order.paymentMethod==="upi"?"12-digit UPI transaction ID (UTR)":"64-character TRON transaction hash"}<input required autoComplete="off" spellCheck={false} inputMode={order.paymentMethod==="upi"?"numeric":"text"} pattern={order.paymentMethod==="upi"?"[0-9]{12}":"[a-fA-F0-9]{64}"} maxLength={order.paymentMethod==="upi"?12:64} value={proof} onChange={e=>setProof(e.target.value.trim())}/></label><p>Submitting proof requests manual staff review. A payment is confirmed after staff match your transfer.</p><button className="ei-action" disabled={busy} type="submit">{busy?"Submitting…":"I’ve paid · submit proof"}</button></form>:<p role="status">{status==="claimed"?"Proof received. Awaiting manual staff verification. Automated staff notifications are not configured.":`Order status: ${status}.`}</p>}
   <div className="ei-checkout-follow"><button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh status</button><a href={`/verify?id=${encodeURIComponent(order.orderId)}`}>Open verification page ↗</a>{["expired","rejected"].includes(status)&&<button type="button" onClick={()=>{setOrder(null);setQr("");setProof("");setClaimed(false);setStatus("");attempt.current="";secret.current="";}}>Create a fresh checkout</button>}</div>
  </div>}
  <p className="ei-checkout-security">QR generated on your device. Keep this checkout open until you submit proof.</p></div>
 </dialog></>;
}
