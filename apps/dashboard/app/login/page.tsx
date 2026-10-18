"use client";
// Sign in (redesign brief §Artwork): the approved hero composition carries the
// login — Kafka artwork beside a clean sign-in panel; stacks on mobile.
import Link from "next/link";
import { KafkaScene } from "../../components/kafka-scene";
import { BrandMark } from "../../components/brand-mark";
import "../kafka.css";
import "../../components/staff/staff.css";

export default function LoginPage() {
  return (
    <div className="sf-app sf-login">
      <main className="sf-login-main">
        <Link href="/" className="sf-wordmark sf-login-mark">
          <BrandMark />
          Ei point
        </Link>
        <section className="sf-hero" aria-label="Sign in">
          <div className="sf-hero-copy">
            <p className="sf-eyebrow">Welcome to Ei point</p>
            <h1>Take your place.</h1>
            <p>Sign in to manage your servers and see how your bots are doing.</p>
            <div className="sf-head-actions">
              <a className="sf-primary" href="/api/auth/login">
                Continue with Discord ↗
              </a>
            </div>
            <small className="sf-dim">
              Access is limited to approved servers and authorized staff.
            </small>
            <Link href="/" style={{ color: "var(--sf-dim)" }}>
              Back to the community website
            </Link>
          </div>
          <div className="sf-hero-art">
            <KafkaScene />
          </div>
        </section>
      </main>
    </div>
  );
}
