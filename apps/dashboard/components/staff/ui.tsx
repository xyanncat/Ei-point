"use client";
// Shared staff components: page header, panels, attention list, tables, drawer,
// empty/error states. One consistent set per the redesign brief.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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

/** A server switcher that looks like the site, not the operating system.
 *  A button opens a small animated menu; Escape closes it, focus returns to
 *  the button, and the closed menu is inert. Replaces the native select. */
export function ServerSwitcher({
  label,
  options,
  value,
  onChange,
  suffix,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  suffix?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();
  const current = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  return (
    <div ref={rootRef} className="sf-switcher">
      <span className="sf-switcher__label" id={`${listId}-label`}>
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        className="sf-switcher__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${listId}-label ${listId}-button`}
        id={`${listId}-button`}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="sf-switcher__value">
          {current ? current.name : "Choose a server"}
          {suffix ? <span className="sf-switcher__suffix">{suffix}</span> : null}
        </span>
        <span className="sf-switcher__chevron" aria-hidden="true" data-open={open ? "true" : "false"}>
          ▾
        </span>
      </button>
      <div className="sf-switcher__menu-wrap" data-open={open ? "true" : "false"}>
        <ul
          role="listbox"
          aria-labelledby={`${listId}-label`}
          id={listId}
          className="sf-switcher__menu"
          inert={!open}
        >
          {options.map((option) => {
            const selected = option.id === value;
            return (
              <li key={option.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="sf-switcher__option"
                  data-selected={selected ? "true" : "false"}
                  tabIndex={open ? 0 : -1}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                    buttonRef.current?.focus();
                  }}
                >
                  <span>{option.name}</span>
                  {selected ? (
                    <span className="sf-switcher__check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
