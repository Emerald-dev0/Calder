"use client";

import * as React from "react";
import { trackForm } from "../lib/analytics";

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
  | { kind: "ticket"; ticket: Ticket; fresh: boolean };

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
      <p className="caption" style={{ margin: "0 0 4px" }}>
        Check your inbox, a confirmation is on its way. In spam? Move it to Primary so you
        don&rsquo;t miss our updates over the coming weeks.
      </p>
      <p className="caption ticket-fine">
        Signed up as {ticket.email} · {fresh ? "welcome aboard" : "welcome back"}
      </p>
    </div>
  );
}

/**
 * Waitlist signup: first name + email in, ticket out. Returning visitors
 * (localStorage) get their ticket back via the position lookup. Referral
 * codes arrive as ?ref=CODE and are attached to the join.
 */
export function WaitlistForm() {
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
    trackForm("start");
    const clean = email.toLowerCase().trim();
    const name = firstName.trim();
    if (!clean.includes("@")) {
      setState({ kind: "error", message: "That email doesn't look valid." });
      return;
    }
    if (name.length === 0) {
      setState({ kind: "error", message: "Tell us your first name so we can greet you properly." });
      return;
    }
    setState({ kind: "sending" });
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref") ?? undefined;
    const utmSource = params.get("utm_source");
    try {
      const ticket = await api<Ticket>("/v1/waitlist", {
        method: "POST",
        body: JSON.stringify({
          email: clean,
          first_name: name,
          ref,
          source: utmSource ?? ref ?? undefined,
        }),
      });
      localStorage.setItem(STORAGE_KEY, clean);
      trackForm("complete");
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
        <div
          className="waitlist-success"
          style={{
            position: "relative",
            overflow: "hidden",
            background: "#FFFFFF",
            border: "1px solid #E5E5E5",
            borderRadius: "16px",
            padding: "2.5rem 2rem",
            textAlign: "center",
          }}
        >
          <div
            style={{ fontSize: "1.75rem", letterSpacing: "0.2em", marginBottom: "1rem" }}
            aria-hidden="true"
          >
            🎉&nbsp;✨&nbsp;🎊
          </div>
          <p className="eyebrow" style={{ color: "var(--accent)", justifyContent: "center" }}>
            YOU&rsquo;RE IN &middot; CALDER
          </p>
          <h2 className="h2" style={{ marginTop: "0.75rem", marginBottom: "0.5rem" }}>
            Welcome aboard, {firstName || "there"}. <span aria-hidden="true">🎉</span>
          </h2>
          <p className="caption" style={{ marginTop: "0.5rem", color: "var(--ink-soft)" }}>
            You&rsquo;re officially on the Calder list.
          </p>
          <div
            style={{
              marginTop: "1.75rem",
              textAlign: "left",
              background: "#F5F4EF",
              border: "1px solid #E5E5E5",
              borderRadius: "12px",
              padding: "1.25rem 1.25rem 1rem",
            }}
          >
            <img
              src="/calder-flyer.png"
              alt="Calder admission ticket"
              width={1122}
              height={1402}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                borderRadius: "8px",
                border: "1px solid #E5E5E5",
                marginBottom: "1rem",
              }}
            />
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: "var(--ink-soft)" }}>
              Your ticket is below — it&rsquo;s also attached to the confirmation email. Save it,
              share it, or just keep it for when we open the doors.
            </p>
          </div>
          <div
            className="lede"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.9rem",
              textAlign: "left",
              marginTop: "1.5rem",
            }}
          >
            <p>
              We&rsquo;re building something we&rsquo;re <strong>genuinely excited</strong> about,
              and you&rsquo;ll be hearing from us <strong>as it takes shape</strong>.
            </p>
            <p>
              Over the coming days and weeks, our founder and the Calder team may drop into your
              inbox with <strong>product updates</strong>, things we&rsquo;re working on, and a few{" "}
              <strong>behind-the-scenes looks</strong> at what&rsquo;s coming.
            </p>
            <p>Thanks for getting here early. We&rsquo;ll see you around. ✨</p>
          </div>
          <div
            style={{
              marginTop: "1.75rem",
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <a
              className="btn btn-primary"
              href="/calder-flyer.png"
              download="Calder-admission.png"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download your ticket 🎟️ →
            </a>
            <a
              className="btn btn-secondary"
              href={`https://calder.click/waitlist?ref=${state.ticket.referralCode}`}
              onClick={(e) => {
                e.preventDefault();
                navigator.clipboard?.writeText(
                  `https://calder.click/waitlist?ref=${state.ticket.referralCode}`
                );
              }}
            >
              Copy referral link
            </a>
          </div>
          <p className="caption" style={{ marginTop: "1.5rem", color: "var(--ink-soft)" }}>
            Check your inbox — your confirmation email is on its way with the ticket attached. In
            spam? Move it to Primary.
          </p>
          <p
            className="caption"
            style={{ marginTop: "1.25rem", fontSize: "1rem", color: "var(--ink)" }}
          >
            &mdash; The Calder Team
          </p>
        </div>
      ) : (
        <form
          className="waitlist-form"
          onSubmit={(e) => void join(e)}
          onFocus={() => trackForm("start")}
        >
          <div className="waitlist-field">
            <label className="caption" htmlFor="waitlist-first-name">
              First name
            </label>
            <input
              id="waitlist-first-name"
              name="first_name"
              type="text"
              required
              autoComplete="given-name"
              maxLength={255}
              placeholder="Your first name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={state.kind === "sending"}
            />
          </div>
          <div className="waitlist-field">
            <label className="caption" htmlFor="waitlist-email">
              Email address
            </label>
            <input
              id="waitlist-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={320}
              aria-invalid={state.kind === "error"}
              aria-describedby={state.kind === "error" ? "waitlist-error" : undefined}
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={state.kind === "sending"}
            />
          </div>
          {state.kind === "error" && (
            <p id="waitlist-error" className="waitlist-error" role="alert">
              {state.message}
            </p>
          )}
          <div className="waitlist-row">
            <button className="btn btn-primary" type="submit" disabled={state.kind === "sending"}>
              {state.kind === "sending" ? "Reserving…" : "Join the waitlist \u2192"}
            </button>
          </div>
          <p className="caption waitlist-legal">
            We&rsquo;ll use your email to send you Calder updates and early access information. You
            can unsubscribe at any time.
          </p>
        </form>
      )}
    </div>
  );
}
