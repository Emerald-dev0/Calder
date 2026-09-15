"use client";

import * as React from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
const API_MISSING = "The signup service isn't configured yet. Please try again in a little while.";
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
  | { kind: "ticket"; ticket: Ticket; fresh: boolean; name: string | null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE) throw new Error(API_MISSING);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Could not reach the signup service. Check your connection and retry.");
  }
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.data) {
    throw new Error(json?.error?.message ?? `Request failed (${res.status}).`);
  }
  return json.data;
}

function SuccessState({
  name,
  fresh,
  email,
}: {
  name: string | null;
  fresh: boolean;
  email: string;
}) {
  return (
    <div className="ticket">
      <p className="eyebrow">You&rsquo;re in · Calder</p>
      <h3 style={{ margin: "0.6rem 0 0", fontSize: "1.5rem", letterSpacing: "-0.02em" }}>
        {fresh && name ? `Welcome aboard, ${name}.` : "Welcome back."}
      </h3>
      <p className="caption" style={{ marginTop: "1rem" }}>
        You&rsquo;re officially on the Calder list.
      </p>
      <p className="caption">
        We&rsquo;re building something we&rsquo;re genuinely excited about, and you&rsquo;ll be
        hearing from us as it takes shape.
      </p>
      <p className="caption">
        Over the coming days and weeks, our founder and the Calder team may drop into your inbox
        with product updates, things we&rsquo;re working on, and a few behind-the-scenes looks at
        what&rsquo;s coming.
      </p>
      <p className="caption">Thanks for getting here early.</p>
      <p className="caption">We&rsquo;ll see you around.</p>
      <p className="caption ticket-fine">— The Calder Team · Signed up as {email}</p>
    </div>
  );
}

/**
 * Waitlist signup: first name + email in, confirmation out. Returning
 * visitors (localStorage) get their confirmation back via the position
 * lookup. Referral codes arrive as ?ref=CODE and are attached to the join
 * silently, there is no referral UI.
 */
export function WaitlistForm({ idPrefix = "waitlist" }: { idPrefix?: string }) {
  const [firstName, setFirstName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<State>({ kind: "idle" });
  const [total, setTotal] = React.useState<number | null>(null);

  // Live total for the hero counter. Hidden if the API is unreachable.
  React.useEffect(() => {
    api<{ total: number }>("/v1/waitlist/count")
      .then((d) => setTotal(d.total))
      .catch(() => setTotal(null));
  }, []);

  // Returning visitor: restore confirmation silently.
  React.useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    setEmail(saved);
    api<Ticket>(`/v1/waitlist/position?email=${encodeURIComponent(saved)}`)
      .then((ticket) => setState({ kind: "ticket", ticket, fresh: false, name: null }))
      .catch(() => localStorage.removeItem(STORAGE_KEY));
  }, []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const clean = email.toLowerCase().trim();
    const name = firstName.trim();
    if (!name) {
      setState({ kind: "error", message: "Tell us your first name so we know what to call you." });
      return;
    }
    if (!clean.includes("@")) {
      setState({ kind: "error", message: "That email doesn't look valid." });
      return;
    }
    setState({ kind: "sending" });
    const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
    try {
      const ticket = await api<Ticket>("/v1/waitlist", {
        method: "POST",
        body: JSON.stringify({ email: clean, first_name: name, ref }),
      });
      localStorage.setItem(STORAGE_KEY, clean);
      setTotal(ticket.total);
      setState({ kind: "ticket", ticket, fresh: ticket.joined, name });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  if (state.kind === "ticket") {
    return (
      <div className="waitlist-zone" data-total={total ?? undefined}>
        <SuccessState name={state.name} fresh={state.fresh} email={state.ticket.email} />
      </div>
    );
  }

  const errorId = `${idPrefix}-error`;
  return (
    <div className="waitlist-zone" data-total={total ?? undefined}>
      <form className="waitlist-form" onSubmit={(e) => void join(e)}>
        <label className="caption" htmlFor={`${idPrefix}-firstname`}>
          First name
        </label>
        <div className="waitlist-row" style={{ marginBottom: "0.8rem" }}>
          <input
            id={`${idPrefix}-firstname`}
            name="first-name"
            type="text"
            required
            autoComplete="given-name"
            maxLength={120}
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Your first name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={state.kind === "sending"}
          />
        </div>
        <label className="caption" htmlFor={`${idPrefix}-email`}>
          Email address
        </label>
        <div className="waitlist-row">
          <input
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={320}
            aria-describedby={state.kind === "error" ? errorId : undefined}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={state.kind === "sending"}
          />
          <button className="btn btn-primary" type="submit" disabled={state.kind === "sending"}>
            {state.kind === "sending" ? "Reserving…" : "Join the waitlist →"}
          </button>
        </div>
        {state.kind === "error" && (
          <p id={errorId} className="waitlist-error" role="alert">
            {state.message}
          </p>
        )}
        <p className="caption ticket-fine" style={{ marginTop: "0.8rem" }}>
          We&rsquo;ll send occasional Calder updates, product news, and early access invitations.
          You can unsubscribe anytime.
        </p>
      </form>
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
