import { describe, expect, it } from "vitest";
import {
  COMPANY_EMAIL_IDS,
  COMPANY_EMAILS,
  companyEmailDefinition,
  isOptionalCategory,
} from "../catalogue.js";
import { defaultUrls, renderCompanyEmail } from "./render.js";

const urls = defaultUrls({
  app: "https://calder.click",
  dashboard: "https://app.calder.click",
  preferences: "https://app.calder.click/settings/notifications",
  support: "mailto:support@calder.click",
});

describe("company email catalogue", () => {
  it("has no duplicate ids and every entry is well-formed", () => {
    expect(new Set(COMPANY_EMAIL_IDS).size).toBe(COMPANY_EMAIL_IDS.length);
    for (const [id, def] of Object.entries(COMPANY_EMAILS)) {
      expect(id).toMatch(/^[a-z]+(\.[a-z0-9_]+)+$/);
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.trigger.length).toBeGreaterThan(5);
      expect(def.mandatory).toBe(!isOptionalCategory(def.category));
    }
  });

  it("keeps the mandatory categories mandatory", () => {
    for (const id of ["billing.payment_failed", "account.password_reset_code", "legal.policy_update"] as const) {
      expect(companyEmailDefinition(id)?.mandatory).toBe(true);
    }
    for (const id of ["updates.product_update", "updates.monthly_digest"] as const) {
      expect(companyEmailDefinition(id)?.mandatory).toBe(false);
    }
  });

  it("returns null for an id that is not in the catalogue", () => {
    expect(companyEmailDefinition("billing.nope")).toBeNull();
  });
});

describe("renderCompanyEmail", () => {
  it("renders every catalogue entry to non-empty subject, html and text", () => {
    for (const id of COMPANY_EMAIL_IDS) {
      const out = renderCompanyEmail({ id, data: {}, urls });
      expect(out.subject.length, `${id} subject`).toBeGreaterThan(0);
      expect(out.html.length, `${id} html`).toBeGreaterThan(50);
      expect(out.text.length, `${id} text`).toBeGreaterThan(20);
      expect(out.subject.length, `${id} subject length`).toBeLessThanOrEqual(200);
      expect(out.html).not.toContain("undefined");
      expect(out.html).not.toContain("[object Object]");
    }
  });

  it("escapes interpolated values so a name cannot inject markup", () => {
    const out = renderCompanyEmail({
      id: "organization.invitation",
      data: {
        inviterName: '<script>alert("x")</script>',
        organizationName: "Calder & Co",
        role: "admin",
        acceptUrl: "https://app.calder.click/invite/abc",
      },
      urls,
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("Calder &amp; Co");
    expect(out.subject).toContain("<script>");
    // The subject is a header, never HTML; it stays readable on purpose.
  });

  it("drops a javascript: CTA instead of linking it", () => {
    const out = renderCompanyEmail({
      id: "updates.announcement",
      data: { title: "Hello", body: "Body", ctaLabel: "Click", ctaUrl: "javascript:alert(1)" },
      urls,
    });
    expect(out.html).not.toContain("javascript:");
  });

  it("only offers unsubscribe for opt-out categories", () => {
    const optional = renderCompanyEmail({
      id: "updates.product_update",
      data: { title: "New", body: "Something shipped" },
      urls,
      unsubscribeUrl: "https://calder.click/api/unsubscribe/company?token=t",
    });
    expect(optional.unsubscribable).toBe(true);
    expect(optional.document === "").toBe(true); // lazy unless preview

    const mandated = renderCompanyEmail({
      id: "billing.payment_failed",
      data: { amount: "₦5,000" },
      urls,
      unsubscribeUrl: "https://calder.click/api/unsubscribe/company?token=t",
    });
    expect(mandated.unsubscribable).toBe(false);
    expect(mandated.text).not.toContain("Unsubscribe");
  });

  it("puts the code in both the HTML and the plain-text fallback", () => {
    const out = renderCompanyEmail({
      id: "account.verification_code",
      data: { code: "482913", expiresInMinutes: 10 },
      urls,
    });
    expect(out.subject).toContain("482913");
    expect(out.html).toContain("482913");
    expect(out.text).toContain("482913");
    expect(out.text).toContain("10 minutes");
  });

  it("builds the branded document only when a preview is asked for", () => {
    const out = renderCompanyEmail({
      id: "account.welcome",
      data: { name: "Ada Lovelace" },
      urls,
      preview: true,
    });
    expect(out.document).toContain("<!doctype html>");
    expect(out.document).toContain("Calder");
    expect(out.document).toContain("Ada");
  });

  it("refuses an id the catalogue does not know", () => {
    expect(() =>
      renderCompanyEmail({ id: "billing.unknown" as never, urls })
    ).toThrow(/Unknown company email/);
  });
});
