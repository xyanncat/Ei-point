"use client";
import { useRef, useState, useEffect, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, ApiError, type AccountResponse } from "../lib/api";
type Method = "upi" | "usdt" | "razorpay";
type Options = {enabled:boolean;methods:{upi:boolean;usdt:boolean;razorpay:boolean}};
type Order = {orderId:string;token:string;amountMinor:number;currency:string;paymentMethod:Method;paymentUri?:string;destination?:string;network?:string;expiresAt:string;referralApplied:boolean;status?:string};
type ResumedOrder = Order & {resumed:true};
const REFERRAL_KEY="royal-referral-code";
function referral(){try {const value=new URLSearchParams(location.search).get("ref")?.trim().toUpperCase();if(value&&/^[A-Z0-9-]{6,24}$/.test(value)){localStorage.setItem(REFERRAL_KEY,value);return value;}return localStorage.getItem(REFERRAL_KEY)??"";}catch{return "";}}
export function CheckoutButton({serviceId,name}:{serviceId:string;name:string}){
 const dialog=useRef<HTMLDialogElement>(null),secret=useRef(""),attempt=useRef(""),csrf=useRef(""),alive=useRef(true);
 const [options,setOptions]=useState<Options|null>(null),[account,setAccount]=useState<AccountResponse["user"]|null>(null),[signedOut,setSignedOut]=useState(false),[back,setBack]=useState("/dashboard"),[method,setMethod]=useState<Method>("upi"),[ref,setRef]=useState(""),[order,setOrder]=useState<Order|null>(null),[qr,setQr]=useState(""),[proof,setProof]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[claimed,setClaimed]=useState(false),[status,setStatus]=useState("");
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function csrfToken(){if(!csrf.current){const r=await api<{csrfToken:string}>("/api/auth/csrf");csrf.current=r.csrfToken;}return csrf.current;}
 async function open(){dialog.current?.showModal();setError("");setRef(referral());if(order)return;setBusy(true);try {
  // Checkout is bound to a signed-in Discord identity: the OAuth session picks
  // the buyer, so the dialog first confirms who is ordering and links to
  // sign-in instead of trusting a typed user ID.
  const me=await api<AccountResponse>("/api/auth/me").catch((e)=>{if(e instanceof ApiError&&e.status===401)return null;throw e;});
  if(!alive.current)return;
  if(!me){setSignedOut(true);setOptions(null);setBack(location.pathname+location.search);return;}
  setSignedOut(false);setAccount(me.user);
  // A reload or lost creation response resumes the same order through the
  // HttpOnly recovery cookie. Resume failures surface an error instead of
  // silently falling through: creating a second order for an unknown first
  // outcome is never the default.
  const previous=await api<ResumedOrder|{resumed:false}>(`/api/payments/resume?serviceId=${encodeURIComponent(serviceId)}`).catch(error=>{if(alive.current)setError(error instanceof Error?error.message:"Could not check for an existing checkout. Retry in a moment.");return null;});
  if(previous===null)return;
  if("resumed" in previous&&previous.resumed){setOrder(previous);setStatus(previous.status==="confirmed"?"confirmed":previous.status??"pending");if(previous.paymentUri)setQr(await QRCode.toDataURL(previous.paymentUri,{width:256,margin:2,color:{dark:"#251322",light:"#ffffff"}}));return;}
  const o=await api<Options>("/api/payments/options");if(alive.current){setOptions(o);setMethod(o.methods.upi?"upi":"usdt");}}catch(e){if(alive.current)setError(e instanceof Error?e.message:"Payment options are unavailable.");}finally{if(alive.current)setBusy(false);}}
 async function checkout(e:FormEvent){e.preventDefault();setError("");setBusy(true);attempt.current ||= crypto.randomUUID();secret.current ||= btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");try {
  const o=await api<Order>("/api/payments/upi-qr",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":await csrfToken()},body:JSON.stringify({serviceId,paymentMethod:method,idempotencyKey:attempt.current,recoveryToken:secret.current,...(ref?{referralCode:ref.trim().toUpperCase()}:{})})});
  if(!/^RP-[A-Z0-9]{6}$/.test(o.orderId)||!o.token)throw Error("The payment service returned an incomplete order.");
  if(!o.paymentUri)throw Error("The payment service returned an incomplete order.");
  setOrder(o);setStatus("pending");setQr(await QRCode.toDataURL(o.paymentUri,{width:256,margin:2,color:{dark:"#251322",light:"#ffffff"}}));
  if(o.referralApplied){try{localStorage.removeItem(REFERRAL_KEY);}catch{}}
 }catch(e){setError(e instanceof Error?e.message:"Could not create checkout.");}finally{setBusy(false);}}
 async function claim(e:FormEvent){e.preventDefault();if(!order)return;setBusy(true);setError("");try{await api("/api/payments/claim",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":await csrfToken()},body:JSON.stringify({orderId:order.orderId,token:order.token,idempotencyKey:`claim-${order.orderId}`,...(order.paymentMethod==="upi"?{utr:proof}:order.paymentMethod==="razorpay"?{reference:proof}:{txid:proof})})});setClaimed(true);setStatus("claimed");}catch(e){setError(e instanceof Error?e.message:"Could not submit payment proof.");}finally{setBusy(false);}}
 async function refresh(){if(!order)return;setBusy(true);setError("");try{const o=await api<{status:string}>(`/api/payments/status/${order.orderId}`);setStatus(o.status);}catch(e){setError(e instanceof Error?e.message:"Could not check order status.");}finally{setBusy(false);}}
 return <><button className="ei-action ei-checkout-open" type="button" onClick={()=>void open()}>Checkout <span aria-hidden="true">↗</span></button>
 <dialog className="ei-checkout" ref={dialog} onClick={e=>{if(e.target===dialog.current)dialog.current.close();}} aria-labelledby={`checkout-${serviceId}`}>
  <div className="ei-checkout-card"><button className="ei-checkout-close" type="button" aria-label="Close checkout" onClick={()=>dialog.current?.close()}>×</button><p className="ei-checkout-eyebrow">Ei point · Secure checkout</p><h2 id={`checkout-${serviceId}`}>{name}</h2>
  {error&&<p className="ei-checkout-error" role="alert">{error}</p>}
  {!order?<>{busy&&!options&&!signedOut&&<p role="status">Loading payment options…</p>}{signedOut?<div className="ei-checkout-signin"><p>Sign in with Discord to order. Checkout is tied to your Discord account, and staff verify payments against it.</p><a className="ei-action" href={`/api/auth/login?returnTo=${encodeURIComponent(back)}`}>Sign in with Discord <span aria-hidden="true">↗</span></a></div>:options&&!options.enabled?<p role="status">Payments are not configured for this deployment. Contact your server staff for availability.</p>:options&&<form onSubmit={checkout} className="ei-checkout-form">
   <p>Ordering as <strong>{account?.name}</strong>. The server confirms your current price before showing payment instructions.</p>
   <label>Payment method<select value={method} onChange={e=>{setMethod(e.target.value as Method);attempt.current="";secret.current="";}}>{options.methods.upi&&<option value="upi">UPI · INR</option>}{options.methods.razorpay&&<option value="razorpay">Razorpay · Card / UPI / Wallet</option>}{options.methods.usdt&&<option value="usdt">USDT · TRC-20</option>}</select></label>
   <label>Referral code <small>(optional)</small><input value={ref} onChange={e=>{setRef(e.target.value.toUpperCase());attempt.current="";secret.current="";}} maxLength={24} autoComplete="off"/></label>
   <button className="ei-action" disabled={busy} type="submit">{busy?"Creating your order…":"Show payment instructions"}</button>
  </form>}</>:<div className="ei-checkout-order">
   {qr&&<img className="ei-checkout-qr" src={qr} width={256} height={256} alt={`Payment QR code for order ${order.orderId}`}/>}
   <strong className="ei-checkout-amount">{order.currency==="INR"?"₹":""}{(order.amountMinor/100).toFixed(2)} {order.currency==="USDT"?"USDT":""}</strong>
   <dl><div><dt>Order</dt><dd>{order.orderId}</dd></div>{order.destination&&<div><dt>{order.paymentMethod==="upi"?"UPI ID":order.paymentMethod==="razorpay"?"Payment page":"Wallet"}</dt><dd>{order.destination}</dd></div>}{order.network&&<div><dt>Network</dt><dd>{order.network}</dd></div>}<div><dt>Expires</dt><dd>{new Date(order.expiresAt).toLocaleString()}</dd></div><div><dt>Status</dt><dd>{status}</dd></div></dl>
   {order.paymentMethod==="razorpay"?<div className="ei-checkout-razorpay"><p>Pay the exact amount on the Razorpay page — scan the QR or open the link — with card, UPI or wallet. Then submit the Razorpay payment ID (or the UTR from your receipt) so staff can match and verify it.</p><a className="ei-action" href={order.paymentUri} target="_blank" rel="noreferrer">Open Razorpay page ↗</a></div>:order.paymentMethod==="upi"&&order.paymentUri?.startsWith("upi://pay?")?<a className="ei-action" href={order.paymentUri}>Open UPI app ↗</a>:<p>Send the exact amount using TRC-20 only. Check the wallet and network before paying.</p>}
   {order.referralApplied&&<p>Your referral is recorded. Credit applies after staff settlement.</p>}
   {!claimed&&status==="pending"?<form className="ei-checkout-form" onSubmit={claim}><label>{order.paymentMethod==="upi"?"12-digit UPI transaction ID (UTR)":order.paymentMethod==="razorpay"?"Razorpay payment ID or UTR":"64-character TRON transaction hash"}<input required autoComplete="off" spellCheck={false} inputMode={order.paymentMethod==="upi"?"numeric":"text"} pattern={order.paymentMethod==="upi"?"[0-9]{12}":order.paymentMethod==="razorpay"?"[A-Za-z0-9_-]{6,64}":"[a-fA-F0-9]{64}"} maxLength={order.paymentMethod==="upi"?12:64} value={proof} onChange={e=>setProof(e.target.value.trim())}/></label><p>Submitting proof requests manual staff review. A payment is confirmed after staff match your transfer.</p><button className="ei-action" disabled={busy} type="submit">{busy?"Submitting…":"I’ve paid · submit proof"}</button></form>:<p role="status">{status==="confirmed"?"Payment received and verified.":status==="claimed"?"Proof received. Awaiting manual staff verification. Automated staff notifications are not configured.":`Order status: ${status}.`}</p>}
   <div className="ei-checkout-follow"><button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh status</button><a href={`/verify?id=${encodeURIComponent(order.orderId)}`}>Open verification page ↗</a>{["expired","rejected"].includes(status)&&<button type="button" onClick={()=>{setOrder(null);setQr("");setProof("");setClaimed(false);setStatus("");attempt.current="";secret.current="";}}>Create a fresh checkout</button>}</div>
  </div>}
  <p className="ei-checkout-security">QR generated on your device. Keep this checkout open until you submit proof.</p></div>
 </dialog></>;
}
