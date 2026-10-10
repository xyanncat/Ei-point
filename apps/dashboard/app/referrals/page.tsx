export default function ReferralsPage() {
  return (
    <section aria-label="Referrals">
      <h1>Referrals</h1>
      <p className="lede">
        Every member gets a referral link. When friends join through it, you earn a reward reserved for
        that calendar month — paid out by staff, then the cycle resets. Miss a month and unclaimed
        rewards expire; nothing carries over silently.
      </p>
      <div className="clip-panel">
        <h2>How a cycle works</h2>
        <ul>
          <li>Share your link; joins attach to the current month</li>
          <li>Rewards are reserved, then paid by staff</li>
          <li>Unpaid rewards expire at the month boundary</li>
        </ul>
        <p>Links are issued on the game servers — ask any staff member for yours.</p>
      </div>
    </section>
  );
}
