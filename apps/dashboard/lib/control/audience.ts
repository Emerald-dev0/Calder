/**
 * Who a company broadcast actually reaches.
 *
 * The console has always mailed verified accounts only — `emailVerifiedAt IS
 * NOT NULL` — which is a good default and a bad ceiling: an operator with
 * something genuinely important to say (a price change, a security notice)
 * could not reach the people who signed up and never clicked the confirmation
 * link. Those accounts exist, they chose to be here, and they are exactly the
 * ones most likely to need telling.
 *
 * So the audience is now a choice, made explicitly per send, with the wider
 * option carrying its cost in the open: an unverified address is more likely to
 * bounce, and a bounce is charged to Calder's sending reputation, not just to
 * that send. Nothing here decides anything — it names the options and the
 * default, and the server re-derives the default from the submitted form.
 */

import { isNotNull, type SQL } from "drizzle-orm";
import { users } from "@calder/db";

export type AudienceScope = "verified" | "everyone";

export const DEFAULT_AUDIENCE: AudienceScope = "verified";

export interface AudienceOption {
  value: AudienceScope;
  label: string;
  description: string;
}

export const AUDIENCE_OPTIONS: AudienceOption[] = [
  {
    value: "verified",
    label: "Verified accounts only",
    description:
      "People who confirmed their address. The default, and the one to use for anything marketing-adjacent.",
  },
  {
    value: "everyone",
    label: "Every account, including unverified addresses",
    description:
      "Adds accounts that signed up but never confirmed. Use for account-level news — billing, security, breaking changes — not for campaigns.",
  },
];

/** Unknown or absent values fall back to the narrow audience, never the wide one. */
export function parseAudience(
  value: FormDataEntryValue | string | null | undefined
): AudienceScope {
  return value === "everyone" ? "everyone" : DEFAULT_AUDIENCE;
}

/**
 * The wider audience needs its own acknowledgement.
 *
 * Not ceremony: the checkbox is the difference between "I clicked the first
 * button" and "I know some of these addresses may not exist, and I am choosing
 * to spend reputation anyway". The server requires it; the form cannot send the
 * wide audience without it.
 */
export function requiresUnverifiedConfirmation(scope: AudienceScope): boolean {
  return scope === "everyone";
}

export function audienceLabel(scope: AudienceScope): string {
  return AUDIENCE_OPTIONS.find((option) => option.value === scope)?.label ?? scope;
}

/** One line the operator can check against the counts on screen. */
export function describeAudience(scope: AudienceScope, verified: number, total: number): string {
  const unverified = Math.max(0, total - verified);
  if (scope === "everyone") {
    return unverified > 0
      ? `Mails all ${total} accounts: ${verified} verified and ${unverified} unverified. Hard cap 500 per run.`
      : `Mails all ${total} accounts; every one of them is verified. Hard cap 500 per run.`;
  }
  return unverified > 0
    ? `Mails ${verified} verified accounts and leaves ${unverified} unverified ones out. Hard cap 500 per run.`
    : `Mails all ${verified} accounts — none are unverified. Hard cap 500 per run.`;
}

/**
 * The SQL predicate for a scope, exported so the send action and its tests use
 * the same expression. Returning `undefined` for the wide audience (rather than
 * a tautology) keeps "no filter" explicit in the query, where a reviewer can
 * see it next to the comment explaining why it is safe.
 */
export function audienceFilter(scope: AudienceScope): SQL | undefined {
  return scope === "verified" ? isNotNull(users.emailVerifiedAt) : undefined;
}
