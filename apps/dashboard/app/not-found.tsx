import { PageArt } from "../components/page-art";

export default function NotFound() {
  return (
    <section className="ei-page-layout" aria-label="Page not found">
      <div className="ei-page-body">
        <p>Page not found</p>
        <h1>
          A loose
          <br />
          thread.
        </h1>
        <p className="lede">
          This page does not exist, or its link has changed. Head back to Ei
          point to find your next step.
        </p>
        <p>
          <a className="ei-action" href="/">
            Return to Ei point
          </a>{" "}
          <a href="/help">Help &amp; FAQ ↗</a>
        </p>
      </div>
      <PageArt src="/art/kafka-floral.png" caption="Find your way back." />
    </section>
  );
}
