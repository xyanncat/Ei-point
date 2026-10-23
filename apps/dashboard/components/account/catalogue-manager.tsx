"use client";
// The services tab. The operator owns the public catalogue: what a service
// is called, what it costs, what the customer reads, and whether it is
// offered at all. Removing a service deactivates it — orders already paid
// for keep their history.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { PageHeader, Panel, Empty, HealthBadge } from "../staff/ui";
import { Stagger, StaggerItem } from "../motion";

type CatalogueItem = {
  sku: string;
  name: string;
  priceMinor: number;
  currency: string;
  game: string | null;
  category: string | null;
  duration: string | null;
  description: string | null;
  active: boolean;
  updatedAt: string;
};

type Draft = {
  sku: string;
  name: string;
  price: string;
  currency: string;
  game: string;
  category: string;
  duration: string;
  description: string;
  active: boolean;
};

const emptyDraft: Draft = {
  sku: "",
  name: "",
  price: "",
  currency: "INR",
  game: "",
  category: "",
  duration: "",
  description: "",
  active: true,
};

const toDraft = (item: CatalogueItem): Draft => ({
  sku: item.sku,
  name: item.name,
  price: String(item.priceMinor / 100),
  currency: item.currency,
  game: item.game ?? "",
  category: item.category ?? "",
  duration: item.duration ?? "",
  description: item.description ?? "",
  active: item.active,
});

async function mutate<T>(path: string, body: unknown, method: string) {
  const { csrfToken } = await api<{ csrfToken: string }>("/api/auth/csrf");
  return api<T>(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function CatalogueManager() {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ items: CatalogueItem[] }>("/api/admin/catalog");
      setItems(result.items);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The catalogue could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(sku: string, value: Draft) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const priceMinor = Math.round(Number(value.price) * 100);
      if (!Number.isFinite(priceMinor) || priceMinor <= 0)
        throw new Error("Enter a price greater than zero.");
      await mutate(
        `/api/admin/catalog/${encodeURIComponent(sku)}`,
        {
          name: value.name,
          priceMinor,
          currency: value.currency || "INR",
          game: value.game,
          category: value.category,
          duration: value.duration,
          description: value.description,
          active: value.active,
        },
        "PUT",
      );
      setDraft(null);
      setNotice(`${value.name} was saved.`);
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The service could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function create(value: Draft) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const priceMinor = Math.round(Number(value.price) * 100);
      if (!Number.isFinite(priceMinor) || priceMinor <= 0)
        throw new Error("Enter a price greater than zero.");
      await mutate(
        "/api/admin/catalog",
        {
          sku: value.sku,
          name: value.name,
          priceMinor,
          currency: value.currency || "INR",
          game: value.game,
          category: value.category,
          duration: value.duration,
          description: value.description,
          active: value.active,
        },
        "POST",
      );
      setCreating(null);
      setNotice(`${value.name} was added to the catalogue.`);
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The service could not be added.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: CatalogueItem) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await mutate(
        `/api/admin/catalog/${encodeURIComponent(item.sku)}`,
        undefined,
        "DELETE",
      );
      setNotice(`${item.name} was removed from the catalogue.`);
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The service could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const editor = (
    value: Draft,
    onChange: (next: Draft) => void,
    onSubmit: () => void,
    submitLabel: string,
  ) => (
    <form
      className="sf-actions"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="sf-field">
        <span>Service name</span>
        <input
          required
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      <label className="sf-field">
        <span>Price ({value.currency})</span>
        <input
          required
          inputMode="decimal"
          value={value.price}
          onChange={(event) => onChange({ ...value, price: event.target.value })}
        />
      </label>
      <label className="sf-field">
        <span>Game</span>
        <input
          value={value.game}
          onChange={(event) => onChange({ ...value, game: event.target.value })}
        />
      </label>
      <label className="sf-field">
        <span>Category</span>
        <input
          value={value.category}
          onChange={(event) => onChange({ ...value, category: event.target.value })}
        />
      </label>
      <label className="sf-field">
        <span>Duration</span>
        <input
          value={value.duration}
          onChange={(event) => onChange({ ...value, duration: event.target.value })}
        />
      </label>
      <label className="sf-field">
        <span>Description</span>
        <textarea
          rows={3}
          value={value.description}
          onChange={(event) =>
            onChange({ ...value, description: event.target.value })
          }
        />
      </label>
      <label className="sf-check">
        <input
          type="checkbox"
          checked={value.active}
          onChange={(event) =>
            onChange({ ...value, active: event.target.checked })
          }
        />
        <span>Offered on the site</span>
      </label>
      <button className="sf-ghost" disabled={busy} type="submit">
        {submitLabel}
      </button>
    </form>
  );

  return (
    <>
      <PageHeader
        eyebrow="Operator"
        title="Services"
        explain="Everything the customer sees on the services page. A change here is the change they get — the price is the amount charged at checkout."
        actions={
          <button
            className="sf-ghost"
            type="button"
            onClick={() => setCreating({ ...emptyDraft })}
          >
            Add a service
          </button>
        }
      />

      {error ? (
        <p className="world-note world-note--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="world-note world-note--ok" role="status">
          {notice}
        </p>
      ) : null}

      {creating ? (
        <Panel
          title="Add a service"
          detail="The key is permanent once the service has been ordered, so choose it carefully."
        >
          <label className="sf-field">
            <span>Key</span>
            <input
              required
              pattern="[a-z0-9][a-z0-9-]{1,100}"
              value={creating.sku}
              onChange={(event) =>
                setCreating({ ...creating, sku: event.target.value })
              }
            />
          </label>
          {editor(
            creating,
            (next) => setCreating(next),
            () => void create(creating),
            "Add service",
          )}
        </Panel>
      ) : null}

      <Panel
        title="Catalogue"
        detail="Edit a price or a description, or take a service off the site."
      >
        {items.length ? (
          <Stagger className="sf-cards" amount={0.08}>
            {items.map((item) => (
              <StaggerItem key={item.sku}>
                <article className="sf-card">
                  <div className="sf-card__top">
                    <span className="sf-card__mark" aria-hidden="true">
                      {item.name.charAt(0)}
                    </span>
                    <div>
                      <h3 className="sf-card__title">{item.name}</h3>
                      <p className="sf-card__sub">{item.sku}</p>
                    </div>
                  </div>
                  <div className="sf-card__meta">
                    <span className="sf-num">
                      {(item.priceMinor / 100).toLocaleString("en-IN", {
                        style: "currency",
                        currency: item.currency,
                        maximumFractionDigits: 0,
                      })}
                    </span>
                    <HealthBadge
                      health={item.active ? "ok" : "unknown"}
                      text={item.active ? "Offered" : "Withdrawn"}
                    />
                  </div>
                    {draft?.sku === item.sku ? (
                      <div className="sf-card__editor">
                        {editor(
                          draft,
                          (next) => setDraft(next),
                          () => void save(item.sku, draft),
                          "Save changes",
                        )}
                      </div>
                    ) : null}
                  <div className="sf-card__foot">
                    <button
                      className="sf-ghost"
                      type="button"
                      onClick={() =>
                        setDraft(draft?.sku === item.sku ? null : toDraft(item))
                      }
                    >
                      {draft?.sku === item.sku ? "Close" : "Edit"}
                    </button>
                    {item.active ? (
                      <button
                        className="sf-ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(item)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </article>
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <Empty
            title="No services yet"
            detail="Add the first one, or import the archive to seed the catalogue."
          />
        )}
      </Panel>
    </>
  );
}
