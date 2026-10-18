import { PageArt } from "../../components/page-art";

const team = [
  { name: "Royal D. Subro", role: "Founder", id: "733513636269785120", detail: "Leads the studio and manages client relationships." },
  { name: "Harihar D. Aranara", role: "Co-founder", id: "1023938226773303457", detail: "Coordinates day-to-day operations and service delivery." },
  { name: "Xyann Cat", role: "Developer", id: "1479589523426902208", detail: "Builds and maintains the studio's digital systems." },
];

// Studio page: the people behind the work. Ordering questions moved to /help
// (one primary location per topic, owner task 2026-10-19).
export default function AboutPage() {
  return (
    <section className="ei-page-layout" aria-label="Studio">
      <div className="ei-page-body">
        <p>The people behind the work</p>
        <h1>
          Every order.
          <br />A real person.
        </h1>
        <p className="lede">
          Game progression, exploration, quests, builds and account management.
          The team and service details below are carried over from the supplied
          website archive.
        </p>
        <section className="service-grid" aria-label="Studio team">
          {team.map((person) => (
            <article className="clip-panel" key={person.id}>
              <p>{person.role}</p>
              <h2>{person.name}</h2>
              <p>{person.detail}</p>
              <a href={`https://discord.com/users/${person.id}`} target="_blank" rel="noreferrer">
                Discord profile ↗
              </a>
            </article>
          ))}
        </section>
        <section className="clip-panel" aria-label="Questions">
          <h2>Questions about ordering?</h2>
          <p>
            Payment methods, verification, timing and supported games are all
            answered in the <a href="/help">help centre</a>.
          </p>
          <p>
            <a className="ei-action" href="/help">
              Open the help centre ↗
            </a>
          </p>
        </section>
      </div>
      <PageArt src="/art/kafka-gold.png" caption="Craft, kept in human hands." />
    </section>
  );
}
