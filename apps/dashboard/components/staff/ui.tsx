"use client";
// Shared staff components: page header, panels, attention list, tables, drawer,
// empty/error states. One consistent set per the redesign brief.
import { useEffect, useRef, type ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  explain,
  actions,
}: {
  eyebrow?: string;
  title: string;
  explain?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="sf-head">
      <div className="sf-head-copy">
        {eyebrow ? <p className="sf-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {explain ? <p className="sf-explain">{explain}</p> : null}
      </div>
      {actions ? <div className="sf-head-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  detail,
  actions,
  children,
}: {
  title: string;
  detail?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sf-panel">
      <h2>
        {title}
        {actions ? <span style={{ marginLeft: "auto" }}>{actions}</span> : null}
      </h2>
      {detail ? <p>{detail}</p> : null}
      {children}
    </section>
  );
}

export function HealthBadge({ health, text }: { health: string; text: string }) {
  return (
    <span className="sf-badge" data-health={health}>
      <i />
      {text}
    </span>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="sf-empty">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function Drawer({
  title,
  onClose,
  restore,
  children,
}: {
  title: string;
  onClose: () => void;
  restore?: () => void;
  children: ReactNode;
}) {
  const previous = useRef<Element | null>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    previous.current = document.activeElement;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (restoreRef.current) restoreRef.current();
      else (previous.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <button className="sf-drawer-scrim" aria-label="Close details" onClick={onClose} />
      <aside className="sf-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sf-head">
          <div className="sf-head-copy">
            <h2>{title}</h2>
          </div>
          <div className="sf-head-actions">
            <button className="sf-ghost" autoFocus onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        {children}
      </aside>
    </>
  );
}

export function stamp(value: string | undefined | null) {
  if (!value) return "No heartbeat";
  const time = new Date(value).getTime();
  return time > 0
    ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "No heartbeat";
}

export function stateText(state: string | undefined, stale?: boolean) {
  if (stale) return "Stale";
  return (
    ({ ok: "Healthy", degraded: "Degraded", down: "Offline", unknown: "Unknown" } as Record<string, string>)[
      state ?? "unknown"
    ] ?? "Unknown"
  );
}
