"use client";
// Purchase logs. A customer sees their own orders; the operator and the
// master see every order on the platform.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../../lib/api";
import { Empty, HealthBadge, PageHeader, Panel } from "../../../components/staff/ui";
import { Stagger, StaggerItem } from "../../../components/motion";

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

const STATUS_HEALTH: Record<string, string> = {
  pending: "degraded",
  claimed: "degraded",
  settled: "ok",
  rejected: "down",
  expired: "down",
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
          <Stagger className="sf-cards" amount={0.08}>
            {orders.map((order) => (
              <StaggerItem key={order.orderId}>
                <article className="sf-card">
                  <div className="sf-card__top">
                    <span className="sf-card__mark" aria-hidden="true">
                      {(order.serviceName || order.orderId).charAt(0)}
                    </span>
                    <div>
                      <h3 className="sf-card__title">
                        <Link href={`/account/orders/${encodeURIComponent(order.orderId)}`}>
                          {order.orderId}
                        </Link>
                      </h3>
                      <p className="sf-card__sub">{order.serviceName}</p>
                    </div>
                  </div>
                  <div className="sf-card__meta">
                    <span className="sf-num">
                      {(order.amountMinor / 100).toLocaleString("en-IN", {
                        style: "currency",
                        currency: "INR",
                        maximumFractionDigits: 0,
                      })}
                    </span>
                    <HealthBadge
                      health={STATUS_HEALTH[order.status] ?? "unknown"}
                      text={STATUS_LABEL[order.status] ?? order.status}
                    />
                  </div>
                  <div className="sf-card__meta">
                    <span className="sf-num">{stamp(order.createdAt)}</span>
                    {scope === "all" ? (
                      <span className="sf-num">{order.buyerId}</span>
                    ) : null}
                    <span className="sf-card__sub">{order.guildName ?? "No server"}</span>
                  </div>
                </article>
              </StaggerItem>
            ))}
          </Stagger>
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
