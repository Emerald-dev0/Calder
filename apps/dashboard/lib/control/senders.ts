/**
 * The From line for company mail, and why it is a closed list rather than a
 * text field.
 *
 * Every company email Calder sends today — a verification code, a receipt, an
 * announcement — leaves from one address: `AUTH_EMAIL_FROM`, default
 * `Calder <hello@calder.click>`. That is right for transactional mail and wrong
 * for everything else. A pricing announcement answered at hello@ lands in the
 * same inbox as sign-in notices; a security notice answered at an address nobody
 * reads is worse than one that says where to reply.
 *
 * The tempting fix is "let the operator type a From". That is how a product ends
 * up mailing customers from `support@` on a domain it never verified, or from an
 * address whose replies go nowhere. So the composer offers exactly what the
 * deployment declares in `COMPANY_EMAIL_SENDERS`, plus the transactional sender,
 * and the server refuses anything else. Adding an address is an env change and an
 * SES decision, not a keystroke.
 *
 * Nothing here invents an address. If the list is empty the only entry is the
 * auth sender, and the page says so.
 */

export interface CompanySender {
  /** The address only, lowercased. This is what the provider is handed. */
  email: string;
  /** Display name, when one is configured. */
  name: string | null;
  /** What a `<select>` and the page show: `Name <address>` or the bare address. */
  label: string;
}

/**
 * The identity every Calder email has used until now. Kept as the fallback so a
 * deployment that sets nothing behaves exactly as it did before this file.
 */
export const DEFAULT_AUTH_SENDER = "Calder <hello@calder.click>";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

/** `Name <addr@domain>` or a bare `addr@domain`. Anything else is refused. */
export function parseSenderEntry(raw: string): CompanySender | null {
  const value = raw.trim();
  if (!value) return null;

  // `[\s\S]` on the name: a newline in a display name must reach the name
  // check below (which refuses it) rather than smuggling the address out of the
  // pattern and into the "bare address" branch.
  const angled = value.match(/^([\s\S]*?)<\s*([^<>\s]+)\s*>$/);
  const email = (angled?.[2] ?? value).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;

  const rawName = angled?.[1]?.trim().replace(/^"|"$/g, "");
  // A name containing markup or a newline could break the header; a display name
  // is a courtesy, not a place to be clever.
  const name = rawName && rawName.length <= 64 && !/[\r\n"<>]/.test(rawName) ? rawName : null;

  return { email, name, label: name ? `${name} <${email}>` : email };
}

/**
 * Everything this deployment will let an operator send from, default first.
 *
 * `COMPANY_EMAIL_SENDERS` is a comma-separated list; the auth sender is always
 * appended because it is the one address a working deployment must have. Duplicate
 * addresses collapse, and the first occurrence keeps its position — so putting
 * `Support <support@calder.click>` first in the env var makes it the default.
 */
export function companySenders(env: NodeJS.ProcessEnv = process.env): CompanySender[] {
  const declared = (env.COMPANY_EMAIL_SENDERS ?? "")
    .split(",")
    .map(parseSenderEntry)
    .filter((sender): sender is CompanySender => sender !== null);

  const auth = parseSenderEntry(env.AUTH_EMAIL_FROM ?? DEFAULT_AUTH_SENDER);

  const out: CompanySender[] = [];
  const seen = new Set<string>();
  for (const sender of [...declared, ...(auth ? [auth] : [])]) {
    if (seen.has(sender.email)) continue;
    seen.add(sender.email);
    out.push(sender);
  }
  return out;
}

/** The address a send uses when the operator chooses nothing. */
export function defaultCompanySender(env: NodeJS.ProcessEnv = process.env): CompanySender {
  return (
    companySenders(env)[0] ?? {
      email: "hello@calder.click",
      name: "Calder",
      label: "Calder <hello@calder.click>",
    }
  );
}

/**
 * The sender for the welcome email.
 *
 * `account.welcome` is the one company email whose copy makes a promise about
 * people — "reply to this email, it reaches a person" — so which mailbox that is
 * belongs to the deployment, not to a hard-coded address. A founder's address is
 * the honest From for a welcome note; `hello@` is the honest From for everything
 * automated.
 *
 * The value must be on the declared list. If it is not — a typo, or an address
 * nobody verified at SES — the deployment's default sender is used and the
 * mismatch is logged: refusing to send a welcome email is worse than sending it
 * from the usual address, and pretending the override worked is worse than both.
 */
export function resolveWelcomeSender(env: NodeJS.ProcessEnv = process.env): {
  sender: CompanySender;
  /** The configured value that was not on the list, when there was one. */
  ignored: string | null;
} {
  const wanted = env.COMPANY_WELCOME_FROM?.trim();
  if (!wanted) return { sender: defaultCompanySender(env), ignored: null };

  const found = findCompanySender(wanted, env);
  if (found) return { sender: found, ignored: null };

  // Nothing here logs or throws: this file is pure so the rule can be tested
  // without a build. The caller that sends the welcome email reports the
  // mismatch to the log, where an operator will see it next to the send.
  return { sender: defaultCompanySender(env), ignored: wanted };
}

/**
 * The submitted choice, if it is on the list — otherwise `null`.
 *
 * The action turns `null` into a refusal rather than a fallback: silently sending
 * from a different address than the one on screen is exactly the class of lie
 * this console exists to avoid. The page resolves the same input through the same
 * function, so what is previewed is what is sent.
 */
export function findCompanySender(
  choice: FormDataEntryValue | string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): CompanySender | null {
  if (typeof choice !== "string") return null;
  const wanted = choice.trim().toLowerCase();
  if (!wanted) return null;
  return companySenders(env).find((sender) => sender.email === wanted) ?? null;
}
