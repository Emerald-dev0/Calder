"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { confirmPaymentAction } from "./actions";

type State =
  | { kind: "pending"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "warn"; message: string };

/**
 * Paystack sends the customer back with `?reference=` (and `trxref=`). Arriving
 * here proves nothing: this asks the API, which asks Paystack server-side, and
 * only then refreshes the page so the plan and credit figures are real.
 *
 * Runs once per reference. A refresh, a duplicate webhook or a lost
 * confirmation is harmless because fulfilment is idempotent server-side.
 */
export function PaymentReturnNotice({
  projectId,
  reference,
}: {
  projectId: string;
  reference: string;
}) {
  const router = useRouter();
  const started = React.useRef(false);
  const [state, setState] = React.useState<State>({
    kind: "pending",
    message: "Confirming this payment with Paystack…",
  });

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    confirmPaymentAction(projectId, reference)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setState({ kind: "ok", message: result.message });
          router.refresh();
          return;
        }
        setState({ kind: "warn", message: result.message });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          kind: "warn",
          message:
            "Could not confirm this payment just now. If money left your account it will be applied automatically once Paystack reports it — refreshing this page is always safe.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, reference, router]);

  const tone =
    state.kind === "ok"
      ? "var(--color-success, var(--color-accent))"
      : state.kind === "warn"
        ? "var(--color-warning)"
        : "var(--color-muted)";

  return (
    <section
      className="ds-card"
      style={{ marginBottom: 20 }}
      role="status"
      aria-live="polite"
      aria-label="Payment confirmation"
    >
      <div className="ds-card-body" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {state.kind === "pending" ? (
          <Loader2 size={16} className="ds-spin" style={{ flex: "none", marginTop: 2 }} />
        ) : state.kind === "ok" ? (
          <CheckCircle2 size={16} style={{ flex: "none", marginTop: 2, color: tone }} />
        ) : (
          <TriangleAlert size={16} style={{ flex: "none", marginTop: 2, color: tone }} />
        )}
        <div>
          <p style={{ margin: 0, color: tone }}>{state.message}</p>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-muted)" }}>
            Reference <span className="mono">{reference}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
