import type { OrderVerification } from "@ei-point/contracts";
import { PageArt } from "../../components/page-art";
async function fetchVerification(
  token: string,
  id?: string,
): Promise<(OrderVerification & {currency?:string}) | null> {
  const base = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
  try {
    const res = await fetch(
      id ? `${base}/api/payments/status/${encodeURIComponent(id)}` : `${base}/api/orders/verify?token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const result=await res.json();
    return id ? {skuName:result.serviceName,amountMinor:Math.round(Number(result.amount)*100),status:result.status,currency:result.currency} : result as OrderVerification;
  } catch {
    return null;
  }
}
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; id?:string }>;
}) {
  const params=await searchParams;
  const token = params.token?.trim() ?? "";
  const id=params.id?.trim()??"";
  const order = id || token.length >= 16 ? await fetchVerification(token,id||undefined) : null;
  return (
    <section className="ei-page-layout" aria-label="Order verification">
      <div className="ei-page-body">
        <p>Your order, in plain sight</p>
        <h1>
          Trust.
          <br />
          Then verify.
        </h1>
        <p className="lede">
          Check an order with the verification token supplied by staff after
          payment. No account is needed.
        </p>
        {(token||id) && (
          <div className="ei-verify-result" role="status">
            {order ? (
              <>
                <h2>Order details</h2>
                <dl>
                  <dt>Item</dt>
                  <dd>{order.skuName}</dd>
                  <dt>Amount</dt>
                  <dd>{(order.amountMinor / 100).toFixed(2)} {order.currency ?? "INR"}</dd>
                  <dt>Status</dt>
                  <dd>{order.status}</dd>
                </dl>
              </>
            ) : (
              <>
                <h2>
                  {!id && token.length < 16
                    ? "Check your token"
                    : "Order not available"}
                </h2>
                <p>
                  {!id && token.length < 16
                    ? "This token is incomplete. Copy the full token from your verification link."
                    : "No order matches this ID or link, or verification is temporarily unavailable. Check with staff or try again shortly."}
                </p>
              </>
            )}
          </div>
        )}
        <form className="ei-verify-form" action="/verify" method="get">
          <label htmlFor="verification-order">Order ID</label>
          <input id="verification-order" name="id" defaultValue={id} placeholder="RP-DEMO01" pattern="RP-[A-Z0-9]{6}" />
          <label htmlFor="verification-token">Or your verification token</label>
          <input
            id="verification-token"
            name="token"
            defaultValue={token}
            placeholder="Paste your verification token"
            minLength={16}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit">Check order</button>
        </form>
        <div className="clip-panel">
          <h2>Where do I find it?</h2>
          <p>
            Open the verification link in your order message. The token is the
            text after <strong>?token=</strong>. If you have not received one,
            contact staff on your game server.
          </p>
          <p>
            You can also enter the RP order ID shown during checkout (try <strong>RP-DEMO01</strong> in preview). Staff review submitted payment proofs before confirming an order.
          </p>
        </div>
      </div>
      <PageArt
        src="/art/kafka-silk.png"
        caption="Every detail leaves a trace."
      />
    </section>
  );
}
