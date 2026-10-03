import { getConfig } from "@calder/config";

/** Small built-in denylist; deployments may append local abuse-domain intel via config. */
export const BUILTIN_DISPOSABLE_EMAIL_DOMAINS = [
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "anonbox.net",
  "anonymbox.com",
  "binkmail.com",
  "crazymailing.com",
  "deadaddress.com",
  "discard.email",
  "discardmail.com",
  "disposablemail.com",
  "dispostable.com",
  "emailfake.com",
  "emailondeck.com",
  "fake-email.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "hidemail.de",
  "mail.tm",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "mytemp.email",
  "sharklasers.com",
  "spam4.me",
  "temp-mail.io",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempr.email",
  "tempail.com",
  "tempinbox.com",
  "throwawaymail.com",
  "tmail.com",
  "trashmail.com",
  "trashmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "yopmail.org",
] as const;

const BUILTIN_SET = new Set<string>(BUILTIN_DISPOSABLE_EMAIL_DOMAINS);

function canonicalDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || /[\s/@]/.test(trimmed)) return "";
  try {
    // URL applies IDNA normalization consistently with DNS hostnames.
    return new URL(`http://${trimmed}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function configuredDomains(): Set<string> {
  const configured = getConfig().DISPOSABLE_EMAIL_DOMAINS ?? "";
  const extra = configured.split(",").map(canonicalDomain).filter(Boolean);
  return new Set([...BUILTIN_SET, ...extra]);
}

/** Exact domain and any subdomain of a known temporary-mail domain are blocked. */
export function isDisposableEmail(email: string, domains = configuredDomains()): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  const domain = canonicalDomain(email.slice(at + 1));
  if (!domain) return false;
  for (const blocked of domains) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

export class DisposableEmailError extends Error {
  constructor() {
    // Deliberately does not reveal the matched domain or classifier rule.
    super("This email address isn't supported. Use a different email address.");
    this.name = "DisposableEmailError";
  }
}

/** Reject at new-account creation paths; existing sign-in is unaffected. */
export function assertNotDisposableEmail(email: string): void {
  if (isDisposableEmail(email)) throw new DisposableEmailError();
}
