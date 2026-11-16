/**
 * Catalogue previews, for operators only.
 *
 * F-05: the customer page rendered any catalogue entry via `?preview=`, with
 * our real layout, our footer and our unsubscribe link. That is a phishing
 * kit handed out per template id — "your payment failed, update your card
 * here" in exactly the mail we would send. Previews belong where the
 * catalogue belongs: behind `requireSection("communications")`.
 *
 * The guard takes the audience as a parameter rather than trusting the caller
 * to have checked, so a customer-audience call can never resolve an id even if
 * a route forgets a check. Unknown ids resolve to nothing for everybody.
 */
import { COMPANY_EMAIL_IDS, companyEmailDefinition } from "@calder/notify";
import type { CompanyEmailId } from "@calder/notify";

export type PreviewAudience = "operator" | "customer";

export function resolveCataloguePreview(input: {
  id: string | null | undefined;
  audience: PreviewAudience;
}): CompanyEmailId | null {
  if (input.audience !== "operator") return null;
  const id = typeof input.id === "string" ? input.id : "";
  return (COMPANY_EMAIL_IDS as readonly string[]).includes(id) ? (id as CompanyEmailId) : null;
}

/**
 * Obvious stand-ins for a preview, derived from the catalogue's `data` list.
 * Deliberately fake: a preview that looks like a real receipt would be worse
 * than one that looks like a form.
 */
export function previewSampleData(id: CompanyEmailId): Record<string, string> {
  const definition = companyEmailDefinition(id);
  const out: Record<string, string> = {};
  for (const key of definition?.data ?? []) {
    if (/code/i.test(key)) out[key] = "123456";
    else if (/url|link/i.test(key)) out[key] = "https://app.calder.click/settings";
    else if (/amount/i.test(key)) out[key] = "₦5,000";
    else if (/percent/i.test(key)) out[key] = "80";
    else if (/when|date|on$|On$/.test(key)) out[key] = "12 March 2026";
    else if (/name/i.test(key)) out[key] = "Ada Lovelace";
    else if (/email/i.test(key)) out[key] = "ada@example.com";
    else out[key] = "Sample";
  }
  return out;
}
