"use client";
import {useEffect} from "react";
export function ReferralCapture(){useEffect(()=>{try{const p=new URLSearchParams(location.search);const code=(p.get("code")??p.get("ref")??"").trim().toUpperCase();if(/^[A-Z0-9-]{6,24}$/.test(code))localStorage.setItem("royal-referral-code",code);}catch{}},[]);return null;}
