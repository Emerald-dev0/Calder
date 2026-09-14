import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Suppression, Calder Docs",
  description: "How bounce and complaint suppression works, and why a send might be blocked.",
};

export default function Suppression() {
  return (
    <>
      <h1>Suppression</h1>
      <p className="docs-lede">
        Addresses that hard-bounced, complained or unsubscribed should never receive mail from you
        again. Calder keeps that list and checks it before every send.
      </p>

      <h2>How it works</h2>
      <p>
        When a provider reports a bounce or a complaint, the address joins your project&rsquo;s
        suppression list with the reason attached. A later send to that address fails with a{" "}
        <span className="mono">suppressed</span> error naming the reason and pointing at the event
        that caused it.
      </p>

      <h2>Why a send was blocked</h2>
      <p>
        The error names the address, the reason (bounce, complaint, unsubscribe, or a manual entry)
        and the date. A blocked send is usually pointing at list hygiene worth fixing upstream, so it
        is reported rather than dropped.
      </p>

      <h2>Manual entries</h2>
      <p>
        You can add addresses yourself, for a compliance request or plain caution. Manual entries
        behave exactly like automatic ones, and removing one records who did it and when.
      </p>
    </>
  );
}
