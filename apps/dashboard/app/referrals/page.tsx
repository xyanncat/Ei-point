import { PageArt } from "../../components/page-art";
export default function ReferralsPage() {
  return (
    <section className="ei-page-layout" aria-label="Referrals">
      <div className="ei-page-body">
        <p>A circle that grows with you</p>
        <h1>
          Follow
          <br />
          the thread.
        </h1>
        <p className="lede">
          Every member gets a referral link. Invite friends through yours and
          earn a reward for that calendar month.
        </p>
        <ol className="ei-step-list">
          <li>
            <h2>Share your link</h2>
            <p>
              Ask staff on your game server for your personal link. Joins attach
              to the current month.
            </p>
          </li>
          <li>
            <h2>Let your circle grow</h2>
            <p>
              Eligible rewards are reserved for that cycle, then paid out by
              staff.
            </p>
          </li>
          <li>
            <h2>Start a fresh chapter</h2>
            <p>
              Unpaid rewards expire at the month boundary. Nothing carries over
              silently.
            </p>
          </li>
        </ol>
        <div className="clip-panel">
          <h2>Need your link?</h2>
          <p>
            Referral links are issued on the game servers. Ask a staff member to
            help you get started.
          </p>
        </div>
      </div>
      <PageArt
        src="/art/kafka-floral.png"
        caption="Every connection starts somewhere."
      />
    </section>
  );
}
