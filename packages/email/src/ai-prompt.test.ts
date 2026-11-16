import { describe, it, expect } from "vitest";
import { buildTemplatePrompt, type PromptTemplateFacts } from "./ai-prompt.js";

/**
 * The copied prompt.
 *
 * Two properties matter and both are easy to lose: it must be *deterministic*
 * (the same template always produces the same text, or two people comparing
 * notes get different answers) and it must contain only facts we hold. A prompt
 * that invents a variable name produces a template that fails at send time.
 */

const facts = (over: Partial<PromptTemplateFacts> = {}): PromptTemplateFacts => ({
  name: "Password reset",
  alias: "password-reset",
  subject: "Reset your password",
  description: "Sent when someone asks to reset their password.",
  hasHtml: true,
  hasText: true,
  variables: [
    { name: "reset_url", required: true },
    { name: "name", required: true },
    { name: "expires_in", required: false },
  ],
  sendingDomain: "calder.test",
  branded: false,
  ...over,
});

describe("buildTemplatePrompt", () => {
  it("names the template's own facts, not a generic brief", () => {
    const prompt = buildTemplatePrompt(facts());
    expect(prompt).toContain("Password reset");
    expect(prompt).toContain("password-reset");
    expect(prompt).toContain("Sent when someone asks to reset their password.");
    expect(prompt).toContain("calder.test");
  });

  it("lists every declared variable, marking which are required", () => {
    const prompt = buildTemplatePrompt(facts());
    expect(prompt).toContain("`reset_url` (required)");
    expect(prompt).toContain("`name` (required)");
    expect(prompt).toContain("`expires_in` (optional)");
  });

  it("forbids variables it does not list, because they cannot be supplied", () => {
    expect(buildTemplatePrompt(facts())).toContain(
      "Do not introduce a variable that is not on this list"
    );
  });

  it("says so when a template declares no variables", () => {
    const prompt = buildTemplatePrompt(facts({ variables: [] }));
    expect(prompt).toContain("declares no variables");
    expect(prompt).not.toContain("must not rename");
  });

  it("includes a send example whose variables match the declaration exactly", () => {
    const prompt = buildTemplatePrompt(facts());
    expect(prompt).toContain('"template": "password-reset"');
    for (const name of ["reset_url", "name", "expires_in"]) {
      expect(prompt).toContain(`"${name}":`);
    }
  });

  it("mentions the automatic footer only when the plan adds one", () => {
    expect(buildTemplatePrompt(facts({ branded: true }))).toContain("Sent with Calder");
    expect(buildTemplatePrompt(facts({ branded: false }))).not.toContain("Sent with Calder");
  });

  it("is byte-identical across calls, and stable when variables arrive unsorted", () => {
    const a = buildTemplatePrompt(facts());
    const b = buildTemplatePrompt(facts());
    expect(a).toBe(b);

    const sorted = buildTemplatePrompt(
      facts({
        variables: [
          { name: "name", required: true },
          { name: "reset_url", required: true },
        ],
      })
    );
    const reversed = buildTemplatePrompt(
      facts({
        variables: [
          { name: "reset_url", required: true },
          { name: "name", required: true },
        ],
      })
    );
    expect(sorted).toBe(reversed);
  });

  it("does not leak anything secret-shaped: no keys, no tokens, no internal ids", () => {
    const prompt = buildTemplatePrompt(facts());
    expect(prompt).not.toMatch(/calder_(sk|test)_/);
    expect(prompt).not.toMatch(/tpl_[a-z0-9]{10,}/);
    expect(prompt).not.toContain("sk_live");
  });

  it("copes with a template that has nothing but a name", () => {
    const prompt = buildTemplatePrompt({
      name: "Untitled",
      alias: null,
      subject: null,
      hasHtml: false,
      hasText: false,
      variables: [],
    });
    expect(prompt).toContain("Untitled");
    expect(prompt).toContain("(No description was recorded for it.)");
    expect(prompt).toContain("(empty)");
    expect(prompt).toContain("none yet");
  });
});
