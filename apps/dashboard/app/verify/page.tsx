import type { OrderVerification } from "@ei-point/contracts";
import { headers } from "next/headers";
import { PageArt } from "../../components/page-art";
import { orderGuidance } from "../../lib/order-status";
type Verification =
  | { state: "ok"; order: OrderVerification & { currency?: string } }
  | { state: "unknown" }
  | { state: "unavailable" };
async function fetchVerification(
  token: string,
  id?: string,
  forwarded?: string,
): Promise<Verification> {
  const base = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
  const service = process.env.INTERNAL_SERVICE_TOKEN ?? "";
  const url = service
    ? `${base}/api/internal/payments/verify?${id ? `id=${encodeURIComponent(id)}` : `token=${encodeURIComponent(token)}`}`
    : id
      ? `${base}/api/payments/status/${encodeURIComponent(id)}`
      : `${base}/api/orders/verify?token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      ...(service
        ? {
            headers: {
              authorization: `Bearer ${service}`,
              ...(forwarded ? { "x-ei-client-ip": forwarded } : {}),
            },
          }
        : {}),
    });
    if (res.status === 400 || res.status === 404) return { state: "unknown" };
    if (!res.ok) return { state: "unavailable" };
    const result = await res.json();
    return {
      state: "ok",
      order: service
        ? (result as OrderVerification & { currency?: string })
        : id
          ? { skuName: result.serviceName, amountMinor: Math.round(Number(result.amount) * 100), status: result.status, currency: result.currency }
          : (result as OrderVerification),
    };
  } catch {
    return { state: "unavailable" };
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
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  const result = id || token.length >= 16 ? await fetchVerification(token, id || undefined, forwarded || undefined) : null;
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
            {result?.state === "ok" ? (
              <>
                <h2>Order details</h2>
                <dl>
                  <dt>Item</dt>
                  <dd>{result.order.skuName}</dd>
                  <dt>Amount</dt>
                  <dd>{(result.order.amountMinor / 100).toFixed(2)} {result.order.currency ?? "INR"}</dd>
                  <dt>Status</dt>
                  <dd>{result.order.status}</dd>
                </dl>
                <p>{orderGuidance(result.order.status)}</p>
                <p>
                  <a href="/help">Help &amp; FAQ ↗</a> ·{" "}
                  <a href="/services">Browse services ↗</a>
                </p>
              </>
            ) : (
              <>
                <h2>
                  {!id && token.length < 16
                    ? "Check your token"
                    : result?.state === "unavailable"
                      ? "Verification unavailable"
                      : "Order not available"}
                </h2>
                <p>
                  {!id && token.length < 16
                    ? "This token is incomplete. Copy the full token from your verification link."
                    : result?.state === "unavailable"
                      ? "Order verification is temporarily unavailable. Your order is not affected — retry in a moment."
                      : "No order matches this ID or link. Check the link again, or ask staff with your order ID."}
                </p>
                <p>
                  <a href="/help">Help &amp; FAQ ↗</a>
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
            You can also enter the RP order ID shown during checkout (try <strong>RP-DEMO01</strong> in preview). This page shows order status only — submit payment proof from the checkout session that created the order. Staff review submitted payment proofs before confirming an order.
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
