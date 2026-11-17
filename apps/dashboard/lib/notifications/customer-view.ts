/**
 * What a customer may see about "emails from Calder".
 *
 * The customer page used to render the whole internal catalogue: every
 * template id, its trigger, the facts it interpolates, and a `?preview=`
 * renderer for any of them. That is operator information — it tells an
 * outsider which security mails exist, what they say and which fields drive
 * them, and it exposes a renderer that will happily compose a convincing
 * "your payment failed" mail with our own layout and footer.
 *
 * So the split is structural, not cosmetic:
 *
 *  - the customer surface gets the optional categories (the only ones they can
 *    switch off) and their own send history, and nothing else;
 *  - the catalogue, the triggers, the sample data and previews live behind
 *    `requireSection("communications")` in the Control Plane.
 *
 * `buildCustomerNotificationsView` is the only thing the page is allowed to
 * hand to JSX. It returns a closed shape: no template id, no trigger, no
 * audience, no `data` list. The test asserts that by scanning the serialised
 * payload for those keys and for mandatory template ids, so pasting the
 * catalogue back into this module fails the suite rather than shipping.
 */
import { OPTIONAL_CATEGORY_LIST } from "@calder/notify";
import type { CompanyEmailCategory, EmailPreferencesView } from "@calder/notify";

/** Copy for the categories a person can actually act on. */
const OPTIONAL_COPY: Partial<Record<CompanyEmailCategory, { title: string; note: string }>> = {
  inbox: {
    title: "Shared inboxes",
    note: "New conversations and replies in shared inboxes you belong to. You can also mute a single inbox in its settings.",
  },
  updates: {
    title: "Product news",
    note: "What shipped. The only kind of mail from us that is purely optional.",
  },
  digest: {
    title: "Monthly recap",
    note: "Your month in numbers — volume, delivery, cost. Optional.",
  },
};

export interface CustomerNoticeCard {
  category: CompanyEmailCategory;
  title: string;
  note: string;
  /** True when the person has switched this category off. */
  disabled: boolean;
}

/** The five columns `listCompanyEmailsForUser` already returns, minus the template id. */
export interface CustomerHistoryRow {
  id: string;
  subject: string;
  status: string;
  at: Date;
}

export interface CustomerNotificationsView {
  cards: CustomerNoticeCard[];
  history: CustomerHistoryRow[];
}

export interface CustomerHistorySource {
  id: string;
  subject: string;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
}

/**
 * The customer page's entire data contract.
 *
 * `history` must already be scoped to the signed-in person by its query
 * (`listCompanyEmailsForUser(userId)`); this function has no parameter for
 * *whose* history to load, because a surface that can name another user is a
 * surface that can leak one.
 */
export function buildCustomerNotificationsView(input: {
  preferences: EmailPreferencesView;
  history: CustomerHistorySource[];
}): CustomerNotificationsView {
  const cards = OPTIONAL_CATEGORY_LIST.map((category) => {
    const copy = OPTIONAL_COPY[category];
    return {
      category,
      // A category that is optional but has no copy is a bug in *this* file,
      // not a reason to print a raw enum at a customer. Name it plainly.
      title: copy?.title ?? humanise(category),
      note: copy?.note ?? "Optional emails in this category.",
      disabled: input.preferences.disabled.includes(category),
    };
  });

  return {
    cards,
    history: input.history.map((row) => ({
      id: row.id,
      subject: row.subject,
      status: row.status,
      at: row.sentAt ?? row.createdAt,
    })),
  };
}

function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
