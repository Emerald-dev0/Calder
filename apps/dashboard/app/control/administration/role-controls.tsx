"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { PlatformRole } from "@calder/db";
import { setPlatformRole } from "./actions";

export function RoleControls({
  userId,
  current,
  assignable,
}: {
  userId: string;
  current: PlatformRole | null;
  assignable: ReadonlyArray<{ readonly role: PlatformRole; readonly label: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState<string | null>(null);
  const request = React.useRef<{ signature: string; key: string } | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const selected = String(form.get("role") ?? "");
    const role = selected === "__revoke" ? null : (selected as PlatformRole);
    const reason = String(form.get("reason") ?? "").trim();
    if (!selected) return;
    const signature = JSON.stringify([userId, role, reason]);
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const outcome = await setPlatformRole(userId, role, reason, request.current.key);
      if (!outcome.ok) {
        setError(outcome.error ?? "Action rejected.");
        return;
      }
      router.refresh();
    } catch {
      setError(
        "The change could not be confirmed. Retry the same request or refresh to inspect current access."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="cp-role-form">
      <label>
        Access change
        <select name="role" className="cp-select" defaultValue="" required disabled={busy}>
          <option value="" disabled>
            Select a role
          </option>
          {assignable.map((item) => (
            <option key={item.role} value={item.role} disabled={current === item.role}>
              {item.label}
            </option>
          ))}
          {current ? <option value="__revoke">Revoke platform access</option> : null}
        </select>
      </label>
      <label>
        Audit reason
        <input
          name="reason"
          className="cp-input"
          required
          minLength={6}
          maxLength={500}
          disabled={busy}
          placeholder="Why is this access needed?"
        />
      </label>
      <label className="cp-role-confirm">
        <input name="confirm" type="checkbox" required disabled={busy} />I reviewed this account and
        access change.
      </label>
      <button className="cp-btn" type="submit" disabled={busy}>
        {busy ? "Applying…" : "Apply access change"}
      </button>
      {error ? (
        <p role="alert" className="cp-role-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
