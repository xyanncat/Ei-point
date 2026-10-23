import Link from "next/link";
import { ReferralCapture } from "../../components/referral-capture";
import { Reveal } from "../../components/motion";

export default function ReferralsPage() {
  return (
    <section className="world-section world-shell" aria-label="Referrals">
      <div className="world-page">
          <Reveal>
            <p className="world-eyebrow">Referrals</p>
            <h1 className="world-title">
              Follow
              <br />
              the thread.
            </h1>
            <p className="world-lede">
              Every member gets a referral link. Invite friends through yours
              and earn a reward for that calendar month.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <ol className="ei-step-list">
              <li>
                <h2>Share your link</h2>
                <p>
                  Ask staff on your game server for your personal link. Joins
                  attach to the current month.
                </p>
              </li>
              <li>
                <h2>Let your circle grow</h2>
                <p>
                  Eligible rewards are reserved for that cycle, then paid out
                  by staff.
                </p>
              </li>
              <li>
                <h2>Start a fresh chapter</h2>
                <p>
                  Unpaid rewards expire at the month boundary. Nothing carries
                  over silently.
                </p>
              </li>
            </ol>
          </Reveal>

          <Reveal delay={0.14}>
            <div className="glass world-card" style={{ marginTop: "1.2rem" }}>
              <h3>Need your link?</h3>
              <p>
                Referral links are issued on the game servers. Ask a staff
                member to help you get started.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <div style={{ marginTop: "1.2rem" }}>
              <ReferralCapture />
            </div>
            <p className="world-note" style={{ marginTop: "1rem" }}>
              How rewards are credited is explained in the{" "}
              <Link href="/docs">docs</Link>.
            </p>
          </Reveal>
      </div>
    </section>
  );
}
