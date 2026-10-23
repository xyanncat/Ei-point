import Link from "next/link";
import { CheckoutButton } from "../../components/checkout";
import { Reveal } from "../../components/motion";

export default function MembershipPage() {
  return (
    <section className="world-section world-shell" aria-label="Membership">
      <div className="world-page">
          <Reveal>
            <p className="world-eyebrow">Membership</p>
            <h1 className="world-title">
              A little closer.
              <br />
              Every month.
            </h1>
            <p className="world-lede">
              One 30-day membership covers account management for Genshin
              Impact, Honkai: Star Rail, Wuthering Waves, Neverness to Everness
              and Arknights: Endfield. Dailies and new events stay on schedule
              across every game.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="glass world-card" style={{ marginTop: "1.4rem" }}>
              <span className="world-card__tag">Membership includes</span>
              <ul>
                <li>30 days of account management</li>
                <li>Dailies and new events</li>
                <li>Farming and domain farming</li>
              </ul>
              <p className="world-note">
                Starting at ₹700 for 30 days. Checkout shows current pricing and
                the available payment methods.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.14}>
            <div className="glass world-card" style={{ marginTop: "1rem" }}>
              <span className="world-card__tag">Good to know</span>
              <ul>
                <li>
                  A membership runs 30 days per order. Reorder any time before
                  it lapses.
                </li>
                <li>
                  Open to the five supported games. Ordering needs a Discord
                  sign-in.
                </li>
                <li>
                  Settlement is manual. Staff verify your transfer before the
                  term starts.
                </li>
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <div style={{ marginTop: "1.6rem" }}>
              <CheckoutButton
                serviceId="account-management-membership"
                name="30-day account management membership"
              />
            </div>
            <p className="world-note">
              <Link href="/verify">Verify a membership order ↗</Link> ·{" "}
              <Link href="/docs">Membership questions are answered in the docs ↗</Link>
            </p>
          </Reveal>
      </div>
    </section>
  );
}
