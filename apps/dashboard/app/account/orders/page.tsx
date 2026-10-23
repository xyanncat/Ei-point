"use client";
// Purchase logs. A customer sees their own orders; the operator and the
// master see every order on the platform.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../../lib/api";
import { Empty, PageHeader, Panel } from "../../../components/staff/ui";

type PurchaseLog = {
  orderId: string;
  buyerId: string;
  sku: string;
  serviceName: string;
  amountMinor: number;
  method: string | null;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  guildId: string | null;
  guildName: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting proof",
  claimed: "Under review",
  settled: "Settled",
  rejected: "Rejected",
  expired: "Expired",
};

function stamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 16).replace("T", " ")
    : "—";
}

export default function AccountOrdersPage() {
  const [orders, setOrders] = useState<PurchaseLog[]>([]);
  const [scope, setScope] = useState<"own" | "all">("own");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ orders: PurchaseLog[]; scope: "own" | "all" }>(
        "/api/account/orders",
      );
      setOrders(result.orders);
      setScope(result.scope);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The purchase log could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        eyebrow={scope === "all" ? "Every order" : "Your orders"}
        title="Purchase logs"
        explain={
          scope === "all"
            ? "Every order placed on the platform, newest first."
            : "Every order you have placed, newest first. Each one carries its own verification link."
        }
        actions={
          <button className="sf-ghost" onClick={() => void load()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {error ? (
        <p className="world-note world-note--error" role="alert">
          {error}
        </p>
      ) : null}

      <Panel
        title="Orders"
        detail="Status, amount and the server the work runs in."
      >
        {orders.length ? (
          <table className="sf-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Service</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Placed</th>
                {scope === "all" ? <th>Buyer</th> : null}
                <th>Server</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderId}>
                  <td>
                    <Link href={`/account/orders/${encodeURIComponent(order.orderId)}`}>
                      {order.orderId}
                    </Link>
                  </td>
                  <td>{order.serviceName}</td>
                  <td className="sf-num">
                    {(order.amountMinor / 100).toLocaleString("en-IN", {
                      style: "currency",
                      currency: "INR",
                      maximumFractionDigits: 0,
                    })}
                  </td>
                  <td>{STATUS_LABEL[order.status] ?? order.status}</td>
                  <td className="sf-num">{stamp(order.createdAt)}</td>
                  {scope === "all" ? <td className="sf-num">{order.buyerId}</td> : null}
                  <td>{order.guildName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title={busy ? "Loading orders…" : "No orders yet"}
            detail={
              busy
                ? undefined
                : "Once you buy a service it appears here with its verification link."
            }
          />
        )}
      </Panel>

      <p className="sf-actions">
        <Link className="sf-ghost" href="/verify">
          Open the verification page
        </Link>
      </p>
    </>
  );
}
