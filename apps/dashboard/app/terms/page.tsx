import Link from "next/link";
import { Reveal, Stagger, StaggerItem } from "../../components/motion";

const SECTIONS = [
  {
    id: "scope",
    title: "Scope of service",
    body: [
      "Ei point provides account management for supported games: quest progression, exploration, story completion and related in-game support, delivered in 30-day terms.",
      "Each service page states what is included, the estimated duration and the price. Where an itemised list is not given, the description on that page is the full scope.",
      "We do not sell accounts, items, currency or any in-game asset. We do not sell anything that can be transferred between accounts.",
    ],
  },
  {
    id: "orders",
    title: "Orders and payment",
    body: [
      "An order starts when you pay and submit your payment proof. Payment is accepted by UPI, Razorpay or USDT.",
      "The amount shown at checkout is the amount charged. If a price changes between reading a service page and starting checkout, the checkout price is the one that applies.",
      "We never ask for your card number, CVV, net banking password or UPI PIN. We never ask you to share a one-time password with anyone, including us.",
    ],
  },
  {
    id: "verification",
    title: "Verification and refunds",
    body: [
      "Every order is checked by a person before any work starts. An order stays pending until the transfer is confirmed.",
      "If the work cannot start, for any reason on our side, the amount is returned in full. Tell staff on your game server and the order is settled as refunded.",
      "If you have already received part of the service and then ask for a refund, the proportion of the term already delivered may be deducted.",
      "A service that has been started and completed is not refundable, because the work has been done.",
    ],
  },
  {
    id: "delivery",
    title: "Delivery",
    body: [
      "Estimated durations on service pages are estimates, not guarantees. They assume the account is handed over in a workable state.",
      "Work is carried out on the account you provide. If the account cannot be accessed, or is in a state that makes the service impossible, the order is paused and you are told.",
      "You keep your account throughout. We do not keep a copy of your login details once the work is finished.",
    ],
  },
  {
    id: "responsibilities",
    title: "Your responsibilities",
    body: [
      "You must own the account, or have the owner's permission to have it worked on.",
      "You must not ask for anything outside the scope of the service you bought. Requests to break game rules, exploit mechanics or harm other players are refused, and the order is stopped.",
      "Do not log in during active work if a service requires exclusive access. Doing so can corrupt the order and puts your progress at risk.",
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: [
      "No attempt to reverse engineer, probe or interfere with the site, its APIs or its bots.",
      "No attempt to access, read or modify another person's account, order or server through this site.",
      "No resale of Ei point services without written agreement.",
    ],
  },
  {
    id: "no-guarantee",
    title: "Game outcomes",
    body: [
      "We deliver the service as described. We do not guarantee a particular in-game result, a ranking, a reward roll or a future event outcome, because the game decides those.",
      "Where a service states a target, that target describes the intended scope of the work, not a promise about server-side behaviour outside our control.",
    ],
  },
  {
    id: "liability",
    title: "Liability",
    body: [
      "Our liability for any order is limited to the amount you paid for that order.",
      "We are not liable for losses that come from a game ban, a rollback, a publisher policy change or an action of a third party, provided the service itself was carried out as described.",
      "We are not liable for indirect or consequential loss, including lost progress caused by third-party action.",
    ],
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: [
      "These terms may change as the service changes. The version that applies to an order is the one published when that order was placed.",
      "Continued use of the site after a change means you accept the new terms.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    body: [
      "Reach us on your game server, where staff can see your order directly. That is the fastest route to a real answer.",
      "The site, the docs and the terms are maintained by the same people who run the orders.",
    ],
  },
];

export default function TermsPage() {
  return (
    <section className="world-section world-shell" aria-label="Terms of service">
      <Reveal>
        <p className="world-eyebrow">Legal</p>
        <h1 className="world-title">Terms of service</h1>
        <p className="world-lede">
          The rules the operation runs on. Plain language, because a customer
          should be able to read this without a lawyer and still know where
          they stand.
        </p>
      </Reveal>

      <Stagger className="world-stack" amount={0.04}>
        {SECTIONS.map((section) => (
          <StaggerItem key={section.id}>
            <article className="glass world-card prose" id={section.id}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </article>
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal>
        <p className="world-note" style={{ marginTop: "1.6rem" }}>
          See also the{" "}
          <Link href="/policy">privacy and policy</Link> and the{" "}
          <Link href="/docs">docs</Link>.
        </p>
      </Reveal>
    </section>
  );
}
