"use client";
// Route error boundary for the public site. Deliberately art-free: if an art
// asset is what failed, the fallback must not depend on one. Functionality
// (orders, verification) is never lost to a render error — the retry and the
// two recovery links keep every working path reachable.
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="ei-home-section" aria-label="Something went wrong">
      <p>Something went wrong</p>
      <h1>
        A thread
        <br />
        snapped.
      </h1>
      <p className="lede">
        This page hit an unexpected error. Your orders and their verification
        links are unaffected — try again, or take one of the routes below.
      </p>
      <p>
        <button className="ei-action" type="button" onClick={() => reset()}>
          Try again
        </button>{" "}
        <a className="ei-action" href="/">
          Return to Ei point
        </a>
      </p>
      <div className="clip-panel">
        <h2>Still stuck?</h2>
        <p>
          Payment and ordering questions are answered in the{" "}
          <a href="/help">help centre</a>; any order can be checked from the{" "}
          <a href="/verify">verification page</a> with its link or token.
        </p>
        {error.digest ? (
          <p>
            <small>Reference: {error.digest}</small>
          </p>
        ) : null}
      </div>
    </section>
  );
}
