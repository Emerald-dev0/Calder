import { describe, expect, it } from "vitest";
import { COMPANY_EMAIL_IDS, companyEmailDefinition } from "@calder/notify";
import { previewSampleData, resolveCataloguePreview } from "./email-preview";

describe("resolveCataloguePreview", () => {
  it("refuses every catalogue id to a customer audience", () => {
    for (const id of COMPANY_EMAIL_IDS) {
      expect(resolveCataloguePreview({ id, audience: "customer" })).toBeNull();
    }
  });

  it("refuses a customer audience before it looks at the id at all", () => {
    expect(resolveCataloguePreview({ id: undefined, audience: "customer" })).toBeNull();
    expect(resolveCataloguePreview({ id: "", audience: "customer" })).toBeNull();
    expect(resolveCataloguePreview({ id: "not.a.template", audience: "customer" })).toBeNull();
  });

  it("resolves every known id for an operator", () => {
    for (const id of COMPANY_EMAIL_IDS) {
      expect(resolveCataloguePreview({ id, audience: "operator" })).toBe(id);
    }
  });

  it("refuses unknown and empty ids even for an operator", () => {
    expect(resolveCataloguePreview({ id: "billing.refund", audience: "operator" })).toBeNull();
    expect(resolveCataloguePreview({ id: "", audience: "operator" })).toBeNull();
    expect(resolveCataloguePreview({ id: null, audience: "operator" })).toBeNull();
    expect(resolveCataloguePreview({ id: undefined, audience: "operator" })).toBeNull();
  });

  it("does not treat a prefix or a case variant as a known id", () => {
    const id = COMPANY_EMAIL_IDS[0]!;
    expect(resolveCataloguePreview({ id: `${id} `, audience: "operator" })).toBeNull();
    expect(resolveCataloguePreview({ id: id.toUpperCase(), audience: "operator" })).toBeNull();
  });
});

describe("previewSampleData", () => {
  it("fills exactly the facts the template declares", () => {
    for (const id of COMPANY_EMAIL_IDS) {
      const data = previewSampleData(id);
      expect(Object.keys(data).sort()).toEqual(
        [...(companyEmailDefinition(id)?.data ?? [])].sort()
      );
    }
  });

  it("makes codes look like codes and links look like links", () => {
    const data = previewSampleData("account.verification_code");
    for (const [key, value] of Object.entries(data)) {
      if (/code/i.test(key)) expect(value).toBe("123456");
      if (/url|link/i.test(key)) expect(value).toMatch(/^https:\/\//);
    }
  });

  it("never leaves a fact empty, which would render a blank preview", () => {
    for (const id of COMPANY_EMAIL_IDS) {
      for (const value of Object.values(previewSampleData(id))) {
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
