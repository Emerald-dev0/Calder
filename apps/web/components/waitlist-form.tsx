"use client";

import * as React from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";
const STORAGE_KEY = "calder-waitlist-email";

interface Ticket {
  email: string;
  position: number;
  total: number;
  referrals: number;
  referralCode: string;
  joined: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string }
  | { kind: "ticket"; ticket: Ticket; fresh: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.data) {
    throw new Error(json?.error?.message ?? `Request failed (${res.status}).`);
  }
  return json.data;
}

function useCountUp(target: number, durationMs = 1200): number {
  const [value, setValue] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function TicketCard({ ticket, fresh }: { ticket: Ticket; fresh: boolean }) {
  const position = useCountUp(ticket.position);
  const [copied, setCopied] = React.useState<"code" | "link" | null>(null);
  const referralLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/waitlist?ref=${ticket.referralCode}`
      : `/waitlist?ref=${ticket.referralCode}`;

  async function copy(text: string, which: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable — still confirm */
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className={`ticket${fresh ? "ticket-in" : ""}`}>
      <div className="ticket-head mono">
        <span>CALDER · EARLY ACCESS</span>
        <span>№ {ticket.referralCode}</span>
      </div>
      <div className="ticket-position">
        <span className="ticket-number mono">#{position.toLocaleString()}</span>
        <span className="ticket-sub">
          {ticket.position === 1
            ? "First in line. Respect."
            : `${(ticket.position - 1).toLocaleString()} ${ticket.position - 1 === 1 ? "person" : "people"} ahead of you · ${ticket.total.toLocaleString()} total`}
        </span>
      </div>
      <div className="ticket-perforation" aria-hidden="true" />
      <div className="ticket-ref">
        <div>
          <p className="caption" style={{ margin: "0 0 4px" }}>
            {ticket.referrals === 0
              ? "Anyone who joins with your link queues behind you — and everyone they bring queues behind them."
              : `${ticket.referrals} ${ticket.referrals === 1 ? "person" : "people"} joined with your link.`}
          </p>
          <p className="mono ticket-link">{referralLink}</p>
        </div>
        <button className="copy-btn light" onClick={() => void copy(referralLink, "link")}>
          {copied === "link" ? "Copied ✓" : "Copy link"}
        </button>
      </div>
      <p className="caption ticket-fine">
        Signed up as {ticket.email} · {fresh ? "welcome aboard" : "welcome back"}
      </p>
    </div>
  );
}

/**
 * Waitlist signup: email in, ticket out. Returning visitors (localStorage)
 * get their ticket back via the position lookup. Referral codes arrive as
 * ?ref=CODE and are attached to the join.
 */
export function WaitlistForm() {
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<State>({ kind: "idle" });
  const [total, setTotal] = React.useState<number | null>(null);

  // Live total for the hero counter. Hidden if the API is unreachable.
  React.useEffect(() => {
    api<{ total: number }>("/v1/waitlist/count")
      .then((d) => setTotal(d.total))
      .catch(() => setTotal(null));
  }, []);

  // Returning visitor: restore ticket silently.
  React.useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    setEmail(saved);
    api<Ticket>(`/v1/waitlist/position?email=${encodeURIComponent(saved)}`)
      .then((ticket) => setState({ kind: "ticket", ticket, fresh: false }))
      .catch(() => localStorage.removeItem(STORAGE_KEY));
  }, []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const clean = email.toLowerCase().trim();
    if (!clean.includes("@")) {
      setState({ kind: "error", message: "That email doesn't look valid." });
      return;
    }
    setState({ kind: "sending" });
    const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
    try {
      const ticket = await api<Ticket>("/v1/waitlist", {
        method: "POST",
        body: JSON.stringify({ email: clean, ref }),
      });
      localStorage.setItem(STORAGE_KEY, clean);
      setTotal(ticket.total);
      setState({ kind: "ticket", ticket, fresh: ticket.joined });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  return (
    <div className="waitlist-zone" data-total={total ?? undefined}>
      {state.kind === "ticket" ? (
        <TicketCard ticket={state.ticket} fresh={state.fresh} />
      ) : (
        <form className="waitlist-form" onSubmit={(e) => void join(e)}>
          <label className="caption" htmlFor="waitlist-email">
            Work email — one seat per address
          </label>
          <div className="waitlist-row">
            <input
              id="waitlist-email"
              type="email"
              required
              autoComplete="email"
              placeholder="ada@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={state.kind === "sending"}
            />
            <button className="btn btn-primary" type="submit" disabled={state.kind === "sending"}>
              {state.kind === "sending" ? "Reserving…" : "Take a number →"}
            </button>
          </div>
          {state.kind === "error" && (
            <p className="waitlist-error" role="alert">
              {state.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/** Live total for hero copy. Renders nothing until the count loads. */
export function WaitlistTotal({ singular, plural }: { singular: string; plural: string }) {
  const [total, setTotal] = React.useState<number | null>(null);
  React.useEffect(() => {
    api<{ total: number }>("/v1/waitlist/count")
      .then((d) => setTotal(d.total))
      .catch(() => setTotal(null));
  }, []);
  if (total === null || total === 0) return null;
  return (
    <span>
      {total.toLocaleString()} {total === 1 ? singular : plural}
    </span>
  );
}
