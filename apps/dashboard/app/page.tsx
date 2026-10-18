import Link from "next/link";
import { KafkaScene } from "../components/kafka-scene";
import { PageArt } from "../components/page-art";
import assets from "../lib/project-assets.json";
import "./kafka.css";

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
const FEATURED = services.slice(0, 4);

function price(minor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
}

// Public home. Order: approved hero → services → how ordering works → cards →
// membership & referrals → help → footer (owner task 2026-10-19). The hero is
// unchanged; the bands below stay compact and never repeat its artwork.
export default function HomePage() {
  return (
    <>
      <section aria-label="Introduction" className="kafka-home">
        <div>
          <p className="display-number">
            <span className="sr-only">{services.length} services live</span>
            <span aria-hidden="true">{services.length}</span>
          </p>
          <h1>Play here. Belong here.</h1>
          <p className="lede">
            Ei point provides 30-day account management across Genshin Impact,
            Honkai: Star Rail, Wuthering Waves, Neverness to Everness, and
            Arknights: Endfield — paid over UPI or USDT, verified on this site,
            settled by staff. No app to install, no noise.
          </p>
          <p>
            <Link href="/services">See the game services</Link> ·{" "}
            <Link href="/membership">Become a member</Link>
          </p>
        </div>
        <KafkaScene />
      </section>
      <hr className="hero-beam" aria-hidden="true" />

      <section className="ei-home-section" aria-label="Game services">
        <h2>Game services</h2>
        <p className="lede">
          Quest progression, exploration and account management — definitions
          and INR prices from the supplied archive.
        </p>
        <ul className="service-grid">
          {FEATURED.map((service) => (
            <li key={service.sku} className="clip-panel">
              <p>
                {service.game} · {service.category}
              </p>
              <h3>
                <Link href={`/services/${service.sku}`}>{service.name}</Link>
              </h3>
              <p>{service.description}</p>
              <p>
                <strong>{price(service.price_minor, service.currency)}</strong> · {service.duration}
              </p>
            </li>
          ))}
        </ul>
        <p>
          <Link className="ei-action" href="/services">
            Browse all services ↗
          </Link>
        </p>
      </section>

      <section className="ei-page-layout" aria-label="How ordering works">
        <div className="ei-page-body">
          <h2>How ordering works</h2>
          <ol className="ei-step-list">
            <li>
              <h3>Choose a service</h3>
              <p>Open a service for its inclusions, timing and exact price before committing to anything.</p>
            </li>
            <li>
              <h3>Pay your way</h3>
              <p>Sign in with Discord, then pay by UPI, Razorpay or USDT — checkout shows the authoritative amount and a QR code.</p>
            </li>
            <li>
              <h3>Verified by a person</h3>
              <p>Submit your payment proof once; every order carries a verification link you can check any time.</p>
            </li>
          </ol>
          <p>
            <Link className="ei-action" href="/verify">
              Verify an order ↗
            </Link>
          </p>
        </div>
        <PageArt src="/art/kafka-silk.png" caption="Pull the threads together." />
      </section>

      <section className="ei-home-section" aria-label="Cards and community">
        <h2>Cards</h2>
        <p className="lede">
          A community card system designed around guarded, transactional plays —
          a card can never be double-spent, even if a server dies mid-trade. No
          cards are published yet; the collection fills in as definitions and
          artwork are released.
        </p>
        <p>
          <Link className="ei-action" href="/cards">
            See the collection ↗
          </Link>
        </p>
      </section>

      <section className="ei-home-section" aria-label="Membership and referrals">
        <div className="service-grid">
          <article className="clip-panel">
            <h2>Membership</h2>
            <p>
              One 30-day term covers account management across all five
              supported games. Starting at ₹700 for 30 days.
            </p>
            <p>
              <Link href="/membership">See what membership includes ↗</Link>
            </p>
          </article>
          <article className="clip-panel">
            <h2>Referrals</h2>
            <p>
              Invite friends through your referral link and earn a reward for
              that calendar month. Rewards expire at the month boundary.
            </p>
            <p>
              <Link href="/referrals">How referrals work ↗</Link>
            </p>
          </article>
        </div>
      </section>

      <section className="ei-home-section" aria-label="Help">
        <h2>Help &amp; FAQ</h2>
        <details>
          <summary>How do payments work?</summary>
          <p>
            Choose a service, sign in with Discord and pay via UPI, Razorpay or
            USDT. Staff verify your transfer before the service starts — the
            full guide lives in the <Link href="/help">help centre</Link>.
          </p>
        </details>
        <details>
          <summary>How do I verify my order?</summary>
          <p>
            Every order carries a verification link; you can also check it from
            the <Link href="/verify">verification page</Link>.
          </p>
        </details>
        <p>
          <Link className="ei-action" href="/help">
            Open the help centre ↗
          </Link>
        </p>
      </section>
    </>
  );
}
