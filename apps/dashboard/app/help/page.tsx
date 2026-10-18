import { PageArt } from "../../components/page-art";

// Help hub: ordering and payment guidance, the ordering FAQ (moved here from
// the studio page), membership/referral pointers, support and policies.
export default function HelpPage() {
  return (
    <section className="ei-page-layout" aria-label="Help and frequently asked questions">
      <div className="ei-page-body">
        <p>Help centre</p>
        <h1>
          Every step.
          <br />
          Written down.
        </h1>
        <p className="lede">
          How ordering, payment, verification, membership and referrals work on
          Ei point — plus the quick answers people ask for most.
        </p>

        <section className="clip-panel" aria-label="How ordering works">
          <h2>How ordering works</h2>
          <ol className="ei-step-list">
            <li>
              <h3>Choose a service</h3>
              <p>Browse the catalog and open the service you want. Prices come from the supplied archive and are confirmed at checkout.</p>
            </li>
            <li>
              <h3>Pay your way</h3>
              <p>Sign in with Discord, then pay by UPI, Razorpay or USDT (TRC-20). Checkout shows the exact amount and a QR code for your device.</p>
            </li>
            <li>
              <h3>Submit proof once</h3>
              <p>Send the UTR, transaction hash or Razorpay payment ID from your payment. Proof is reviewed by a human — never automatic.</p>
            </li>
            <li>
              <h3>Track and verify</h3>
              <p>Your order carries a verification link. Check its status any time on the <a href="/verify">verification page</a>.</p>
            </li>
          </ol>
        </section>

        <section className="clip-panel" aria-label="Ordering questions">
          <h2>Before you order</h2>
          <details>
            <summary>How do payments work?</summary>
            <p>Choose a service, sign in with Discord and choose a configured payment method. Checkout shows the current exact amount and a QR code. Staff verify your transfer before starting the service.</p>
          </details>
          <details>
            <summary>How do I prove I paid?</summary>
            <p>Submit your 12-digit UPI UTR, your 64-character TRON transaction hash, or — for Razorpay payments — the Razorpay payment ID (or the UTR from your receipt). Keep your order ID and contact staff if you need help. Submitted proof awaits manual review.</p>
          </details>
          <details>
            <summary>How long does a service take?</summary>
            <p>Each service lists an estimate. Single quests take around a week; full exploration can take several months. Account management membership covers 30 days.</p>
          </details>
          <details>
            <summary>Which games are supported?</summary>
            <p>Genshin Impact, Honkai: Star Rail, Wuthering Waves, Neverness to Everness and Arknights: Endfield. Individually priced archive plans currently cover Genshin and Star Rail; the membership covers all five games.</p>
          </details>
        </section>

        <section className="clip-panel" aria-label="Membership and referrals">
          <h2>Membership &amp; referrals</h2>
          <p>
            Membership is a 30-day account management term you can reorder any
            time — see <a href="/membership">the membership page</a> for what is
            included and current pricing.
          </p>
          <p>
            Referral links are issued on the game servers; rewards attach to the
            calendar month and are paid out by staff. Full rules are on{" "}
            <a href="/referrals">the referrals page</a>.
          </p>
        </section>

        <section className="clip-panel" aria-label="Support and policies">
          <h2>Support &amp; policies</h2>
          <ul>
            <li>Reach a real person through the team contacts on the <a href="/about">studio page</a> — keep your order ID handy.</li>
            <li>Payments are verified manually against your transfer; a submitted proof is not a confirmed payment.</li>
            <li>Prices come from the supplied service archive; checkout always shows the authoritative amount for your order.</li>
            <li>Referral rewards expire at the month boundary — nothing carries over silently.</li>
          </ul>
        </section>

        <p>
          <a className="ei-action" href="/services">Browse services ↗</a>
        </p>
      </div>
      <PageArt src="/art/kafka-tea.png" caption="Read once, order calmly." />
    </section>
  );
}
