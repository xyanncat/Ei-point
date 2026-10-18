"use client";
import type { ReactNode } from "react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { PublicNav } from "./public-nav";
export function SiteFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  // The staff workspace, the login composition and dev previews carry their
  // own chrome.
  const bare = path.startsWith("/dashboard") || path === "/login" || path.startsWith("/dev");
  const [paused, setPaused] = useState(false);
  return (
    <div
      className={`${bare ? "ei-dashboard-frame" : "ei-public"}${paused ? " ei-motion-paused" : ""}`}
    >
      {!bare && (
        <>
          <div className="ei-atmosphere" aria-hidden="true">
            <svg viewBox="0 0 1400 900" preserveAspectRatio="none">
              <path d="M-100 800Q300-250 1500 300M-100 300Q600 1200 1500 50M-100 500Q700-300 1500 700" />
            </svg>
            {Array.from({ length: 8 }, (_, i) => (
              <span
                key={i}
                style={{
                  left: `${i * 13 + 3}%`,
                  animationDelay: `-${i * 2.7}s`,
                }}
              />
            ))}
          </div>
          <PublicNav />
        </>
      )}
      <main id="main">{children}</main>
      {!bare && (
        <footer className="ei-site-footer">
          <a href="/">Ei point</a>
          <p>Stay connected. Keep your community close.</p>
          <button onClick={() => setPaused(!paused)} aria-pressed={paused}>
            {paused ? "Resume ambient motion" : "Pause ambient motion"}
          </button>
          <a href="/dashboard">Staff workspace</a>
        </footer>
      )}
    </div>
  );
}
