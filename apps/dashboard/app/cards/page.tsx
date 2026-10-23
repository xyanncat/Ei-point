import assets from "../../lib/project-assets.json";
import { Stagger, StaggerItem, Reveal } from "../../components/motion";

type CardDefinition = {
  card_id: string;
  name: string;
  rarity: string;
  artwork_ref: string;
};

const cards = assets.cards as unknown as CardDefinition[];

export default function CardsPage() {
  return (
    <section className="world-section world-shell" aria-label="Card collection">
      <Reveal>
        <p className="world-eyebrow">The collection</p>
        <h1 className="world-title">The collection.</h1>
        <p className="world-lede">
          Cards published from the local card catalogue. Artwork and
          definitions are validated before each release.
        </p>
      </Reveal>

      {!cards.length ? (
        <Reveal>
          <div className="glass world-card" style={{ marginTop: "1.4rem" }}>
            <h3>The collection is waiting</h3>
            <p>
              No original card definitions have been added yet. New cards
              appear here after their artwork and definitions are published.
            </p>
          </div>
        </Reveal>
      ) : (
        <Stagger className="world-grid" amount={0.05}>
          {cards.map((card) => (
            <StaggerItem key={card.card_id}>
              <article className="glass world-card">
                <img
                  src={card.artwork_ref}
                  alt={card.name}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  style={{
                    width: "100%",
                    height: 260,
                    objectFit: "contain",
                    marginBottom: "0.8rem",
                  }}
                />
                <span className="world-card__tag">{card.rarity}</span>
                <h3>{card.name}</h3>
              </article>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <Reveal>
        <div className="glass world-card prose" style={{ marginTop: "1.6rem" }}>
          <h2>Public catalogue and your collection</h2>
          <p>
            This page is the public catalogue: artworks and definitions anyone
            can browse. A personal collection, trading and card purchases are
            not connected yet, so nothing here promises them until the card
            system ships.
          </p>
          <p>
            The card system itself is built around guarded, transactional
            plays. A card can never be spent twice, even if a server dies
            mid-trade, because the transfer and the spend are one atomic
            operation rather than two steps that can be interrupted.
          </p>
          <p>
            Search, filters and detail views arrive together with the first
            card definitions and artwork. The asset drop for cards is still
            pending, so there is nothing to filter yet.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
