import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Suppression — Calder Docs",
  description: "How bounce and complaint suppression works, and why a send might be blocked.",
};

export default function Suppression() {
  return (
    <>
      <h1>Suppression</h1>
      <p className="docs-lede">
        Some addresses must never be emailed again — hard bounces, spam complaints, unsubscribes.
        Suppression enforces that automatically, before every send.
      </p>

      <h2>How it works</h2>
      <p>
        Bounces and complaints reported by providers land on your project&rsquo;s suppression list
        with the reason attached. Every subsequent send checks the list first; a suppressed
        recipient returns a <span className="mono">suppressed</span> error naming the reason and the
        event that caused it.
      </p>

      <h2>Why a send was blocked</h2>
      <p>
        The error message tells you: which address, which reason (bounce, complaint, unsubscribe,
        manual), and when. No silent drops — a blocked send is information, usually pointing at list
        hygiene you should fix upstream.
      </p>

      <h2>Manual entries</h2>
      <p>
        Add addresses manually for compliance requests or caution. Manual entries carry the same
        weight as automatic ones and are reversible from the dashboard with an audit trail of who
        removed what, when.
      </p>
    </>
  );
}
