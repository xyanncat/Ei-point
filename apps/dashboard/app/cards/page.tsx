import assets from "../../lib/project-assets.json";
export default function CardsPage() {
  return (
    <section aria-label="Card collection">
      <h1>The collection.</h1>
      <p className="lede">
        Cards published from the local card catalog. Artwork and definitions are
        validated before each release.
      </p>
      {!assets.cards.length ? (
        <div className="clip-panel">
          <h2>The collection is waiting</h2>
          <p>
            No original card definitions have been added yet. New cards will
            appear here after their artwork and definitions are published.
          </p>
        </div>
      ) : (
        <ul className="service-grid">
          {(
            assets.cards as {
              card_id: string;
              name: string;
              rarity: string;
              artwork_ref: string;
            }[]
          ).map((c) => (
            <li key={c.card_id} className="clip-panel">
              <img
                src={c.artwork_ref}
                alt={c.name}
                style={{ width: "100%", height: 300, objectFit: "contain" }}
              />
              <h2>{c.name}</h2>
              <p>{c.rarity}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
