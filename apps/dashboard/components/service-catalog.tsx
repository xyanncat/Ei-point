"use client";
// The service catalogue.
//
// The archived definitions are the fallback; the live catalogue is the truth
// when it is available. The operator owns price, name and wording, so those
// come from the API. The archive still supplies the fields the catalogue
// does not carry (inclusions, facts) and keeps the page working when the
// API is down.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import assets from "../lib/project-assets.json";
import { CheckoutButton } from "./checkout";
import { api } from "../lib/api";

type ArchiveService = {
  sku: string;
  game: string;
  category: string;
  name: string;
  description: string;
  duration: string;
  price_minor: number;
  currency: string;
  inclusions?: string[];
  facts?: [string, string][];
};

type LiveItem = {
  sku: string;
  name: string;
  priceMinor: number;
  currency: string;
  game: string | null;
  category: string | null;
  duration: string | null;
  description: string | null;
};

type Row = ArchiveService & {
  price_minor: number;
  name: string;
  description: string;
  live: boolean;
};

export function ServiceCatalog() {
  const [game, setGame] = useState("All games");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState<LiveItem[] | null>(null);

  useEffect(() => {
    let active = true;
    api<{ items: LiveItem[] }>("/api/catalog")
      .then((result) => {
        if (active) setLive(result.items);
      })
      .catch(() => {
        // The archive stands in when the catalogue cannot be reached.
        if (active) setLive(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const archive = assets.services as unknown as ArchiveService[];

  const rows = useMemo<Row[]>(() => {
    if (live && live.length)
      return live.map((item) => {
        const fallback = archive.find((entry) => entry.sku === item.sku);
        return {
          ...(fallback ?? {
            sku: item.sku,
            game: item.game ?? "Game",
            category: item.category ?? "Service",
            duration: item.duration ?? "30 days",
          }),
          name: item.name,
          description: item.description ?? fallback?.description ?? "",
          price_minor: item.priceMinor,
          currency: item.currency,
          live: true,
        } as Row;
      });
    return archive.map((entry) => ({ ...entry, live: false }));
  }, [live, archive]);

  const games = [
    "All games",
    ...Array.from(new Set(rows.map((row) => row.game))).filter(
      (entry) => entry !== "All games",
    ),
  ];

  const services = rows.filter(
    (row) =>
      (game === "All games" || row.game === game) &&
      `${row.name} ${row.description} ${row.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  return (
    <section className="ei-catalog" aria-label="Service catalogue">
      <div className="ei-catalog-tools">
        <div>
          <h2>Choose your service</h2>
          <p>
            {services.length} services · {live ? "current prices" : "prices from the supplied archive"} ·
            availability confirmed by staff before an order starts
          </p>
        </div>
        <label>
          Game
          <select aria-label="Game" value={game} onChange={(e) => setGame(e.target.value)}>
            {games.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <label>
          Find a service
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Quest, exploration, character…"
          />
        </label>
      </div>
      <div className="ei-service-list">
        {services.map((s) => (
          <article key={s.sku} className="clip-panel">
            <p>
              {s.game} · {s.category}
            </p>
            <h3>
              <Link href={`/services/${s.sku}`}>{s.name}</Link>
            </h3>
            <p>{s.description}</p>
            <dl>
              <dt>Estimated duration</dt>
              <dd>{s.duration}</dd>
            </dl>
            {s.inclusions?.length ? (
              <ul>
                {s.inclusions.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
            {s.facts?.length ? (
              <dl>
                {s.facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <footer>
              <strong>
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: s.currency,
                  maximumFractionDigits: 0,
                }).format(s.price_minor / 100)}
              </strong>
              <Link className="ei-detail-link" href={`/services/${s.sku}`}>
                Details ↗
              </Link>
              <CheckoutButton serviceId={s.sku} name={s.name} />
            </footer>
          </article>
        ))}
      </div>
      {!services.length && (
        <p role="status">
          No services match this search. Try a different game or name.
        </p>
      )}
    </section>
  );
}
