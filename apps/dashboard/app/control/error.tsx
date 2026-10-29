"use client";

import Link from "next/link";

export default function ControlError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="cp-panel" role="alert" aria-labelledby="control-error-title">
      <div className="cp-panel-body">
        <p className="cp-eyebrow">View unavailable</p>
        <h1 className="cp-title" id="control-error-title">
          We couldn’t load this view
        </h1>
        <p>
          The request failed. These numbers are unavailable, not zero. Retry before making an
          operational decision.
        </p>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="cp-btn" onClick={reset}>
            Retry this view
          </button>
          <Link href="/control">Return to Command Center</Link>
        </div>
      </div>
    </section>
  );
}
