import type { CatalogItem } from "@ei-royality/contracts";

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
      <section aria-label="Introduction">
        <p className="display-number" aria-label={`${count} services live`}>
          {catalog == null ? "—" : count}
        </p>
        <h1>Play here. Belong here.</h1>
        <p className="lede">
          Ei Royality runs card battles, tournaments, and a members club on its own game servers — paid
          over UPI or USDT, verified on this site, settled by staff. No app to install, no noise.
        </p>
        <p>
          <a href="/services">See the game services</a> · <a href="/membership">Become a member</a>
        </p>
      </section>
      <hr className="hero-beam" aria-hidden="true" />
      <section aria-label="What you get">
        <ul className="service-grid">
          <li className="clip-panel">
            <h2>Card battles, kept honest</h2>
            <p>
              Packs, trades, and a market where every card move is a guarded transaction — a card can
              never be double-spent or duplicated, even if a server dies mid-trade.
            </p>
          </li>
          <li className="clip-panel">
            <h2>Pay your way</h2>
            <p>UPI or USDT. Every order carries a verification link you can check here, any time.</p>
            <p>
              <a href="/verify">Verify an order</a>
            </p>
          </li>
          <li className="clip-panel">
            <h2>Bring friends, earn months</h2>
            <p>Referral links pay monthly rewards while your circle stays active.</p>
            <p>
              <a href="/referrals">How referrals work</a>
            </p>
          </li>
        </ul>
      </section>
    </>
  );
}
