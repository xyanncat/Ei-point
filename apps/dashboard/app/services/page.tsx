import Link from "next/link";
import { ServiceCatalog } from "../../components/service-catalog";
import { Reveal, Stagger, StaggerItem } from "../../components/motion";

const STEPS = [
  {
    title: "Choose a service",
    body: "Open a service for its inclusions, timing and the exact price before committing to anything.",
  },
  {
    title: "Pay your way",
    body: "Sign in with Discord, then pay by UPI, Razorpay or USDT. Checkout shows the authoritative amount and a QR code.",
  },
  {
    title: "Verified by a person",
    body: "Submit your payment proof once. Staff check it, and the work starts when they confirm it.",
  },
];

export default function ServicesPage() {
  return (
    <>
      <section className="world-section world-shell" aria-label="Game services">
        <div className="world-page">
          <Reveal>
            <p className="world-eyebrow">The catalogue</p>
            <h1 className="world-title">
              Make your
              <br />
              next move.
            </h1>
            <p className="world-lede">
              Quest progression, exploration and account management across
              five games. Pick a game, find the support your account needs,
              and see the exact price before you pay anything.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <p>
              <Link className="ei-action" href="#catalog">
                Browse all services
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      <section className="world-section world-section--tight world-shell" id="catalog">
        <ServiceCatalog />
      </section>

      <section className="world-section world-shell" aria-label="How ordering works">
        <Reveal>
          <p className="world-eyebrow">The order</p>
          <h2 className="world-title world-title--sm">Three steps</h2>
        </Reveal>
        <Stagger className="world-grid">
          {STEPS.map((step, index) => (
            <StaggerItem key={step.title}>
              <article className="glass world-card">
                <span className="world-card__tag">Step {index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            </StaggerItem>
          ))}
        </Stagger>
        <Reveal>
          <p className="world-note" style={{ marginTop: "1.4rem" }}>
            Payment steps, verification, timing and the supported games are
            explained in the <Link href="/docs">docs</Link>.
          </p>
        </Reveal>
      </section>
    </>
  );
}
