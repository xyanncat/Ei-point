"use client";
// My account · Order detail. Renders the order status view for an order ID —
// the same public posture as the verification page: status is keyed by ID,
// receipt-grade proof is the token, and no buyer details are ever shown here.
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../../../lib/api";
import { orderGuidance } from "../../../../lib/order-status";
import { Empty, PageHeader, Panel } from "../../../../components/staff/ui";

type OrderStatus = {
  orderId: string;
  status: string;
  serviceName?: string;
  amount?: string;
  currency?: string;
  createdAt?: string;
  confirmedAt?: string;
};

export default function AccountOrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unknown" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      setOrder(await api<OrderStatus>(`/api/payments/status/${encodeURIComponent(orderId)}`));
      setState("ok");
    } catch (error) {
      setState(error instanceof ApiError && error.status === 404 ? "unknown" : "error");
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        eyebrow="My account · Order status"
        title={`Order ${orderId}`}
        explain="Status, timing and the next step for this order."
        actions={
          <Link className="sf-ghost" href="/account/orders">
            All orders
          </Link>
        }
      />

      {state === "loading" ? (
        <Panel title="Loading order">
          <p className="sf-dim" role="status">
            Checking this order…
          </p>
        </Panel>
      ) : state === "unknown" ? (
        <Panel title="Order not available">
          <Empty
            title="No order matches this ID"
            detail="Check the ID from your receipt, or open the verification link that came with the order."
          />
          <p className="sf-actions">
            <Link className="sf-ghost" href="/verify">
              Open the verification page
            </Link>
          </p>
        </Panel>
      ) : state === "error" || !order ? (
        <Panel title="Status temporarily unavailable">
          <Empty
            title="Could not load this order"
            detail="The status service did not answer. Your order is not affected — retry in a moment."
          />
          <p className="sf-actions">
            <button className="sf-ghost" onClick={() => void load()}>
              Retry
            </button>
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="Order" detail="Status view — no buyer details are shown here.">
            <dl className="sf-kv">
              <div>
                <dt>Order</dt>
                <dd className="sf-num">{order.orderId}</dd>
              </div>
              {order.serviceName ? (
                <div>
                  <dt>Service</dt>
                  <dd>{order.serviceName}</dd>
                </div>
              ) : null}
              {order.amount ? (
                <div>
                  <dt>Amount</dt>
                  <dd>
                    {order.amount} {order.currency ?? ""}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Current state</dt>
                <dd>{order.status}</dd>
              </div>
            </dl>
            <p>{orderGuidance(order.status)}</p>
            <p className="sf-actions">
              <Link className="sf-ghost" href={`/verify?id=${encodeURIComponent(orderId)}`}>
                Open verification page
              </Link>
              <Link className="sf-ghost" href="/help">
                Help &amp; FAQ
              </Link>
            </p>
          </Panel>
          <Panel title="What happened so far" detail="Timeline entries appear only where the records exist; nothing is inferred.">
            <ul className="sf-list">
              {order.createdAt ? (
                <li>
                  <span className="sf-dot" />
                  Created
                  <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time>
                </li>
              ) : null}
              {order.confirmedAt && ["confirmed", "settled"].includes(order.status) ? (
                <li>
                  <span className="sf-dot" />
                  Payment confirmed
                  <time dateTime={order.confirmedAt}>{new Date(order.confirmedAt).toLocaleString()}</time>
                </li>
              ) : null}
              <li>
                <span className="sf-dot" />
                Current state: {order.status}
              </li>
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
