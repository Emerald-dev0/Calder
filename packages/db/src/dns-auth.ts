import { defaultTxtOracle, type TxtOracle } from "./dns-challenge.js";

/**
 * Authentication readiness: is the domain actually allowed to send?
 *
 * Ownership (the `_calder` TXT challenge) and DKIM (SES tokens in
 * `dkim_records`) were the only facts we ever established. SPF and DMARC were
 * printed as copy-paste strings and never looked up, so a domain could read
 * "verified" while its SPF excluded Amazon SES entirely, or while its DMARC
 * policy told receivers to reject everything that failed a check we could not
 * pass. The customer found out from their recipients' spam folders.
 *
 * These are the two checks that can be made from DNS alone, with the reason
 * stated in the customer's terms. Nothing here sends mail, and nothing here
 * treats "no record" as "fine": absent authorisation is the common cause of
 * mail that is accepted and then filtered.
 */

export type AuthState = "pass" | "missing" | "broken" | "warning";

export interface AuthCheck {
  state: AuthState;
  /** One sentence the customer can act on, in their language. */
  detail: string;
  /** The raw records found, exactly as published (empty when none). */
  found: string[];
}

const SES_INCLUDE = "include:amazonses.com";

function txtState(found: string[], state: AuthState, detail: string): AuthCheck {
  return { state, detail, found };
}

/**
 * SPF as RFC 7208 reads it, limited to what can be judged from the apex TXT set.
 *
 * Not evaluated: `include` chains beyond the SES include, `redirect=`, macros,
 * and the 10-lookup limit. Those need a recursive resolver, and pretending to
 * have checked them would be worse than saying which two facts were checked.
 */
export function checkSpf(records: string[]): AuthCheck {
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));

  if (spf.length === 0) {
    return txtState(
      [],
      "missing",
      "No SPF record. Publish a TXT record at the domain root containing " +
        "`v=spf1 include:amazonses.com ~all` — without it, receivers have no " +
        "reason to believe your mail is authorised, and filters treat it as suspect."
    );
  }
  if (spf.length > 1) {
    // RFC 7208 §4.5: more than one SPF record is a permanent error, so this is
    // worse than having none — every message fails SPF outright.
    return txtState(
      spf,
      "broken",
      `This domain publishes ${spf.length} SPF records. Receivers treat that as a ` +
        "permanent error, so every message fails SPF. Merge them into a single " +
        "record that includes the senders you actually use."
    );
  }

  const record = spf[0]!.trim();
  const lower = record.toLowerCase();

  if (/\s\+all(\s|$)/.test(lower) || /^v=spf1\s*\+all$/.test(lower)) {
    return txtState(
      spf,
      "broken",
      "Your SPF record ends in `+all`, which authorises every server on the " +
        "internet to send as this domain. Replace it with `~all` (soft fail) or " +
        "`-all` (hard fail)."
    );
  }

  if (!lower.includes(SES_INCLUDE)) {
    return txtState(
      spf,
      "broken",
      "Your SPF record does not include Amazon SES, so the mail we send for you " +
        `fails SPF. Add \`${SES_INCLUDE}\` to the record.`
    );
  }

  return txtState(spf, "pass", "SPF authorises Amazon SES to send as this domain.");
}

export interface DmarcPolicy {
  policy: "none" | "quarantine" | "reject" | null;
  /** `aspf`/`adkim` alignment mode, `r` (relaxed) unless stated. */
  spfAlignment: "relaxed" | "strict";
  dkimAlignment: "relaxed" | "strict";
  percentage: number;
  /** Subdomain policy when declared. */
  subdomainPolicy: "none" | "quarantine" | "reject" | null;
}

/** Parse a DMARC record. Tolerant by design: unknown tags are ignored. */
export function parseDmarc(record: string): DmarcPolicy {
  const tags = new Map<string, string>();
  for (const part of record.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim().toLowerCase();
    if (!key) continue;
    tags.set(key, rest.join("=").trim().toLowerCase());
  }
  const policyOf = (value: string | undefined) =>
    value === "none" || value === "quarantine" || value === "reject" ? value : null;
  const pct = Number(tags.get("pct"));
  return {
    policy: policyOf(tags.get("p")),
    spfAlignment: tags.get("aspf") === "s" ? "strict" : "relaxed",
    dkimAlignment: tags.get("adkim") === "s" ? "strict" : "relaxed",
    percentage: Number.isFinite(pct) && pct > 0 && pct <= 100 ? Math.floor(pct) : 100,
    subdomainPolicy: policyOf(tags.get("sp")),
  };
}

/**
 * DMARC, including the trap that matters for a provider like SES.
 *
 * With deployment on Amazon SES and no custom MAIL FROM, the envelope
 * return-path is `*.amazonses.com`. That domain passes SPF, but it is not
 * **aligned** with the From domain the customer uses. Under the default relaxed
 * alignment (`aspf=r`) the organisational domains still align, so this works.
 * Under strict alignment (`aspf=s`) it does not: SPF alignment fails, and with
 * `p=reject` or `p=quarantine` the customer's own policy blocks their mail.
 * That is a self-inflicted outage we can see from DNS, so we say it out loud.
 */
export function checkDmarc(records: string[]): AuthCheck {
  const dmarc = records.filter((r) => /^v=dmarc1(\s|;|$)/i.test(r.trim()));

  if (dmarc.length === 0) {
    return txtState(
      [],
      "missing",
      "No DMARC policy. Without one, receivers decide for themselves what to do " +
        "with mail that fails authentication, and you get no reports telling you " +
        "who is sending as your domain. Start at `p=none` to collect data, then " +
        "move to `quarantine` and `reject`."
    );
  }
  if (dmarc.length > 1) {
    return txtState(
      dmarc,
      "broken",
      `This domain publishes ${dmarc.length} DMARC records. Receivers stop at the ` +
        "first one they find, which makes the result unpredictable. Keep exactly one."
    );
  }

  const parsed = parseDmarc(dmarc[0]!.trim());
  if (!parsed.policy) {
    return txtState(
      dmarc,
      "broken",
      "This DMARC record has no valid `p=` policy tag, so receivers ignore it. " +
        "Add `p=none`, `p=quarantine` or `p=reject`."
    );
  }

  const enforcing = parsed.policy === "reject" || parsed.policy === "quarantine";

  if (enforcing && parsed.spfAlignment === "strict") {
    return txtState(
      dmarc,
      "warning",
      `Your policy is \`p=${parsed.policy}\` with strict SPF alignment (\`aspf=s\`), ` +
        "but the return path for mail we send is on amazonses.com. Strict alignment " +
        "means that mail fails SPF alignment and your own policy rejects it. Either " +
        "relax alignment (`aspf=r`) or set a custom MAIL FROM on this domain."
    );
  }

  if (parsed.policy === "none") {
    return txtState(
      dmarc,
      "warning",
      "DMARC is monitoring only (`p=none`). Mail is not rejected on failure, so " +
        "spoofing of this domain is still delivered. Once you trust the reports, " +
        "move to `quarantine` and then `reject`."
    );
  }

  if (parsed.percentage < 100) {
    return txtState(
      dmarc,
      "warning",
      `Only ${parsed.percentage}% of failing mail is subject to your policy ` +
        `(\`pct=${parsed.percentage}\`). The remainder is delivered as if you had no policy.`
    );
  }

  return txtState(
    dmarc,
    "pass",
    `DMARC enforces \`p=${parsed.policy}\` and the alignment mode is compatible with ` +
      "the way this mail is sent."
  );
}

export interface DomainAuthReport {
  spf: AuthCheck;
  dmarc: AuthCheck;
}

/** Look up both records for a domain. A DNS failure is reported as such, never as "pass". */
export async function checkDomainAuth(
  domain: string,
  oracle: TxtOracle = defaultTxtOracle()
): Promise<DomainAuthReport> {
  const [apex, dmarcRecords] = await Promise.all([
    oracle(domain).catch(() => null),
    oracle(`_dmarc.${domain}`).catch(() => null),
  ]);

  const spf = apex === null ? txtState([], "broken", UNREACHABLE) : checkSpf(apex);
  const dmarc =
    dmarcRecords === null ? txtState([], "broken", UNREACHABLE) : checkDmarc(dmarcRecords);
  return { spf, dmarc };
}

const UNREACHABLE =
  "DNS could not be read just now, so this is unknown rather than passing. " +
  "Try again in a moment.";
