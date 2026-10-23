import Link from "next/link";
import { Hero } from "../components/hero";
import { CountUp, KineticTitle, Reveal, Stagger, StaggerItem } from "../components/motion";
import assets from "../lib/project-assets.json";

type ArchiveService = {
  sku: string;
  game: string;
  category: string;
  name: string;
  description: string;
  duration: string;
  price_minor: number;
  currency: string;
};

const services = assets.services as unknown as ArchiveService[];
const FEATURED = services.slice(0, 6);
const GAMES = [...new Set(services.map((service) => service.game))];

function price(minor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

const STEPS = [
  {
    title: "Choose a service",
    body: "Open a service for its inclusions, timing and exact price before committing to anything.",
  },
  {
    title: "Pay your way",
    body: "Sign in with Discord, then pay by UPI, Razorpay or USDT. Checkout shows the authoritative amount and a QR code.",
  },
  {
    title: "Verified by a person",
    body: "Submit your payment proof once. Every order carries a verification link you can check any time.",
  },
];

/**
 * The page is the film. Each section is one of the film's beats and the copy
 * in it is written from that beat, so scrolling the home page walks the same
 * sequence the trailer plays.
 */
export default function HomePage() {
  return (
    <>
      <Hero />

      {/* Beat one — the call. */}
      <section className="scene" aria-label="The call">
        <div className="world-shell scene__inner">
          <Reveal>
            <p className="world-eyebrow">The call</p>
            <KineticTitle as="h2" text="A city that answers back" className="world-title" />
            <p className="world-lede">
              Five games, one account, one voice. Ei point keeps your progress
              moving while you are away. Quests, regions and accounts, all
              settled by a person who has actually played.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Beat two — one account. The catalogue. */}
      <section className="scene" aria-label="One account">
        <div className="world-shell scene__inner">
          <Reveal>
            <p className="world-eyebrow">One account</p>
            <KineticTitle as="h2" text="Every region, every plan" className="world-title" />
            <p className="world-lede">
              Pick the exact service you need: a single region, a full story
              arc, a thirty-day term, or the whole catalogue. You see the
              inclusions and the price before you pay a rupee.
            </p>
          </Reveal>
          <Stagger className="world-grid" amount={0.05}>
            {FEATURED.map((service) => (
              <StaggerItem key={service.sku}>
                <Link href={`/services/${service.sku}`} className="glass world-card">
                  <span className="world-card__tag">
                    {service.game} · {service.category}
                  </span>
                  <h3>{service.name}</h3>
                  <p>{service.description}</p>
                  <span className="world-card__meta">
                    <span>{service.duration}</span>
                    <span className="world-card__price">
                      {price(service.price_minor, service.currency)}
                    </span>
                  </span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal>
            <p style={{ marginTop: "1.4rem" }}>
              <Link className="ei-action" href="/services">
                Browse all services ↗
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      {/* Beat three — momentum. The order. */}
      <section className="scene" aria-label="Momentum">
        <div className="world-shell scene__inner">
          <Reveal>
            <p className="world-eyebrow">Momentum</p>
            <KineticTitle as="h2" text="Progress that keeps its pace" className="world-title" />
            <p className="world-lede">
              Nothing queues behind a ticket. Work starts when the order is
              verified and runs on the plan you bought, at the speed you bought
              it.
            </p>
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
        </div>
      </section>

      {/* Beat four — your terms. Membership and referrals. */}
      <section className="scene" aria-label="Your terms">
        <div className="world-shell scene__inner">
          <Reveal>
            <p className="world-eyebrow">Your terms</p>
            <KineticTitle as="h2" text="Play it the way you like" className="world-title" />
            <p className="world-lede">
              UPI, Razorpay or USDT. A verification link on every order so you
              can check the state of your own purchase whenever you want.
            </p>
          </Reveal>
          <Stagger className="world-grid">
            <StaggerItem>
              <article className="glass world-card">
                <span className="world-card__tag">Membership</span>
                <h3>One term, every game</h3>
                <p>
                  One 30-day term covers account management across all five
                  supported games. Starting at ₹700 for 30 days.
                </p>
                <Link href="/membership">See what membership includes ↗</Link>
              </article>
            </StaggerItem>
            <StaggerItem>
              <article className="glass world-card">
                <span className="world-card__tag">Referrals</span>
                <h3>Bring someone worth keeping</h3>
                <p>
                  Invite friends through your referral link and earn a reward
                  for that calendar month. Rewards expire at the month
                  boundary.
                </p>
                <Link href="/referrals">How referrals work ↗</Link>
              </article>
            </StaggerItem>
            <StaggerItem>
              <article className="glass world-card">
                <span className="world-card__tag">Cards</span>
                <h3>A card system that cannot double-spend</h3>
                <p>
                  A community card system built around guarded, transactional
                  plays. A card can never be spent twice, even if a server dies
                  mid-trade.
                </p>
                <Link href="/cards">See the collection ↗</Link>
              </article>
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      {/* Beat five — quiet by design. Coverage. */}
      <section className="scene" aria-label="Quiet by design">
        <div className="world-shell scene__inner">
          <Reveal>
            <p className="world-eyebrow">Quiet by design</p>
            <KineticTitle as="h2" text="No noise, no waiting room" className="world-title" />
            <p className="world-lede">
              No app to install, no launcher, no lobby. The whole thing happens
              on this site and in your server, and it is done by staff, not a
              queue.
            </p>
          </Reveal>
          <Stagger className="world-grid" amount={0.05}>
            {GAMES.map((game) => (
              <StaggerItem key={game}>
                <div className="glass world-card">
                  <span className="world-card__tag">Supported</span>
                  <h3>{game}</h3>
                  <p>
                    {services.filter((service) => service.game === game).length}{" "}
                    services in the catalogue.
                  </p>
                </div>
              </StaggerItem>
            ))}
            <StaggerItem>
              <div className="glass world-card">
                <span className="world-card__tag">Live</span>
                <h3>
                  <CountUp to={services.length} suffix=" services" />
                </h3>
                <p>Every one priced in INR, with the inclusions written out.</p>
              </div>
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      {/* Beat six — the term. The length of the work. */}
      <section className="scene" aria-label="The term">
        <div className="world-shell scene__inner">
          <Reveal>
            <p className="world-eyebrow">The term</p>
            <KineticTitle as="h2" text="Day one to day thirty" className="world-title" />
            <p className="world-lede">
              One thirty-day term of account management across all five
              supported games, starting at ₹700. Renew when it suits you, not
              when a bot demands it.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Beat seven — handled. The people. */}
      <section className="scene" aria-label="Handled">
        <div className="world-shell scene__inner">
          <Reveal>
            <p className="world-eyebrow">Handled</p>
            <KineticTitle as="h2" text="Settled while you play" className="world-title" />
            <p className="world-lede">
              Every order is checked by a human before work begins, and every
              service is a person doing the work. That is the whole operation.
            </p>
          </Reveal>
          <Stagger className="world-grid">
            <StaggerItem>
              <div className="glass world-card">
                <h3>Order history</h3>
                <p>
                  Every order you place lands in your purchase logs with its
                  own verification link.
                </p>
                <Link href="/account/orders">Open purchase logs ↗</Link>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="glass world-card">
                <h3>Your servers</h3>
                <p>
                  The servers you invited bots to, and the setup for every bot
                  inside them, in one place.
                </p>
                <Link href="/account/servers">Open your servers ↗</Link>
              </div>
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      {/* Beat eight — ready. The close. */}
      <section className="scene" aria-label="Ready">
        <div className="world-shell scene__inner">
          <Reveal>
            <p className="world-eyebrow">Ready</p>
            <KineticTitle as="h2" text="Ready when you are" className="world-title" />
            <p className="world-lede">
              Sign in with Discord, pick a service, pay, and let the work
              begin. The rest of the site gets out of the way.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="world-row">
              <Link className="ei-action" href="/services">
                See the game services
              </Link>
              <Link className="world-button world-button--ghost" href="/docs">
                Read the docs
              </Link>
            </div>
          </Reveal>
          <Stagger className="world-stack" amount={0.04}>
            <StaggerItem>
              <details className="glass world-card">
                <summary>How do payments work?</summary>
                <p>
                  Choose a service, sign in with Discord and pay via UPI,
                  Razorpay or USDT. Staff verify your transfer before the
                  service starts — the full guide lives in the{" "}
                  <Link href="/docs">docs</Link>.
                </p>
              </details>
            </StaggerItem>
            <StaggerItem>
              <details className="glass world-card">
                <summary>How do I verify my order?</summary>
                <p>
                  Every order carries a verification link; you can also check
                  it from the <Link href="/verify">verification page</Link>.
                </p>
              </details>
            </StaggerItem>
            <StaggerItem>
              <details className="glass world-card">
                <summary>Who can see my servers?</summary>
                <p>
                  Only you and the staff working your order. The master account
                  can see every server so it can remove a bot that is
                  misbehaving — everyone else is scoped to the servers they
                  invited.
                </p>
              </details>
            </StaggerItem>
          </Stagger>
        </div>
      </section>
    </>
  );
}
