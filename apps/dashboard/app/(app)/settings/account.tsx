"use client";

import * as React from "react";
import { Mail } from "lucide-react";
import { requestEmailChange } from "./actions";

/**
 * Change the address on the account.
 *
 * Deliberately boring: one field, one button, and copy that says exactly what
 * will happen. The change is not applied here — this sends a confirmation to
 * the current address, which is the only proof that the person asking still
 * controls the mailbox.
 */
export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  return (
    <form
      action={requestEmailChange}
      style={{ display: "grid", gap: 10, maxWidth: 460 }}
      aria-describedby="email-change-help"
    >
      <label htmlFor="email-change-input" style={{ fontSize: 13, fontWeight: 600 }}>
        New email address
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          id="email-change-input"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={currentEmail}
          className="ds-input"
          style={{ flex: "1 1 240px", minWidth: 200 }}
        />
        <button type="submit" className="ds-btn ds-btn-secondary">
          <Mail size={14} />
          <span>Send confirmation</span>
        </button>
      </div>
      <p
        id="email-change-help"
        style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}
      >
        We email a confirmation link to <b>{currentEmail}</b>, not to the new address. Nothing
        changes until that link is opened, and it expires in one hour.
      </p>
    </form>
  );
}
