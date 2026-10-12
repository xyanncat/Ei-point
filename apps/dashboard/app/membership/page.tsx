import { PageArt } from "../../components/page-art";
import { CheckoutButton } from "../../components/checkout";
export default function MembershipPage() {
  return (
    <section className="ei-page-layout" aria-label="Membership">
      <div className="ei-page-body">
        <p>Your place in the community</p>
        <h1>
          A little closer.
          <br />
          Every month.
        </h1>
        <p className="lede">
          One 30-day membership covers account management for Genshin Impact,
          Honkai: Star Rail, Wuthering Waves, Neverness to Everness and
          Arknights: Endfield. Dailies and new events stay on schedule across
          every game.
        </p>
        <div className="clip-panel">
          <h2>Membership includes</h2>
          <ul>
            <li>30 days of account management</li>
            <li>Dailies and new events</li>
            <li>Farming and domain farming</li>
          </ul>
          <p>
            Starting at ₹700 for 30 days. Checkout shows current pricing and available payment methods.
          </p>
        </div>
        <CheckoutButton serviceId="account-management-membership" name="30-day account management membership" />
        <p>
          <a className="ei-action" href="/verify">
            Verify a membership order
          </a>
        </p>
      </div>
      <PageArt
        src="/art/kafka-gold.png"
        caption="Something worth belonging to."
      />
    </section>
  );
}
