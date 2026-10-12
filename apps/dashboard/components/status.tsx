import type { DataState, ServiceCard } from "@ei-point/contracts";

export function stateLabel(state: DataState): string {
  switch (state) {
    case "loading":
      return "Loading…";
    case "empty":
      return "Nothing here yet.";
    case "failed":
      return "Something failed — retry.";
    case "stale":
      return "Showing cached data.";
    case "saving":
      return "Saving…";
    case "confirmed":
      return "Confirmed applied.";
    case "ready":
      return "";
  }
}

export function DataStateView({ state, detail }: { state: DataState; detail?: string }) {
  if (state === "ready" || state === "confirmed") return null;
  return (
    <div role="status" data-state={state}>
      {stateLabel(state)}
      {detail != null && detail !== "" ? ` ${detail}` : ""}
    </div>
  );
}

const DOT: Record<ServiceCard["state"], string> = {
  ok: "●",
  degraded: "◐",
  down: "○",
  unknown: "?",
};

export function BotCard({ card }: { card: ServiceCard }) {
  return (
    <article aria-label={`${card.botKey} bot status`}>
      <h2>{card.botKey}</h2>
      <p>
        <span aria-label={`service ${card.state}`}>{DOT[card.state]}</span>{" "}
        <span aria-label={`gateway ${card.gateway}`}>gw:{DOT[card.gateway]}</span>
      </p>
      <p>{card.latencyMs != null ? `${card.latencyMs} ms` : "latency unknown"}</p>
    </article>
  );
}
