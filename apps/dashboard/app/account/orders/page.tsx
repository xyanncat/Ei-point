"use client";
// My account · My orders. Account-scoped history is not connected yet; the
// working path is the same order-status lookup the receipt links use.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Empty, PageHeader, Panel } from "../../../components/staff/ui";

export default function AccountOrdersPage() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [formError, setFormError] = useState("");

  return (
    <>
      <PageHeader
        eyebrow="My account"
        title="My orders"
        explain="Open an order to see its full state, timing and next step."
      />
      <Panel
        title="Open an order"
        detail="Paste the order ID (RP-…) from your checkout or receipt. Status needs only the ID; the verification token in your receipt remains receipt-grade proof."
      >
        {formError ? (
          <p className="sf-note sf-error" role="alert">
            {formError}
          </p>
        ) : null}
        <form
          className="sf-actions"
          onSubmit={(event) => {
            event.preventDefault();
            const clean = id.trim().toUpperCase();
            if (!/^RP-[A-Z0-9]{6}$/.test(clean)) {
              setFormError("Order IDs look like RP-ABC123 — copy it exactly from your checkout or receipt.");
              return;
            }
            setFormError("");
            router.push(`/account/orders/${encodeURIComponent(clean)}`);
          }}
        >
          <label className="sf-field">
            <span>Order ID</span>
            <input
              required
              value={id}
              maxLength={12}
              onChange={(event) => {
                setId(event.target.value);
                setFormError("");
              }}
              placeholder="RP-DEMO01"
            />
          </label>
          <button className="sf-ghost">Open order</button>
        </form>
      </Panel>
      <Panel title="Order history" detail="Every order placed with your Discord sign-in, with status and next steps.">
        <Empty
          title="Not connected yet"
          detail="Account-linked order history ships with the customer dashboard. Until then, order status is available from your order ID above or the verification link that came with the order."
        />
        <p className="sf-actions">
          <Link className="sf-ghost" href="/verify">
            Open the verification page
          </Link>
        </p>
      </Panel>
    </>
  );
}
