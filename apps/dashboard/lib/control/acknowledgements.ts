/**
 * Acknowledgement rules for the Support queue.
 *
 * The queue is derived from conditions that are still true, so it has no
 * memory of which ones a person has already looked at. Acknowledging an item
 * records that look — and, importantly, does so on a leash: an
 * acknowledgement is bound to the evidence it was given for, and it lapses on
 * its own.
 *
 * That combination is what keeps the queue honest. "Seen" cannot mean "hidden
 * forever" (the cooldown brings it back), and it cannot mean "hidden whatever
 * happens next" (new evidence reopens it immediately). The alternative — a
 * plain dismissed flag — turns the one page that reports problems into a page
 * that can be emptied by clicking.
 */

import { createHash } from "node:crypto";
import type { TriageItem } from "./triage";

/**
 * How long an acknowledgement holds before the item returns to the queue.
 *
 * A day, because the things in this queue are either fixed quickly or need
 * chasing: a domain that is still unverified tomorrow is a different decision
 * from one that was unverified at 9am, and a deletion that was "handled" three
 * days ago and is now due for purge must not stay quietly buried.
 */
export const ACK_COOLDOWN_HOURS = 24;

/** How much of the digest to keep — 32 hex chars is plenty to compare locally. */
const FINGERPRINT_LENGTH = 32;

/**
 * The condition as it stands, hashed.
 *
 * Identity, kind, severity and evidence: identity says *which* problem, kind
 * says what sort of problem it is, severity catches escalation (a deletion
 * going from "scheduled" to "critical" is a different thing to acknowledge),
 * and evidence carries the specifics (a domain's state, a failure bucket).
 */
export function fingerprintOf(item: TriageItem): string {
  return createHash("sha256")
    .update(`${item.id}|${item.kind}|${item.severity}|${item.evidence}`, "utf8")
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/** One stored acknowledgement, newest first when several exist. */
export interface AckRecord {
  id: string;
  itemId: string;
  fingerprint: string;
  title: string;
  note: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedByEmail: string | null;
  acknowledgedAt: Date;
  reopenedAt: Date | null;
}

export interface AcknowledgedItem {
  item: TriageItem;
  ack: AckRecord;
  /** When the acknowledgement lapses on its own. */
  expiresAt: Date;
}

export interface AckSplit {
  open: TriageItem[];
  acknowledged: AcknowledgedItem[];
}

/** The newest acknowledgement per item: history is append-only, state is the latest row. */
export function latestAcksByItem(records: AckRecord[]): Map<string, AckRecord> {
  const byItem = new Map<string, AckRecord>();
  for (const record of records) {
    const existing = byItem.get(record.itemId);
    if (!existing || record.acknowledgedAt.getTime() > existing.acknowledgedAt.getTime()) {
      byItem.set(record.itemId, record);
    }
  }
  return byItem;
}

export function ackExpiresAt(ack: AckRecord): Date {
  return new Date(ack.acknowledgedAt.getTime() + ACK_COOLDOWN_HOURS * 3_600_000);
}

export type AckVerdict =
  | { acknowledged: false; reason: "none" | "reopened" | "evidence-changed" | "expired" }
  | { acknowledged: true; ack: AckRecord; expiresAt: Date };

/**
 * Is this item still covered by its acknowledgement?
 *
 * Every "no" carries a reason, because the page shows why something came back:
 * an item that reappears with no explanation reads as a bug, and an operator
 * who does not trust the queue stops using it.
 */
export function verdictFor(item: TriageItem, ack: AckRecord | undefined, now: Date): AckVerdict {
  if (!ack) return { acknowledged: false, reason: "none" };
  if (ack.reopenedAt) return { acknowledged: false, reason: "reopened" };
  if (ack.fingerprint !== fingerprintOf(item)) {
    return { acknowledged: false, reason: "evidence-changed" };
  }
  const expiresAt = ackExpiresAt(ack);
  if (expiresAt.getTime() <= now.getTime()) {
    return { acknowledged: false, reason: "expired" };
  }
  return { acknowledged: true, ack, expiresAt };
}

export function splitByAcknowledgement(
  items: TriageItem[],
  records: AckRecord[],
  now: Date
): AckSplit {
  const latest = latestAcksByItem(records);
  const open: TriageItem[] = [];
  const acknowledged: AcknowledgedItem[] = [];
  for (const item of items) {
    const verdict = verdictFor(item, latest.get(item.id), now);
    if (verdict.acknowledged) {
      acknowledged.push({ item, ack: verdict.ack, expiresAt: verdict.expiresAt });
    } else {
      open.push(item);
    }
  }
  return { open, acknowledged };
}

/** Why an acknowledged item is back, in the operator's words. */
export const REOPEN_REASON_LABEL: Record<
  Exclude<AckVerdict, { acknowledged: true }>["reason"],
  string
> = {
  none: "never acknowledged",
  reopened: "reopened by an operator",
  "evidence-changed": "the condition changed since it was acknowledged",
  expired: `the ${ACK_COOLDOWN_HOURS}-hour acknowledgement lapsed`,
};

export function reopenReasonLabel(ack: AckRecord | undefined, now: Date): string | null {
  if (!ack) return null;
  if (ack.reopenedAt) return REOPEN_REASON_LABEL.reopened;
  if (ackExpiresAt(ack).getTime() <= now.getTime()) return REOPEN_REASON_LABEL.expired;
  return null;
}
