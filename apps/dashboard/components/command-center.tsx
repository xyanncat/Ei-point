"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DashboardOverview,
  GuildInfo,
  ServiceCard,
} from "@ei-point/contracts";
import { api, ApiError, type AccountResponse } from "../lib/api";
import { Icon, type IconName } from "./icons";
import { KafkaScene } from "./kafka-scene";
import { BrandMark } from "./brand-mark";
import { PageArt } from "./page-art";
import { WorkspaceControls } from "./workspace-controls";
import { CommerceOrders } from "./commerce-orders";

type View = "overview" | "bots" | "incidents" | "activity" | "configuration" | "controls" | "admin";
const NAV: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "bots", label: "Bot fleet", icon: "bots" },
  { id: "incidents", label: "Incidents", icon: "shield" },
  { id: "activity", label: "Recent actions", icon: "activity" },
  { id: "configuration", label: "Configuration", icon: "cards" },
  { id: "controls", label: "Fleet controls", icon: "bots" },
  { id: "admin", label: "Administration", icon: "crown" },
];
const BOT: Record<string, { name: string; summary: string; icon: IconName }> = {
  kafka: {
    name: "Kafka",
    summary: "Security & moderation shield",
    icon: "shield",
  },
  cyrene: {
    name: "Cyrene",
    summary: "AI chat & TTS voice",
    icon: "spark",
  },
  robin: {
    name: "Robin",
    summary: "Music & playback",
    icon: "music",
  },
  cipher: {
    name: "Cipher",
    summary: "Payments & referrals",
    icon: "store",
  },
  silverwolf: {
    name: "Silver Wolf",
    summary: "Card games & economy",
    icon: "cards",
  },
  himiko: {
    name: "Himiko",
    summary: "Welcome, community levels & announcements",
    icon: "activity",
  },
  // Legacy keys (pre-rename) render until cutover completes.
  security: {
    name: "Kafka (legacy)",
    summary: "Antinuke, trust & raid protection",
    icon: "shield",
  },
  moderation: {
    name: "Kafka (legacy)",
    summary: "Cases, sanctions & server logs",
    icon: "activity",
  },
  community: {
    name: "Silver Wolf (legacy)",
    summary: "Welcomes, leveling & card economy",
    icon: "cards",
  },
  ai: {
    name: "Cyrene (legacy)",
    summary: "Conversations, personas & memory",
    icon: "spark",
  },
  music: {
    name: "Robin (legacy)",
    summary: "Playback, queues & voice sessions",
    icon: "music",
  },
  commerce: {
    name: "Cipher (legacy)",
    summary: "Orders, settlement & referrals",
    icon: "store",
  },
};
function stamp(value: string) {
  return new Date(value).getTime() > 0
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "No heartbeat";
}
function label(state: string) {
  return (
    (
      {
        ok: "Healthy",
        degraded: "Degraded",
        down: "Offline",
        unknown: "Unknown",
      } as Record<string, string>
    )[state] ?? "Unknown"
  );
}
function ServiceTile({
  card,
  onSelect,
}: {
  card: ServiceCard;
  onSelect: (element: HTMLButtonElement) => void;
}) {
  const info = BOT[card.botKey] ?? {
    name: card.botKey,
    summary: (card.modules ?? []).join(", "),
    icon: "bots" as IconName,
  };
  return (
    <button
      className="cc-bot"
      data-bot={card.botKey}
      onClick={(event) => onSelect(event.currentTarget)}
      aria-label={`Inspect ${info.name} status`}
    >
      <span className="cc-service-seal" aria-hidden="true">
        <Icon name={info.icon} />
      </span>
      <div className="cc-bot-top">
        <span className={`cc-bot-icon bot-${card.botKey}`}>
          <Icon name={info.icon} />
        </span>
        <span
          className="cc-badge"
          data-health={card.stale ? "unknown" : card.state}
        >
          <i />
          {card.stale ? "Stale" : label(card.state)}
        </span>
      </div>
      <h3>{info.name}</h3>
      <p>{info.summary}</p>
      <div className="cc-module-tags" aria-label="Assigned modules">
        {(card.modules ?? []).slice(0, 3).map((module) => (
          <span key={module}>{module.replaceAll("-", " ")}</span>
        ))}
        {(card.modules ?? []).length > 3 && (
          <span>+{(card.modules ?? []).length - 3}</span>
        )}
      </div>
      <dl className="cc-signals">
        <div>
          <dt>Discord</dt>
          <dd data-health={card.stale ? "unknown" : card.gateway}>
            {card.stale ? "Unknown" : label(card.gateway)}
          </dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd
            data-health={
              card.stale ? "unknown" : card.dbReady ? "ok" : "degraded"
            }
          >
            {card.stale ? "Unknown" : card.dbReady ? "Ready" : "Unavailable"}
          </dd>
        </div>
      </dl>
      <footer>
        <span className="cc-inspect">
          Open dossier <span aria-hidden="true">↗</span>
        </span>
        <span>
          {card.latencyMs === null || card.stale
            ? "Latency unavailable"
            : `${card.latencyMs} ms`}
        </span>
        <span>
          {card.updatedAt === new Date(0).toISOString()
            ? "Awaiting heartbeat"
            : `Seen ${stamp(card.updatedAt)}`}
        </span>
      </footer>
    </button>
  );
}
export function CommandCenter() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null),
    [guilds, setGuilds] = useState<GuildInfo[]>([]),
    [guild, setGuild] = useState("");
  const [demo, setDemo] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [boot, setBoot] = useState<"loading" | "login" | "ready" | "failed">(
      "loading",
    ),
    [error, setError] = useState(""),
    [reference, setReference] = useState("");
  const [data, setData] = useState<DashboardOverview | null>(null),
    [busy, setBusy] = useState(false),
    [view, setView] = useState<View>("overview"),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ServiceCard | null>(null),
    [account, setAccount] = useState(false),
    [mobile, setMobile] = useState(false),
    [logoutBusy, setLogoutBusy] = useState(false);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement).tagName,
        )
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "Escape") {
        setAccount(false);
        setMobile(false);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      setBoot("login");
      setUser(null);
      setData(null);
      setGuilds([]);
      setGuild("");
      setError(err.message);
      return;
    }
    setError(
      err instanceof Error && err.name !== "TimeoutError"
        ? err.message
        : "The request timed out. Please retry.",
    );
    setReference(err instanceof ApiError ? (err.correlationId ?? "") : "");
  }, []);
  const initialize = useCallback(async () => {
    setBoot("loading");
    setError("");
    setReference("");
    try {
      const me = await api<AccountResponse & { demo?: boolean; isAdmin?: boolean }>(
        "/api/auth/me",
      );
      setUser(me.user);
      setDemo(me.demo === true);
      setIsAdmin(me.isAdmin === true);
      const list = await api<{ guilds: GuildInfo[] }>("/api/guilds");
      setGuilds(list.guilds);
      setGuild(list.guilds[0]?.guildId ?? "");
      if(me.isAdmin === true && !list.guilds.length)setView("admin");
      setBoot("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setBoot("login");
      else {
        handleError(err);
        setBoot("failed");
      }
    }
  }, [handleError]);
  useEffect(() => {
    void initialize();
    return () => {
      controller.current?.abort();
    };
  }, [initialize]);
  const refresh = useCallback(
    async (id: string) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const ticket = ++generation.current;
      const timeout = setTimeout(
        () =>
          request.abort(new DOMException("Request timed out", "TimeoutError")),
        20000,
      );
      setBusy(true);
      setError("");
      setReference("");
      try {
        const next = await api<DashboardOverview>(
          `/api/overview?guildId=${encodeURIComponent(id)}`,
          { signal: request.signal },
        );
        if (ticket === generation.current) {
          setData(next);
          setSelected((current) =>
            current
              ? (next.cards.find((c) => c.botKey === current.botKey) ?? null)
              : null,
          );
        }
      } catch (err) {
        if (
          ticket === generation.current &&
          (!request.signal.aborted ||
            request.signal.reason?.name === "TimeoutError")
        ) {
          if (err instanceof ApiError && err.status === 403) setData(null);
          handleError(err);
        }
      } finally {
        clearTimeout(timeout);
        if (ticket === generation.current) setBusy(false);
      }
    },
    [handleError],
  );
  useEffect(() => {
    setData(null);
    setSelected(null);
    if (!guild || boot !== "ready") return;
    void refresh(guild);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh(guild);
    };
    const timer = setInterval(visible, 30000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      controller.current?.abort();
      generation.current++;
    };
  }, [guild, boot, refresh]);
  useEffect(() => {
    if (!selected) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      detailTrigger.current?.focus();
    };
  }, [selected]);
  async function logout() {
    setLogoutBusy(true);
    try {
      const token = await api<{ csrfToken: string }>("/api/auth/csrf");
      await api("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": token.csrfToken },
      });
      controller.current?.abort();
      setBoot("login");
      setUser(null);
      setGuilds([]);
      setData(null);
      setAccount(false);
    } catch (err) {
      handleError(err);
    } finally {
      setLogoutBusy(false);
    }
  }
  const securityAllowed =
    data?.guild.scopes?.some((s) => s === "*" || s === "security") ?? false;
  const cards = (data?.cards ?? []).filter((c) =>
    `${c.botKey} ${BOT[c.botKey]?.name ?? ""} ${(c.modules ?? []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const healthy = (data?.cards ?? []).filter(
    (c) => !c.stale && c.state === "ok" && c.gateway === "ok" && c.dbReady,
  ).length;
  const fresh = data && !error && !data.stale;
  if (boot === "login")
    return (
      <div className="cc-login">
        <a className="cc-wordmark" href="/">
          <BrandMark />
          Ei point
        </a>
        <div className="cc-login-composition">
          <div className="cc-login-portrait">
            <PageArt
              src="/art/kafka-silk.png"
              caption="A single thread connects us."
            />
            <div className="cc-login-quote">
              A world connected
              <br />
              by a single thread.
            </div>
          </div>
          <div className="cc-login-panel">
            <span className="cc-login-symbol" aria-hidden="true">
              ✦
            </span>
            <p className="cc-subtitle">Welcome to Ei point</p>
            <h1>
              Take your
              <br />
              place.
            </h1>
            <p>
              Sign in to manage your servers and see how your bots are doing.
            </p>
            <a className="cc-primary" href="/api/auth/login">
              <Icon name="bots" />
              Continue with Discord
              <span aria-hidden="true">↗</span>
            </a>
            {error && <p role="status">{error}</p>}
            <small>
              Access is limited to approved servers and authorized staff.
            </small>
          </div>
        </div>
        <a className="cc-back" href="/">
          Back to the community website
        </a>
      </div>
    );
  return (
    <div className="cc-shell">
      <aside className={`cc-sidebar ${mobile ? "is-open" : ""}`}>
        <a href="/" className="cc-wordmark">
          <BrandMark />
          Ei point
        </a>
        <div className="cc-workspace">
          <span className="cc-guild-avatar">
            {guilds.find((g) => g.guildId === guild)?.name.slice(0, 1) ?? "E"}
          </span>
          <label>
            Server
            <select
              aria-label="Choose server"
              value={guild}
              onChange={(e) => {
                setGuild(e.target.value);
                setMobile(false);
                setView("overview");
              }}
              disabled={!guilds.length}
            >
              {guilds.length ? (
                guilds.map((g) => (
                  <option key={g.guildId} value={g.guildId}>
                    {g.name}
                  </option>
                ))
              ) : (
                <option value="">No server selected</option>
              )}
            </select>
          </label>
        </div>
        <nav aria-label="Dashboard">
          {NAV.filter((n) => (n.id !== "incidents" || securityAllowed) && (n.id !== "admin" || isAdmin)).map(
            (n) => (
              <button
                key={n.id}
                className={view === n.id ? "active" : ""}
                aria-current={view === n.id ? "page" : undefined}
                onClick={() => {
                  setView(n.id);
                  setMobile(false);
                }}
              >
                <Icon name={n.icon} />
                {n.label}
                {n.id === "incidents" && data?.incidents.length ? (
                  <span>{data.incidents.length}</span>
                ) : null}
              </button>
            ),
          )}
        </nav>
        <div className="cc-side-bottom">
          <div className="cc-side-note">
            <Icon name="spark" />
            <p>
              One home.
              <br />
              <strong>Every part of your community.</strong>
            </p>
          </div>
          <a href="/">Community website</a>
          <p>Ei point command center</p>
        </div>
      </aside>
      {mobile && (
        <button
          className="cc-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="cc-main">
        <header className="cc-topbar">
          <button
            className="cc-mobile-button"
            onClick={() => setMobile(!mobile)}
            aria-label="Toggle navigation"
            aria-expanded={mobile}
          >
            <Icon name="menu" />
          </button>
          <div className="cc-breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>{NAV.find((n) => n.id === view)?.label}</strong>
          </div>
          <label className="cc-search">
            <Icon name="search" />
            <input
              ref={searchInput}
              aria-label="Search bots and modules"
              placeholder="Search bots and modules"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setView("bots");
              }}
            />
            <kbd>/</kbd>
          </label>
          <button
            className="cc-incident-button"
            aria-label="View recent incidents"
            onClick={() => setView("incidents")}
            disabled={!securityAllowed}
          >
            <Icon name="shield" />
            <span>{securityAllowed ? (data?.incidents.length ?? 0) : "—"}</span>
          </button>
          <div className="cc-account-wrap">
            <button
              className="cc-account"
              aria-expanded={account}
              onClick={() => setAccount(!account)}
            >
              <span>{user?.name.slice(0, 1) ?? "?"}</span>
              <strong>{user?.name ?? "Loading account"}</strong>
              <Icon name="chevron" />
            </button>
            {account && (
              <div className="cc-account-menu">
                <p>Signed in with Discord</p>
                <strong>{user?.name}</strong>
                <button onClick={() => void logout()} disabled={logoutBusy}>
                  <Icon name="logout" />
                  {logoutBusy ? "Signing out…" : "Sign out"}
                </button>
              </div>
            )}
          </div>
        </header>
        <div className="cc-content">
          {demo && (
            <div className="cc-stale" role="status">
              Demo workspace. All server names, events and health signals below
              are sample data.
            </div>
          )}
          {boot === "loading" ? (
            <div className="cc-state" role="status">
              <span className="cc-loader" />
              <h1>Opening your workspace</h1>
              <p>Checking your account and server access.</p>
            </div>
          ) : boot === "failed" ? (
            <div className="cc-state" role="alert">
              <Icon name="shield" />
              <h1>Workspace unavailable</h1>
              <p>{error}</p>
              {reference && <small>Reference: {reference}</small>}
              <button className="cc-primary" onClick={() => void initialize()}>
                Try again
              </button>
            </div>
          ) : isAdmin && view === "admin" ? (
            <WorkspaceControls key="global-administration" guildId="" cards={[]} scopes={["admin"]} view="admin" />
          ) : !guilds.length ? (
            <div className="cc-state">
              <Icon name="shield" />
              <h1>No server access yet</h1>
              <p>
                You need to own or manage an approved server, or have a staff
                role assigned to this dashboard.
              </p>
              <button className="cc-primary" onClick={() => void initialize()}>
                Check access again
              </button>
            </div>
          ) : (
            <>
              <div className="cc-page-heading">
                <div>
                  <p>{guilds.find((g) => g.guildId === guild)?.name}</p>
                  <h1>
                    {view === "overview"
                      ? "Your kingdom, at a glance."
                      : NAV.find((n) => n.id === view)?.label}
                  </h1>
                  <span>
                    {view === "overview"
                      ? "Keep an eye on the bots that keep your community moving."
                      : view === "bots"
                        ? "Inspect the services assigned to this server."
                        : view === "incidents"
                          ? "Recent security events recorded for this server."
                          : "Recent configuration changes recorded for this server."}
                  </span>
                </div>
                <button
                  className="cc-refresh"
                  disabled={busy}
                  onClick={() => void refresh(guild)}
                >
                  <Icon name="refresh" />
                  {busy ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {error && (
                <div className="cc-notice" role="alert">
                  <strong>
                    {data
                      ? "Live update unavailable. Showing the last snapshot."
                      : "This view could not be loaded."}
                  </strong>
                  <p>{error}</p>
                  {reference && <small>Reference: {reference}</small>}
                  <button onClick={() => void refresh(guild)} disabled={busy}>
                    Retry
                  </button>
                </div>
              )}
              {!data && busy ? (
                <div
                  className="cc-skeleton-grid"
                  role="status"
                  aria-label="Loading server overview"
                >
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="cc-skeleton" />
                  ))}
                  <span className="sr-only">Loading server overview…</span>
                </div>
              ) : (
                data && (
                  <>
                    {(view === "configuration" || view === "controls" || view === "admin") && <WorkspaceControls key={`${guild}:${view}`} guildId={guild} cards={data.cards} scopes={[...(data.guild.scopes ?? []), ...(isAdmin ? ["admin"] : [])]} view={view} />}
                    {view === "controls" && data.guild.scopes?.some(scope => ["*", "commerce", "commerce-settle"].includes(scope)) && <CommerceOrders key={`commerce:${guild}`} guildId={guild} scopes={data.guild.scopes ?? []} />}
                    {view === "overview" && (
                      <section
                        className="cc-banner"
                        aria-label="Server overview"
                      >
                        <div className="cc-banner-copy">
                          <span
                            className="cc-badge"
                            data-health={fresh ? "ok" : "unknown"}
                          >
                            <i />
                            {fresh
                              ? "Snapshot current"
                              : "Snapshot needs attention"}
                          </span>
                          <h2>
                            Every thread.
                            <br />
                            <em>Under control.</em>
                          </h2>
                          <p>
                            {data.cards.length
                              ? `${healthy} of ${data.cards.length} bots have fresh, healthy process, gateway and database signals.`
                              : "No bots have been assigned to this server yet."}
                          </p>
                          <div className="cc-banner-stats">
                            <div>
                              <strong>{data.cards.length}</strong>
                              <span>Assigned bots</span>
                            </div>
                            <div>
                              <strong>
                                {securityAllowed ? data.incidents.length : "—"}
                              </strong>
                              <span>Recent incidents</span>
                            </div>
                            <div>
                              <strong>{stamp(data.fetchedAt)}</strong>
                              <span>Last refresh</span>
                            </div>
                          </div>
                        </div>
                        <KafkaScene />
                      </section>
                    )}
                    {(view === "overview" || view === "bots") && (
                      <section className="cc-fleet">
                        <div className="cc-section-heading">
                          <h2>
                            Your bot fleet <span>{data.cards.length}</span>
                          </h2>
                          <p>Updates every 30 seconds</p>
                        </div>
                        {data.stale && (
                          <p className="cc-stale" role="status">
                            Some heartbeats are missing or more than a minute
                            old. Their current health is unknown.
                          </p>
                        )}
                        {cards.length ? (
                          <div className="cc-bot-grid">
                            {cards.map((card) => (
                              <ServiceTile
                                key={card.botKey}
                                card={
                                  error
                                    ? {
                                        ...card,
                                        stale: true,
                                        state: "unknown",
                                        gateway: "unknown",
                                      }
                                    : card
                                }
                                onSelect={(element) => {
                                  detailTrigger.current = element;
                                  setSelected(card);
                                }}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="cc-empty">
                            <Icon name="bots" />
                            <h3>
                              {search ? "No matching bots" : "No bots assigned"}
                            </h3>
                            <p>
                              {search
                                ? "Try a bot name or module."
                                : "Add this server to the bot registry to see its services here."}
                            </p>
                            {search && (
                              <button onClick={() => setSearch("")}>
                                Clear search
                              </button>
                            )}
                          </div>
                        )}
                      </section>
                    )}
                    <div className="cc-feed-grid">
                      {(view === "overview" || view === "incidents") && (
                        <section className="cc-feed">
                          <div className="cc-section-heading">
                            <h2>
                              <Icon name="shield" />
                              Recent incidents
                            </h2>
                            {view === "overview" && securityAllowed && (
                              <button onClick={() => setView("incidents")}>
                                View all
                              </button>
                            )}
                          </div>
                          {!securityAllowed ? (
                            <div className="cc-empty">
                              <p>
                                Your staff role does not include security
                                events.
                              </p>
                            </div>
                          ) : data.incidents.length ? (
                            <ul>
                              {data.incidents.map((i) => (
                                <li key={i.id}>
                                  <span className="cc-event-dot" />
                                  <div>
                                    <strong>
                                      {i.kind.replaceAll("-", " ")}
                                    </strong>
                                    <span>{i.severity} severity</span>
                                  </div>
                                  <time dateTime={i.createdAt}>
                                    {stamp(i.createdAt)}
                                  </time>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="cc-empty">
                              <Icon name="shield" />
                              <h3>No recent incidents</h3>
                              <p>
                                No security events have been recorded for this
                                server.
                              </p>
                            </div>
                          )}
                        </section>
                      )}
                      {(view === "overview" || view === "activity") && (
                        <section className="cc-feed">
                          <div className="cc-section-heading">
                            <h2>
                              <Icon name="activity" />
                              Recent actions
                            </h2>
                            {view === "overview" && (
                              <button onClick={() => setView("activity")}>
                                View all
                              </button>
                            )}
                          </div>
                          {data.actions.length ? (
                            <ul>
                              {data.actions.map((a) => (
                                <li key={a.id}>
                                  <span className="cc-event-dot lavender" />
                                  <div>
                                    <strong>{a.key}</strong>
                                    <span>Saved version {a.version}</span>
                                  </div>
                                  <time dateTime={a.changedAt}>
                                    {stamp(a.changedAt)}
                                  </time>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="cc-empty">
                              <Icon name="activity" />
                              <h3>A quiet workspace</h3>
                              <p>
                                Configuration changes will appear here when
                                recorded.
                              </p>
                            </div>
                          )}
                        </section>
                      )}
                    </div>
                  </>
                )
              )}
            </>
          )}
          <footer className="cc-footer">
            <span>
              <Icon name="crown" />
              Built for your community
            </span>
            <span>{user ? "Private staff workspace" : "Ei point"}</span>
          </footer>
        </div>
      </div>
      {selected && (
        <dialog
          open
          className="cc-dialog"
          aria-labelledby="bot-detail-title"
          ref={(el) => {
            if (el && !el.dataset.modal) {
              el.close();
              el.showModal();
              el.dataset.modal = "true";
            }
          }}
          onCancel={() => setSelected(null)}
        >
          <div className="cc-section-heading">
            <h2 id="bot-detail-title">
              {BOT[selected.botKey]?.name ?? selected.botKey}
            </h2>
            <button
              autoFocus
              onClick={() => setSelected(null)}
              aria-label="Close bot details"
            >
              Close
            </button>
          </div>
          <p>
            Health for this service is reported across its process. Module
            assignments below belong to the selected server.
          </p>
          <dl className="cc-detail-signals">
            <div>
              <dt>Process</dt>
              <dd>
                {error || selected.stale ? "Unknown" : label(selected.state)}
              </dd>
            </div>
            <div>
              <dt>Discord gateway</dt>
              <dd>
                {error || selected.stale ? "Unknown" : label(selected.gateway)}
              </dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>
                {error || selected.stale
                  ? "Unknown"
                  : selected.dbReady
                    ? "Ready"
                    : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>
                {error || selected.stale
                  ? "Unknown"
                  : label(selected.provider ?? "unknown")}
              </dd>
            </div>
            <div>
              <dt>Last heartbeat</dt>
              <dd>{stamp(selected.updatedAt)}</dd>
            </div>
          </dl>
          <h3>Assigned modules</h3>
          <p>{selected.modules?.join(", ") || "No modules configured"}</p>
        </dialog>
      )}
    </div>
  );
}
