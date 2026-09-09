"use client";

import { useState } from "react";

/** Passwordless entry: email in, one-time link out. No enumeration. */
export function MagicLinkForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (state === "busy") return;
        setState("busy");
        try {
          const res = await fetch("/api/auth/magic-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
          });
          setState(res.ok ? "sent" : "error");
        } catch {
          setState("error");
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          placeholder="you@company.com"
          aria-label="Email address"
          style={{
            flex: 1,
            height: 44,
            border: "1px solid #D4D4D4",
            borderRadius: 10,
            padding: "0 14px",
            fontSize: 15,
          }}
        />
        <button
          type="submit"
          disabled={state === "busy"}
          style={{
            background: "#0B0C0E",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "0 18px",
            fontSize: 15,
            fontWeight: 600,
            cursor: state === "busy" ? "wait" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {state === "busy" ? "Sending" : "Email me a link"}
        </button>
      </div>
      {state === "sent" && (
        <p style={{ fontSize: 13, color: "#16A34A", margin: 0 }}>
          Check your inbox, the link expires in 15 minutes and works once.
        </p>
      )}
      {state === "error" && (
        <p style={{ fontSize: 13, color: "#DC2626", margin: 0 }}>
          Something went wrong. Check the address and try again.
        </p>
      )}
    </form>
  );
}
