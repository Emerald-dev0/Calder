import { describe, it, expect } from "vitest";
import {
  extractVariables,
  normaliseVariables,
  pickSendableVersion,
  renderTemplate,
  validateForPublish,
  type TemplateStatus,
  type TemplateVariable,
} from "./template-lifecycle.js";

/**
 * The rule the product promises: a draft exists but cannot be sent, a published
 * version can, and publishing checks the things that would otherwise fail once
 * per recipient.
 */

const content = (
  over: Partial<{ subject: string | null; html: string | null; text: string | null }> = {}
) => ({
  subject: "Hello {{name}}",
  html: "<p>Hi {{name}}</p>",
  text: "Hi {{name}}",
  ...over,
});

const declared = (...names: string[]): TemplateVariable[] =>
  names.map((name) => ({ name, required: true }));

describe("extractVariables", () => {
  it("finds every placeholder across subject, html and text, deduped and sorted", () => {
    expect(
      extractVariables("Hi {{name}}", "<p>{{name}} — {{ code }}</p>", "{{user.email}}")
    ).toEqual(["code", "name", "user.email"]);
  });

  it("tolerates whitespace and ignores braces that are not placeholders", () => {
    // `{{{raw}}}` contains a real `{{raw}}` starting at the second brace, so it
    // is a placeholder with a literal `{` in front of it. Pinned deliberately:
    // the extractor and the renderer must agree on this, or a template would
    // declare one set of variables and send another.
    expect(extractVariables("{{ name }}", "{{{raw}}}", "{{}}", "{{ not valid }}")).toEqual([
      "name",
      "raw",
    ]);
    const rendered = renderTemplate({ subject: "s", html: "{{{raw}}}", text: null }, { raw: "v" });
    expect(rendered.html).toBe("{v}");
  });
});

describe("normaliseVariables", () => {
  it("accepts strings and objects, defaulting to required", () => {
    expect(normaliseVariables(["name", { name: "code", required: false }])).toEqual([
      { name: "code", required: false },
      { name: "name", required: true },
    ]);
  });

  it("drops anything that could not be a placeholder name", () => {
    expect(normaliseVariables(["ok", "bad name", "{{braces}}", 42, null, { name: 7 }])).toEqual([
      { name: "ok", required: true },
    ]);
  });

  it("is empty for a non-array", () => {
    expect(normaliseVariables({ name: "x" })).toEqual([]);
    expect(normaliseVariables(undefined)).toEqual([]);
  });
});

describe("validateForPublish", () => {
  it("passes a complete template whose placeholders are declared", () => {
    expect(validateForPublish(content(), declared("name"))).toEqual([]);
  });

  it("refuses an empty subject — that is a spam signal, not a style choice", () => {
    const problems = validateForPublish(content({ subject: "   " }), declared("name"));
    expect(problems.map((p) => p.code)).toContain("no_subject");
  });

  it("refuses a template with no body at all", () => {
    const problems = validateForPublish(content({ html: null, text: null }), declared("name"));
    expect(problems.map((p) => p.code)).toContain("no_body");
  });

  it("accepts text-only and html-only templates", () => {
    expect(validateForPublish(content({ html: null }), declared("name"))).toEqual([]);
    expect(validateForPublish(content({ text: null }), declared("name"))).toEqual([]);
  });

  it("names every undeclared placeholder, because callers cannot guess them", () => {
    const problems = validateForPublish(
      content({ html: "<p>{{name}} {{first_name}} {{unsubscribe_url}}</p>" }),
      declared("name")
    );
    const undeclared = problems.find((p) => p.code === "undeclared_variable");
    expect(undeclared?.variables).toEqual(["first_name", "unsubscribe_url"]);
    expect(undeclared?.message).toContain("first_name");
  });

  it("does not require every declared variable to be used", () => {
    // A declared-but-unused variable is dead weight, not a failure to publish.
    expect(validateForPublish(content(), declared("name", "optional_extra"))).toEqual([]);
  });

  it("uses preview data to catch what the declaration cannot", () => {
    const problems = validateForPublish(content(), declared("name"), {});
    expect(problems.map((p) => p.code)).toContain("missing_preview_variable");
    // The message has to name the variable: "missing variable" alone is a hunt.
    expect(problems.find((p) => p.code === "missing_preview_variable")?.message).toContain("name");
  });

  it("treats an empty preview value as a problem, because that is what recipients see", () => {
    const problems = validateForPublish(content(), declared("name"), { name: "  " });
    expect(problems.map((p) => p.code)).toContain("empty_preview_variable");
  });

  it("does not demand preview data for optional variables", () => {
    const problems = validateForPublish(
      content({ html: "<p>{{name}}{{nickname}}</p>" }),
      [
        { name: "name", required: true },
        { name: "nickname", required: false },
      ],
      { name: "Ada" }
    );
    expect(problems).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("substitutes everywhere and reports nothing missing", () => {
    const out = renderTemplate(content(), { name: "Ada" });
    expect(out.subject).toBe("Hello Ada");
    expect(out.html).toBe("<p>Hi Ada</p>");
    expect(out.text).toBe("Hi Ada");
    expect(out.missing).toEqual([]);
  });

  it("leaves an unfilled placeholder visible and names it", () => {
    // A real send refuses on `missing`; the preview shows the braced text so the
    // customer can see exactly which value is absent.
    const out = renderTemplate(content(), {});
    expect(out.html).toBe("<p>Hi {{name}}</p>");
    expect(out.missing).toEqual(["name"]);
  });

  it("preserves null bodies rather than inventing empty ones", () => {
    const out = renderTemplate({ subject: "s", html: null, text: "t" }, {});
    expect(out.html).toBeNull();
    expect(out.text).toBe("t");
  });

  it("does not interpret substituted values as templates", () => {
    const out = renderTemplate({ subject: "x", html: "{{a}}", text: null }, { a: "{{b}}" });
    expect(out.html).toBe("{{b}}");
    expect(out.missing).toEqual([]);
  });
});

describe("pickSendableVersion", () => {
  const v = (status: TemplateStatus, publishedAt: string | null, id: string = status) => ({
    id,
    status,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
  });

  it("returns null when nothing has been published — a draft is not sendable", () => {
    expect(pickSendableVersion([v("draft", null, "v1"), v("draft", null, "v2")])).toBeNull();
  });

  it("ignores drafts newer than the published version", () => {
    const picked = pickSendableVersion([
      v("published", "2026-01-01T00:00:00Z", "v1"),
      v("draft", null, "v2"),
    ]);
    expect(picked?.id).toBe("v1");
  });

  it("takes the newest published version after a publish", () => {
    const picked = pickSendableVersion([
      v("published", "2026-01-01T00:00:00Z", "v1"),
      v("draft", null, "v2"),
      v("published", "2026-02-01T00:00:00Z", "v3"),
    ]);
    expect(picked?.id).toBe("v3");
  });

  it("tolerates a published version with no timestamp (backfilled data)", () => {
    const picked = pickSendableVersion([
      v("published", null, "v1"),
      v("published", "2026-02-01T00:00:00Z", "v2"),
    ]);
    expect(picked?.id).toBe("v2");
  });
});
