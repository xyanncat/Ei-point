"use client";
// Commerce orders (list + detail pattern): filterable table, detail drawer with
// the settle/reject flow. Payment review lives in Commerce, not Fleet controls.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { Drawer, Empty, Panel } from "./ui";

type Order = {
  orderId: string;
  buyerId?: string;
  serviceName: string;
  amountMinor: number | string;
  method: string;
  status: string;
  createdAt: string;
  proofRef?: string | null;
  timeline?: { at: string; label: string }[];
};

export function CommerceOrders({
  guildId,
  scopes,
  title = "Order history",
  defaultStatus = "all",
}: {
  guildId: string;
  scopes: string[];
  title?: string;
  defaultStatus?: string;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(defaultStatus);
  const trigger = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);
  const admin = scopes.includes("*") || scopes.includes("commerce-settle");
  const read = admin || scopes.includes("commerce");
  const base = `/api/guilds/${encodeURIComponent(guildId)}/commerce/orders`;

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ orders: Order[] }>(base);
      if (ticket === sequence.current) setOrders(result.orders);
    } catch (cause) {
      if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : "Orders are unavailable.");
    } finally {
      if (ticket === sequence.current) setBusy(false);
    }
  }, [base]);
  useEffect(() => {
    setOrders([]);
    setNotice("");
    setSelected(null);
    setStatusFilter(defaultStatus);
    if (read) void load();
    return () => {
      sequence.current++;
    };
  }, [guildId, read, load, defaultStatus]);

  async function action(order: Order, value: "settle" | "reject") {
    if (value === "settle" && !window.confirm(`Confirm you matched ${order.orderId} against the payment statement. Settling activates membership and referral rewards. Continue?`)) return;
    if (value === "reject" && !window.confirm(`Reject ${order.orderId}? This order cannot be reopened.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { csrfToken } = await api<{ csrfToken: string }>("/api/auth/csrf");
      await api(`${base}/${order.orderId}/${value}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ idempotencyKey: `${value}-${order.orderId}` }),
      });
      setNotice(`${order.orderId} ${value === "settle" ? "settled" : "rejected"}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403 ? `Access denied: ${cause.message}` : cause instanceof Error ? cause.message : "Order action failed.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () => orders.filter((o) => statusFilter === "all" || o.status === statusFilter),
    [orders, statusFilter],
  );
  const active = filtered.find((o) => o.orderId === selected) ?? orders.find((o) => o.orderId === selected) ?? null;
  const statuses = ["all", ...new Set(orders.map((o) => o.status))];

  if (!read) {
    return (
      <Panel title="Orders" detail="Your staff role does not include commerce orders.">
        <Empty title="No access" detail="Payment proofs and settlement stay with commerce staff." />
      </Panel>
    );
  }

  return (
    <Panel title={title} detail={admin ? "Transfers are matched against your statement; settling applies membership and referral credit." : "Read-only order overview."}>
      {error && <p className="sf-note sf-error" role="alert">{error}</p>}
      {notice && <p className="sf-note sf-ok-note sf-checkmark" role="status">{notice}</p>}
      <label className="sf-field" style={{ maxWidth: "14rem" }}>
        <span>Status filter</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {filtered.length ? (
        <table className="sf-table">
          <thead>
            <tr><th>Order</th><th>Service</th><th>Amount</th><th>Method</th><th>Status</th><th>Created</th><th><span className="sr-only">Review</span></th></tr>
          </thead>
          <tbody>
            {filtered.map((order) => (
              <tr key={order.orderId}>
                <td className="sf-num">{order.orderId}</td>
                <td>{order.serviceName}</td>
                <td>{(Number(order.amountMinor) / 100).toFixed(2)} {order.method === "upi" ? "INR" : "USDT"}</td>
                <td>{order.method}</td>
                <td>{order.status}</td>
                <td className="sf-num">{new Date(order.createdAt).toLocaleString()}</td>
                <td><button className="sf-ghost" onClick={(event) => { trigger.current = event.currentTarget; setSelected(order.orderId); }}>Review</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty
          title={busy ? "Loading orders…" : defaultStatus === "claimed" ? "Nothing waiting for review" : "No orders"}
          detail={busy ? undefined : defaultStatus === "claimed" ? "No orders are waiting for review in this server." : "No commerce orders in this server."}
        />
      )}
      {active && (
        <Drawer title={`Order ${active.orderId}`} onClose={() => setSelected(null)} restore={() => trigger.current?.focus()}>
          <dl className="sf-kv">
            <div><dt>Service</dt><dd>{active.serviceName}</dd></div>
            <div><dt>Amount</dt><dd>{(Number(active.amountMinor) / 100).toFixed(2)} {active.method === "upi" ? "INR" : "USDT"}</dd></div>
            <div><dt>Status</dt><dd>{active.status}</dd></div>
            {active.buyerId !== undefined && <div><dt>Buyer Discord ID</dt><dd className="sf-num">{active.buyerId}</dd></div>}
            {active.proofRef !== undefined && <div><dt>Payment proof</dt><dd>{active.proofRef ?? "No proof submitted"}</dd></div>}
            <div><dt>Created</dt><dd>{new Date(active.createdAt).toLocaleString()}</dd></div>
          </dl>
          {active.timeline?.length ? (
            <ul className="sf-list">
              {active.timeline.map((step, index) => (
                <li key={index}><span className="sf-dot" />{step.label}<time>{new Date(step.at).toLocaleString()}</time></li>
              ))}
            </ul>
          ) : null}
          <div className="sf-actions">
            {admin && active.status === "claimed" && (
              <button className="sf-primary" disabled={busy} onClick={() => void action(active, "settle")}>Settle verified transfer</button>
            )}
            {admin && ["pending", "claimed"].includes(active.status) && (
              <button className="sf-ghost" disabled={busy} onClick={() => void action(active, "reject")}>Reject order</button>
            )}
          </div>
        </Drawer>
      )}
    </Panel>
  );
}
