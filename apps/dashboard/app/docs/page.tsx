import Link from "next/link";
import { KineticTitle, Reveal, Stagger, StaggerItem } from "../../components/motion";

const GAMES = [
  {
    name: "Genshin Impact",
    detail: "Regions, character story quests, exploration and account management.",
  },
  {
    name: "Honkai: Star Rail",
    detail: "Trail progress, character stories, simulations and account management.",
  },
  {
    name: "Wuthering Waves",
    detail: "Region exploration, character stories and account management.",
  },
  {
    name: "Neverness to Everness",
    detail: "Story progression and account management.",
  },
  {
    name: "Arknights: Endfield",
    detail: "Campaign progression, exploration and account management.",
  },
];

const SECTIONS = [
  {
    id: "start",
    title: "Getting started",
    body: "Choose the service your account needs, sign in with Discord, and pay. The whole thing happens on this site, and it takes a couple of minutes.",
    points: [
      "Open the service page and read what is included and how long it takes.",
      "Press the order button. Checkout shows the authoritative amount and a payment QR code.",
      "Pay by UPI, Razorpay or USDT, then submit your payment proof in the checkout session.",
      "Staff verify the transfer. The order moves to under review, then to settled when the work is done.",
    ],
  },
  {
    id: "verify",
    title: "Verifying an order",
    body: "Every order carries a verification link with a token in it. You can check the state of an order at any time, without signing in.",
    points: [
      "The link looks like /verify?token=... — the token is the text after ?token=.",
      "You can also paste the RP order ID from your checkout receipt into the verification page.",
      "A verification shows status, amount and service name. It never shows payment details.",
      "Verification is read only. Payment proof is submitted from the checkout session that created the order.",
    ],
  },
  {
    id: "account",
    title: "Your account",
    body: "Your account area has three tabs. The middle one only exists for the operator and the master.",
    points: [
      "Servers: the servers you invited bots to, with the setup for every bot inside them.",
      "Purchase logs: every order you have placed, newest first, each with its verification link.",
      "Services: the operator's view of the catalogue. You can change prices, wording and what is on offer.",
    ],
  },
  {
    id: "membership",
    title: "Membership and referrals",
    body: "A membership term is 30 days of account management that covers every supported game, starting at ₹700.",
    points: [
      "One term, one price, every game on the supported list.",
      "Referral rewards are credited for the calendar month the referral joined in.",
      "Rewards expire at the month boundary, so claim them before the month ends.",
    ],
  },
];

export default function DocsPage() {
  return (
    <>
      <section className="world-section world-shell" aria-label="Documentation">
        <div className="world-page">
          <Reveal>
            <p className="world-eyebrow">Docs</p>
            <KineticTitle as="h1" text="Everything you need, in order." />
            <p className="world-lede">
              How to order, how to verify, what your account shows and what
              the terms are. If something is missing, ask staff on your game
              server.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="world-row">
              <a className="world-button world-button--primary" href="#start">
                Start here
              </a>
              <Link className="world-button world-button--ghost" href="/services">
                Browse services
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="world-section world-section--tight world-shell">
        <Stagger className="world-stack" amount={0.05}>
          {SECTIONS.map((section) => (
            <StaggerItem key={section.id}>
              <article className="glass world-card" id={section.id}>
                <span className="world-card__tag">Section</span>
                <h3>{section.title}</h3>
                <p>{section.body}</p>
                <ul>
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="world-section world-shell" aria-label="Supported games">
        <Reveal>
          <p className="world-eyebrow">Coverage</p>
          <h2 className="world-title world-title--sm">Supported games</h2>
        </Reveal>
        <Stagger className="world-grid" amount={0.05}>
          {GAMES.map((game) => (
            <StaggerItem key={game.name}>
              <div className="glass world-card">
                <h3>{game.name}</h3>
                <p>{game.detail}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="world-section world-section--tight world-shell">
        <Reveal>
          <div className="glass world-card">
            <h3>Still stuck</h3>
            <p>
              Check the{" "}
              <Link href="/terms">terms of service</Link> and the{" "}
              <Link href="/policy">privacy policy</Link>, then ask staff on
              your game server. They can see the order and the server directly.
            </p>
          </div>
        </Reveal>
      </section>
    </>
  );
}
