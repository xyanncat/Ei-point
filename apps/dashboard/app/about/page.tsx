import Link from "next/link";
import { CountUp, KineticTitle, Reveal, Stagger, StaggerItem } from "../../components/motion";

const GAMES = [
  "Genshin Impact",
  "Honkai: Star Rail",
  "Wuthering Waves",
  "Neverness to Everness",
  "Arknights: Endfield",
];

const PRINCIPLES = [
  {
    title: "People do the work",
    body: "No bot queue, no ticket lottery. Every service is a person playing your account properly, and the person who starts the work is the person who verifies it.",
  },
  {
    title: "The price is the price",
    body: "The amount on the service page is the amount charged at checkout. No surge pricing, no fee that appears at the last step.",
  },
  {
    title: "You can check anything",
    body: "Every order carries its own verification link. You see the state of your order without asking anyone, and your purchase history stays in your account.",
  },
  {
    title: "Your servers are yours",
    body: "You see the servers you invited bots to and nobody else does. The one exception is the master account, which exists to remove a bot that has gone wrong.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="world-section world-shell" aria-label="About Ei point">
        <div className="world-page">
          <Reveal>
            <p className="world-eyebrow">About</p>
            <KineticTitle
              as="h1"
              text="A small operation that plays its part properly."
            />
            <p className="world-lede">
              Ei point sells 30-day account management for five games. The
              whole promise is in that sentence: a fixed term, a fixed
              catalogue, and work done by people who care whether it is done
              right.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="world-note">
              Founded by a team that plays every title it supports, and
              staffed by the same people who handle the orders.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="world-section world-shell" aria-label="What we believe">
        <Reveal>
          <p className="world-eyebrow">How we work</p>
          <h2 className="world-title world-title--sm">Four things we do not bend</h2>
        </Reveal>
        <Stagger className="world-grid">
          {PRINCIPLES.map((item) => (
            <StaggerItem key={item.title}>
              <article className="glass world-card">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="world-section world-shell" aria-label="Games we cover">
        <Reveal>
          <p className="world-eyebrow">Coverage</p>
          <h2 className="world-title world-title--sm">Games we cover</h2>
        </Reveal>
        <Stagger className="world-grid" amount={0.05}>
          {GAMES.map((game) => (
            <StaggerItem key={game}>
              <div className="glass world-card">
                <span className="world-card__tag">Supported</span>
                <h3>{game}</h3>
                <p>Quests, exploration and account management.</p>
              </div>
            </StaggerItem>
          ))}
          <StaggerItem>
            <div className="glass world-card">
              <span className="world-card__tag">Term</span>
              <h3>
                <CountUp to={30} suffix=" days" />
              </h3>
              <p>One membership term covers every game on this list.</p>
            </div>
          </StaggerItem>
        </Stagger>
        <Reveal>
          <p style={{ marginTop: "1.6rem" }}>
            <Link className="ei-action" href="/membership">
              See the membership ↗
            </Link>
          </p>
        </Reveal>
      </section>

      <section className="world-section world-shell" aria-label="Get in touch">
        <Reveal>
          <div className="glass world-card">
            <h3>Questions before you order</h3>
            <p>
              The docs cover the whole process: choosing a service, paying,
              verification, timing and what happens if something goes wrong.
              If the answer is not there, ask staff on your game server.
            </p>
            <p>
              <Link className="ei-action" href="/docs">
                Read the docs ↗
              </Link>
            </p>
          </div>
        </Reveal>
      </section>
    </>
  );
}
