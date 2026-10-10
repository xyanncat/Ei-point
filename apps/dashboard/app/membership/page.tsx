export default function MembershipPage() {
  return (
    <section aria-label="Membership">
      <h1>Membership</h1>
      <p className="lede">
        One membership, everything included: tournament seats, a monthly card pack, and member pricing
        across game services. It runs month to month — rewards and perks follow the calendar cycle.
      </p>
      <div className="clip-panel">
        <h2>What members get</h2>
        <ul>
          <li>A seat in every monthly tournament</li>
          <li>One card pack on the first of each month</li>
          <li>Referral links that earn monthly rewards</li>
        </ul>
        <p>
          Orders open through staff on the game servers. After paying, <a href="/verify">verify your order here</a>.
        </p>
      </div>
    </section>
  );
}
