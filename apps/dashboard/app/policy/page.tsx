import Link from "next/link";
import { Reveal, Stagger, StaggerItem } from "../../components/motion";

const COLLECTED = [
  {
    title: "Discord identity",
    body: "Your Discord user ID and display name, taken when you sign in. This is what ties an order and a server to you.",
  },
  {
    title: "Server membership",
    body: "The servers where an Ei point bot has been invited, and the role configuration for those servers. It is read to run the bots and to show you your own setup.",
  },
  {
    title: "Order records",
    body: "What you bought, the amount, the method, the status and the timestamps. Needed to verify an order and to settle a refund.",
  },
  {
    title: "Referral records",
    body: "Your referral code and the accounts that used it, with the reward credited for that month.",
  },
];

const NOT_COLLECTED = [
  "Card numbers, CVVs, UPI PINs or net banking passwords. We never ask for them and we never store them.",
  "Your game account password, kept beyond the end of the work it was needed for.",
  "Advertising identifiers, tracking pixels or third-party analytics profiles.",
];

const WHO_SEES = [
  {
    title: "You",
    body: "Your own orders, your own servers, your own referrals.",
  },
  {
    title: "The staff working your order",
    body: "The account, the server and the order details needed to do the work and to answer you.",
  },
  {
    title: "The master account",
    body: "Everything, across every server. It exists so a bot that has misbehaved can be fixed or removed. It is a single named individual, not a team feature.",
  },
];

export default function PolicyPage() {
  return (
    <section className="world-section world-shell" aria-label="Privacy and policy">
      <Reveal>
        <p className="world-eyebrow">Legal</p>
        <h1 className="world-title">Privacy and policy</h1>
        <p className="world-lede">
          What this site holds, why it holds it, and who can see it. The short
          version: a small amount of account and order data, kept for as long
          as it is useful, and visible to very few people.
        </p>
      </Reveal>

      <Stagger className="world-stack" amount={0.04}>
        <StaggerItem>
          <article className="glass world-card" id="collect">
            <span className="world-card__tag">What we collect</span>
            <h3>Four things, and nothing else</h3>
            <div className="world-grid" style={{ marginTop: "1rem" }}>
              {COLLECTED.map((item) => (
                <div className="world-card" key={item.title}>
                  <h4>{item.title}</h4>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </article>
        </StaggerItem>

        <StaggerItem>
          <article className="glass world-card" id="not-collected">
            <span className="world-card__tag">What we do not collect</span>
            <h3>The things that matter most</h3>
            <ul>
              {NOT_COLLECTED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </StaggerItem>

        <StaggerItem>
          <article className="glass world-card" id="visibility">
            <span className="world-card__tag">Who can see it</span>
            <h3>Three audiences, no more</h3>
            <div className="world-grid" style={{ marginTop: "1rem" }}>
              {WHO_SEES.map((item) => (
                <div className="world-card" key={item.title}>
                  <h4>{item.title}</h4>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </article>
        </StaggerItem>

        <StaggerItem>
          <article className="glass world-card prose" id="retention">
            <h2>How long we keep it</h2>
            <p>
              Order records are kept while the order is live and afterwards for
              as long as we may need to answer a question about it. Referral
              rewards expire at the end of the calendar month they were earned
              in.
            </p>
            <p>
              Server configuration is kept while a bot is installed in that
              server, and is deleted when the bot is removed or the server
              leaves the platform.
            </p>
          </article>
        </StaggerItem>

        <StaggerItem>
          <article className="glass world-card prose" id="cookies">
            <h2>Cookies and sessions</h2>
            <p>
              One cookie keeps you signed in. It contains a session reference
              and nothing else. It is set only when you sign in and it is
              cleared when you sign out.
            </p>
            <p>
              The site sets no advertising or analytics cookies. The soundtrack
              toggle is remembered in your browser's local storage so the site
              does not startle you on the next visit, and it never leaves your
              device.
            </p>
          </article>
        </StaggerItem>

        <StaggerItem>
          <article className="glass world-card prose" id="rights">
            <h2>Your rights</h2>
            <p>
              You can ask what we hold about you, ask for it to be corrected,
              or ask for it to be deleted. Ask staff on your game server and
              they will pass it to the person who can action it.
            </p>
            <p>
              We keep a record of settled orders even after an account is
              deleted, because a payment record has to outlive the account that
              made it. Everything else goes.
            </p>
          </article>
        </StaggerItem>

        <StaggerItem>
          <article className="glass world-card prose" id="community">
            <h2>Community policy</h2>
            <p>
              This is a small operation run for people who play. Keep it that
              way. No harassment of staff or of other customers, no attempts to
              manipulate the referral or reward systems, and no treating a
              support channel as a place to settle a score.
            </p>
            <p>
              Breaking these rules ends the relationship. Repeated misuse of a
              service, or of the support channels, gets the account closed
              without refund on the work in progress.
            </p>
          </article>
        </StaggerItem>
      </Stagger>

      <Reveal>
        <p className="world-note" style={{ marginTop: "1.6rem" }}>
          See also the <Link href="/terms">terms of service</Link> and the{" "}
          <Link href="/docs">docs</Link>.
        </p>
      </Reveal>
    </section>
  );
}
