import type { CatalogItem } from "@ei-point/contracts";
import { KafkaScene } from "../components/kafka-scene";
import { PageArt } from "../components/page-art";
import "./kafka.css";

async function fetchCatalog(): Promise<CatalogItem[] | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
  try {
    const res = await fetch(`${base}/api/catalog`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { items: CatalogItem[] };
    return data.items;
  } catch {
    return null;
  }
}

function price(item: CatalogItem): string {
  return `${(item.priceMinor / 100).toFixed(2)} ${item.currency}`;
}

export default async function HomePage() {
  const catalog = await fetchCatalog();
  const count = catalog?.length ?? 0;
  return (
    <>
      <section aria-label="Introduction" className="kafka-home">
        <div>
          <p className="display-number">
            <span className="sr-only">
              {catalog == null ? "Service count is unavailable" : `${count} services live`}
            </span>
            <span aria-hidden="true">{catalog == null ? "—" : count}</span>
          </p>
          <h1>Play here. Belong here.</h1>
          <p className="lede">
            Ei point provides 30-day account management across Genshin Impact,
            Honkai: Star Rail, Wuthering Waves, Neverness to Everness, and
            Arknights: Endfield — paid over UPI or USDT, verified on this site,
            settled by staff. No app to install, no noise.
          </p>
          <p>
            <a href="/services">See the game services</a> ·{" "}
            <a href="/membership">Become a member</a>
          </p>
        </div>
        <KafkaScene />
      </section>
      <hr className="hero-beam" aria-hidden="true" />
      <section
        className="ei-collection-strip"
        aria-label="Explore the community"
      >
        <a href="/membership">
          <img
            src="/art/kafka-fan.png"
            alt="Kafka with a folding fan"
            width="1199"
            height="1692"
            loading="lazy"
          />
          <span>
            Find your place<small>Membership</small>
          </span>
        </a>
        <a href="/referrals">
          <img
            src="/art/kafka-floral.png"
            alt="Kafka wearing a floral kimono"
            width="848"
            height="2048"
            loading="lazy"
          />
          <span>
            Grow your circle<small>Referrals</small>
          </span>
        </a>
      </section>
      <section aria-label="What you get">
        <div className="ei-page-layout">
          <PageArt
            src="/art/kafka-silk.png"
            caption="Pull the threads together."
          />
          <div className="ei-page-body">
            <h2>
              Your community.
              <br />A shared story.
            </h2>
            <p className="lede">
              Play together, build your collection and keep every order in view.
              Your server staff handle the details; Ei point keeps the
              experience connected.
            </p>
            <a className="ei-action" href="/services">
              Explore game services
            </a>
            <ul className="service-grid">
              <li className="clip-panel">
                <h2>Card battles, kept honest</h2>
                <p>
                  Packs, trades, and a market where every card move is a guarded
                  transaction — a card can never be double-spent or duplicated,
                  even if a server dies mid-trade.
                </p>
              </li>
              <li className="clip-panel">
                <h2>Pay your way</h2>
                <p>
                  UPI or USDT. Every order carries a verification link you can
                  check here, any time.
                </p>
                <p>
                  <a href="/verify">Verify an order</a>
                </p>
              </li>
              <li className="clip-panel">
                <h2>Bring friends, earn months</h2>
                <p>
                  Referral links pay monthly rewards while your circle stays
                  active.
                </p>
                <p>
                  <a href="/referrals">How referrals work</a>
                </p>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
