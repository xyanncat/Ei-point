import { BOT_KEYS, type ServiceCard } from "@ei-royality/contracts";
import { BotCard, DataStateView } from "../../components/status";

// Staff overview: six bot cards with real service state (§6). Server-rendered;
// loading / empty / failed / stale states — never a spinner forever.
async function fetchServices(): Promise<{ cards: ServiceCard[]; stale: boolean } | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
  try {
    const res = await fetch(`${base}/api/services`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { cards: ServiceCard[]; stale: boolean };
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const data = await fetchServices();
  if (data == null) {
    return (
      <section aria-label="Dashboard">
        <h1>Command center</h1>
        <DataStateView state="failed" detail="Service state unavailable — retry shortly." />
      </section>
    );
  }
  if (data.cards.length === 0) {
    return (
      <section aria-label="Dashboard">
        <h1>Command center</h1>
        <DataStateView state="empty" detail="No bots registered yet." />
      </section>
    );
  }
  const known = new Set<string>(BOT_KEYS);
  const cards = data.cards.filter((c) => known.has(c.botKey));
  return (
    <section aria-label="Dashboard">
      <h1>Command center</h1>
      {data.stale ? <DataStateView state="stale" detail="No live heartbeats yet." /> : null}
      <div role="list">
        {cards.map((card) => (
          <div role="listitem" key={card.botKey}>
            <BotCard card={card} />
          </div>
        ))}
      </div>
    </section>
  );
}
