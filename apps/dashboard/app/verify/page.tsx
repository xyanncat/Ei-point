import type { OrderVerification } from "@ei-royality/contracts";

// Public order verification page (?token=...). No session needed; the API only
// returns safe-to-publish fields. Loading / invalid / unknown / ready states.
async function fetchVerification(token: string): Promise<OrderVerification | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
  try {
    const res = await fetch(`${base}/api/orders/verify?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as OrderVerification;
  } catch {
    return null;
  }
}

export default async function VerifyPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";
  if (token.length < 16) {
    return (
      <section aria-label="Order verification">
        <h1>Verify order</h1>
        <div role="status">This verification link is invalid.</div>
      </section>
    );
  }
  const order = await fetchVerification(token);
  if (order == null) {
    return (
      <section aria-label="Order verification">
        <h1>Verify order</h1>
        <div role="status">No order matches this link — or verification is unavailable. Retry shortly.</div>
      </section>
    );
  }
  return (
    <section aria-label="Order verification">
      <h1>Verify order</h1>
      <dl>
        <dt>Item</dt>
        <dd>{order.skuName}</dd>
        <dt>Amount</dt>
        <dd>{(order.amountMinor / 100).toFixed(2)}</dd>
        <dt>Status</dt>
        <dd>{order.status}</dd>
      </dl>
    </section>
  );
}
