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
 * So the audience is a choice made explicitly per send, and there are three:
 *
 *  - `verified` — the default, and the one for anything marketing-adjacent;
 *  - `everyone` — adds unverified addresses, which may not exist, at the cost of
 *    Calder's sending reputation rather than just this run;
 *  - `selected` — the accounts an operator names, because "tell these four
 *    people" is a real need and the alternative was exporting addresses into a
 *    personal mail client.
 *
 * `selected` is deliberately *accounts*, not addresses. A free-text recipient
 * field turns the console into a relay that mails anyone an operator types,
 * with no account, no history and no consent. Naming a person who has no
 * account is refused and the refusal lists them, so nobody believes they
 * reached someone they did not.
 *
 * `audienceWhere` is the consequential function: it is the `WHERE` clause that
 * decides whether mail reaches a person. An empty selection produces a
 * predicate that matches nobody (`false`), not `undefined` — "no filter" here
 * would mean every account, which is the one failure mode that cannot be
 * undone.
 */

import { inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { users } from "@calder/db";

export type AudienceScope = "verified" | "everyone" | "selected";

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
  {
    value: "selected",
    label: "Specific people",
    description:
      "Only the accounts you name below. Addresses that belong to no account are refused and listed, never silently dropped.",
  },
];

/** Unknown or absent values fall back to the narrow audience, never the wide one. */
export function parseAudience(
  value: FormDataEntryValue | string | null | undefined
): AudienceScope {
  if (typeof value !== "string") return DEFAULT_AUDIENCE;
  const trimmed = value.trim();
  if (trimmed === "everyone") return "everyone";
  if (trimmed === "selected") return "selected";
  return DEFAULT_AUDIENCE;
}

/** A single run cannot name more people than it could ever send to. */
export const MAX_SELECTED_ADDRESSES = 500;

/**
 * The operator's address list, as typed.
 *
 * Split on commas, semicolons and any whitespace so a pasted column from a
 * spreadsheet works, lowercased because that is what `users.email` stores and
 * because `Ada@x.com` and `ada@x.com` are one person. Duplicates collapse;
 * malformed entries are kept so they can be *reported* rather than silently
 * ignored — "3 of 5 matched" is useless without knowing which two did not.
 */
export function parseSelectedAddresses(raw: FormDataEntryValue | string | null | undefined): {
  addresses: string[];
  truncated: boolean;
} {
  if (typeof raw !== "string") return { addresses: [], truncated: false };
  const seen = new Set<string>();
  for (const chunk of raw.split(/[\s,;]+/)) {
    const value = chunk.trim().toLowerCase();
    if (value) seen.add(value);
  }
  const all = [...seen];
  return {
    addresses: all.slice(0, MAX_SELECTED_ADDRESSES),
    truncated: all.length > MAX_SELECTED_ADDRESSES,
  };
}

/**
 * The wider audience needs its own acknowledgement.
 *
 * Not ceremony: the checkbox is the difference between "I clicked the first
 * button" and "I know some of these addresses may not exist, and I am choosing
 * to spend reputation anyway". Computed from the recipients actually selected,
 * so it applies to a hand-picked list that happens to include unverified
 * accounts too — the risk is a property of the addresses, not of the menu item
 * that produced them.
 */
export function requiresUnverifiedConfirmation(unverifiedInScope: number): boolean {
  return unverifiedInScope > 0;
}

export function audienceLabel(scope: AudienceScope): string {
  return AUDIENCE_OPTIONS.find((option) => option.value === scope)?.label ?? scope;
}

/** One line the operator can check against the counts on screen. */
export function describeAudience(
  scope: Exclude<AudienceScope, "selected">,
  verified: number,
  total: number
): string {
  const unverified = Math.max(0, total - verified);
  if (scope === "everyone") {
    return unverified > 0
      ? `Mails all ${total} accounts: ${verified} verified and ${unverified} unverified.`
      : `Mails all ${total} accounts; every one of them is verified.`;
  }
  return unverified > 0
    ? `Mails ${verified} verified accounts and leaves ${unverified} unverified ones out.`
    : `Mails all ${verified} accounts — none are unverified.`;
}

/**
 * The same promise for a hand-picked list: how many matched, how many did not,
 * and how many of the matches never confirmed their address.
 */
export function describeSelectedAudience(
  matched: number,
  unverified: number,
  unmatched: number
): string {
  const parts = [
    matched === 1 ? "Mails 1 account." : `Mails ${matched} accounts.`,
    unverified > 0
      ? `${unverified} of them never confirmed their address.`
      : "Every one of them has confirmed their address.",
  ];
  if (unmatched > 0) {
    parts.push(
      unmatched === 1
        ? "1 address belongs to no account and will not be mailed."
        : `${unmatched} addresses belong to no account and will not be mailed.`
    );
  }
  return parts.join(" ");
}

/**
 * The SQL predicate for a scope, exported so the send action, the page and the
 * tests use the same expression.
 *
 * `everyone` returns `undefined` — "no filter" — deliberately, so a reviewer sees
 * it next to the comment explaining why it is safe. `selected` never returns
 * `undefined`: an empty selection is `false`, which matches nobody.
 */
export function audienceWhere(scope: AudienceScope, selectedIds: string[] = []): SQL | undefined {
  if (scope === "verified") return isNotNull(users.emailVerifiedAt);
  if (scope === "everyone") return undefined;
  return selectedIds.length > 0 ? inArray(users.id, selectedIds) : sql`false`;
}
