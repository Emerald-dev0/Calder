import { describe, expect, it } from "vitest";
import {
  DRAFT_BODY_SKELETON,
  PREVIEW_PERSONA,
  displayName,
  draftFromSearchParams,
  mergeFieldsIn,
  mergeFieldsUsed,
  personaliseDraft,
  personalisedEmailData,
  renderDraftPreview,
  validateDraft,
} from "./company-draft";

const good = {
  title: "A change to how limits work",
  body: "Hi {{name}},\n\nWe changed how monthly limits reset. Nothing you need to do.",
};

describe("validateDraft", () => {
  it("accepts a draft that uses only known merge fields", () => {
    const result = validateDraft(good);
    expect(result).toEqual({ ok: true, fields: ["name"] });
  });

  it("names an unknown merge field instead of sending it literally", () => {
    const result = validateDraft({ ...good, body: "Hi {{first_name}}, hello." });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("{{first_name}}");
    expect(result.error).toContain("{{name}}");
  });

  it("refuses a title that is too short or too long", () => {
    expect(validateDraft({ ...good, title: "Hi" }).ok).toBe(false);
    expect(validateDraft({ ...good, title: "x".repeat(121) }).ok).toBe(false);
  });

  it("refuses a body outside the length it can display", () => {
    expect(validateDraft({ ...good, body: "short" }).ok).toBe(false);
    expect(validateDraft({ ...good, body: "x".repeat(1501) }).ok).toBe(false);
  });

  it("refuses a button URL that is not http(s)", () => {
    const result = validateDraft({ ...good, ctaUrl: "javascript:alert(1)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("http");
  });

  it("reports every distinct merge field the draft uses", () => {
    const result = validateDraft({ ...good, ctaLabel: "Tell {{name}}" });
    expect(result).toEqual({ ok: true, fields: ["name"] });
  });
});

describe("merge field parsing", () => {
  it("finds fields regardless of spacing", () => {
    expect(mergeFieldsIn("Hi {{name}} and {{ name }} and {{  name  }}")).toEqual(["name"]);
  });

  it("ignores braces that are not a field", () => {
    expect(mergeFieldsIn("A {literal} and {{}} and {{ two words }}")).toEqual([]);
  });

  it("collects across title, body and button label without duplicates", () => {
    expect(
      mergeFieldsUsed({ title: "For {{name}}", body: "Hi {{name}}", ctaLabel: "As {{name}}" })
    ).toEqual(["name"]);
  });

  it("ships a skeleton that is already valid to preview", () => {
    expect(DRAFT_BODY_SKELETON).toContain("{{name}}");
    expect(
      validateDraft({ title: "Hello there", body: `${DRAFT_BODY_SKELETON}Something shipped.` })
    ).toEqual({
      ok: true,
      fields: ["name"],
    });
  });
});

describe("displayName", () => {
  it("uses the first name only", () => {
    expect(displayName("Daniel Oluwadare")).toBe("Daniel");
  });

  it("falls back to 'there' when there is no name, never to an empty greeting", () => {
    expect(displayName(null)).toBe("there");
    expect(displayName(undefined)).toBe("there");
    expect(displayName("   ")).toBe("there");
  });
});

describe("personaliseDraft", () => {
  it("gives each recipient their own name", () => {
    const daniel = personaliseDraft(good, { name: "Daniel Oluwadare" });
    const ada = personaliseDraft(good, { name: "Ada" });
    expect(daniel.body.startsWith("Hi Daniel,")).toBe(true);
    expect(ada.body.startsWith("Hi Ada,")).toBe(true);
  });

  it("greets a nameless account with 'Hi there,'", () => {
    expect(personaliseDraft(good, { name: null }).body.startsWith("Hi there,")).toBe(true);
  });

  it("substitutes in the subject too, and leaves the URL alone", () => {
    const result = personaliseDraft(
      { ...good, title: "{{name}}, a change", ctaUrl: "https://calder.click/changelog" },
      { name: "Ada" }
    );
    expect(result.title).toBe("Ada, a change");
    expect(result.ctaUrl).toBe("https://calder.click/changelog");
  });

  it("drops an empty button label rather than rendering a blank button", () => {
    expect(
      personaliseDraft({ ...good, ctaLabel: "   " }, { name: "Ada" }).ctaLabel
    ).toBeUndefined();
  });

  it("does not quietly resolve a field validation would have refused", () => {
    const draft = { ...good, body: "Hi {{first_name}}, hello there friend." };
    expect(personaliseDraft(draft, { name: "Ada" }).body).toContain("{{first_name}}");
  });
});

describe("renderDraftPreview", () => {
  it("renders the operator's own words, with the persona's name", () => {
    const preview = renderDraftPreview("updates.announcement", good);
    expect(preview.subject).toBe("A change to how limits work");
    expect(preview.document).toContain("Hi Ada,");
    expect(preview.document).toContain("We changed how monthly limits reset.");
    expect(preview.persona.name).toBe(PREVIEW_PERSONA.name);
  });

  it("uses the real template, so the footer and opt-out line are the ones we send", () => {
    const preview = renderDraftPreview("updates.announcement", good);
    expect(preview.document).toContain("Manage what you receive");
  });

  it("escapes a name that contains markup instead of rendering it", () => {
    const draft = personaliseDraft(good, { name: "<script>alert(1)</script>" });
    // Substitution is literal; the renderer is what escapes it.
    expect(draft.body).toContain("Hi <script>alert(1)</script>,");
    const preview = renderDraftPreview("updates.announcement", {
      ...good,
      body: "Hi <script>alert(1)</script>,\n\nSomething shipped this month.",
    });
    expect(preview.document.toLowerCase()).not.toContain("<script");
  });

  it("renders the changelog template too, not just the announcement", () => {
    const preview = renderDraftPreview("updates.product_update", {
      ...good,
      title: "What shipped in November",
    });
    expect(preview.document).toContain("What shipped in November");
  });
});

describe("draftFromSearchParams", () => {
  it("returns null when there is nothing to preview", () => {
    expect(draftFromSearchParams({})).toBeNull();
    expect(draftFromSearchParams({ template: "updates.announcement" })).toBeNull();
  });

  it("reads back what the GET preview form submitted", () => {
    expect(
      draftFromSearchParams({
        title: "A change",
        body: "Hi {{name}}, hello there friend.",
        ctaLabel: "",
        ctaUrl: "https://calder.click/changelog",
      })
    ).toEqual({
      title: "A change",
      body: "Hi {{name}}, hello there friend.",
      ctaLabel: undefined,
      ctaUrl: "https://calder.click/changelog",
    });
  });
});

describe("personalisedEmailData", () => {
  it("produces the map the sender takes, without empty optional fields", () => {
    const data = personalisedEmailData({ ...good, ctaLabel: "", ctaUrl: "" }, { name: "Ada" });
    expect(data).toEqual({
      title: "A change to how limits work",
      body: expect.stringContaining("Hi Ada,"),
    });
    expect("ctaLabel" in data).toBe(false);
    expect("ctaUrl" in data).toBe(false);
  });

  it("keeps a button when the operator gave one", () => {
    const data = personalisedEmailData(
      { ...good, ctaLabel: "Read it", ctaUrl: "https://calder.click/changelog" },
      { name: "Ada" }
    );
    expect(data.ctaLabel).toBe("Read it");
    expect(data.ctaUrl).toBe("https://calder.click/changelog");
  });
});
