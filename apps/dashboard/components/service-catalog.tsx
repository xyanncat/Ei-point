"use client";
import { useState } from "react";
import assets from "../lib/project-assets.json";
import { CheckoutButton } from "./checkout";
export function ServiceCatalog() {
  const [game, setGame] = useState("All games"),
    [search, setSearch] = useState("");
  const games = [
    "All games",
    ...Array.from(new Set(assets.services.map((s) => s.game))).filter(
      (g) => g !== "All games",
    ),
  ];
  const services = assets.services.filter(
    (s) =>
      (game === "All games" || s.game === game) &&
      `${s.name} ${s.description} ${s.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="ei-catalog" aria-label="Original service catalog">
      <div className="ei-catalog-tools">
        <div>
          <h2>Choose your service</h2>
          <p>{services.length} services · prices from the supplied archive</p>
        </div>
        <label>
          Game
          <select aria-label="Game" value={game} onChange={(e) => setGame(e.target.value)}>
            {games.map((g) => (
              <option key={g}>{g}</option>
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
            <h3>{s.name}</h3>
            <p>{s.description}</p>
            <dl>
              <dt>Estimated duration</dt>
              <dd>{s.duration}</dd>
            </dl>
            {"inclusions" in s && s.inclusions && (
              <ul>
                {s.inclusions.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            {"facts" in s && s.facts && (
              <dl>
                {s.facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <footer>
              <strong>
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: s.currency,
                  maximumFractionDigits: 0,
                }).format(s.price_minor / 100)}
              </strong>
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
