import type { CatalogItem } from "@ei-royality/contracts";
import { DataStateView } from "../../components/status";

async function fetchCatalog(): Promise<CatalogItem[] | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
  try {
    const res = await fetch(`${base}/api/catalog`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { items: CatalogItem[] }).items;
  } catch {
    return null;
  }
}

export default async function ServicesPage() {
  const items = await fetchCatalog();
  if (items == null) {
    return (
      <section aria-label="Game services">
        <h1>Game services</h1>
        <DataStateView state="failed" detail="Catalog unavailable — retry shortly." />
      </section>
    );
  }
  if (items.length === 0) {
    return (
      <section aria-label="Game services">
        <h1>Game services</h1>
        <DataStateView state="empty" detail="No services on sale right now." />
      </section>
    );
  }
  return (
    <section aria-label="Game services">
      <h1>Game services</h1>
      <p className="lede">Prices are set by the server. What you see is what you pay — no discounts to haggle, no surprises at checkout.</p>
      <ul className="service-grid">
        {items.map((item, i) => (
          <li key={item.sku} className="clip-panel" style={i === 0 ? { borderColor: "var(--gold)" } : undefined}>
            <h2>{item.name}</h2>
            <p className="display-number">
              {(item.priceMinor / 100).toFixed(2)} <span style={{ fontSize: "1rem" }}>{item.currency}</span>
            </p>
            <p>
              <a href="/verify">Pay, then verify your order</a>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
