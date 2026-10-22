"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Radio, RefreshCw } from "lucide-react";
import { countNewMessages } from "./actions";

/**
 * "Live" tail for the message log.
 *
 * There is no SSE/WebSocket channel in this app — the domains page already
 * polls with `setInterval` — so this polls too, at 5s, and calls
 * `router.refresh()` when new rows exist. That keeps the server component the
 * single source of truth: no client-side row merging, no risk of the table and
 * the URL disagreeing.
 *
 * The poll pauses while the tab is hidden so a forgotten background tab does
 * not keep querying, and resumes with an immediate check.
 */
export function LiveToggle({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [live, setLive] = React.useState(false);
  const [pending, setPending] = React.useState(0);
  const [error, setError] = React.useState(false);
  const newestRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!live) {
      setPending(0);
      return;
    }

    let cancelled = false;

    async function tick() {
      if (document.visibilityState !== "visible") return;
      try {
        const result = await countNewMessages(projectId, newestRef.current);
        if (cancelled) return;
        setError(false);
        newestRef.current = result.newestId;
        setPending(result.count);
        if (result.count > 0) router.refresh();
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, projectId, router]);

  return (
    <button
      type="button"
      onClick={() => setLive((v) => !v)}
      className={`ds-btn ${live ? "ds-btn-primary" : "ds-btn-secondary"}`}
      aria-pressed={live}
      title={error ? "Polling failed — retrying" : "Poll for new messages every 5 seconds"}
    >
      {live ? <RefreshCw size={13} /> : <Radio size={13} />}
      <span>{live ? (error ? "Live (retrying)" : "Live") : "Go live"}</span>
      {live && pending > 0 && (
        <span className="tabular-nums" style={{ fontSize: 11 }}>
          +{pending}
        </span>
      )}
    </button>
  );
}
