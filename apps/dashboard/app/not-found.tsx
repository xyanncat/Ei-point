import Link from "next/link";

export default function NotFound() {
  return (
    <section className="world-section world-shell" aria-label="Page not found">
      <div className="world-page">
        <p className="world-eyebrow">404</p>
        <h1 className="world-title">
          Nothing
          <br />
          here yet.
        </h1>
        <p className="world-lede">
          This page does not exist, or it moved somewhere else. The services,
          the docs and your account are all still where you left them.
        </p>
        <div className="world-row" style={{ marginTop: "1.6rem" }}>
          <Link className="ei-action" href="/">
            Back to the start
          </Link>
          <Link className="world-button world-button--ghost" href="/services">
            Browse services
          </Link>
        </div>
      </div>
    </section>
  );
}
