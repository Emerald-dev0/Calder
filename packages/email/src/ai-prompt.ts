/**
 * The "copy AI prompt" text for a template.
 *
 * The point is to let someone paste one block into an assistant and get a
 * *usable* rewrite of this specific template — not a generic "write me an email".
 * So the prompt is built only from facts we actually hold: the template's name,
 * alias, subject, which bodies exist, its declared variables, the sending domain
 * if it has one, and the exact API call that sends it. Nothing is invented, and
 * the same template always produces byte-identical output, because a prompt that
 * drifts between two clicks is a bug report waiting to happen.
 */

export interface PromptTemplateFacts {
  name: string;
  alias: string | null;
  subject: string | null;
  /** What the author said this template is for, if anything. */
  description?: string | null;
  hasHtml: boolean;
  hasText: boolean;
  variables: Array<{ name: string; required: boolean }>;
  /** The domain this project sends from, when it has a verified one. */
  sendingDomain?: string | null;
  /** Whether the free-plan Calder footer is added to this message. */
  branded?: boolean;
}

/** Clause for a variable, spelled the way a sender must pass it. */
function variableLine(name: string, required: boolean): string {
  return `- \`${name}\`${required ? " (required)" : " (optional)"}`;
}

export function buildTemplatePrompt(facts: PromptTemplateFacts): string {
  const variables = facts.variables.slice().sort((a, b) => a.name.localeCompare(b.name));
  const variableNames = variables.map((v) => `{{${v.name}}}`);

  const lines: string[] = [
    `Rewrite the email template "${facts.name}" for a transactional email product.`,
    "",
    "## What this template is",
  ];

  if (facts.description && facts.description.trim()) {
    lines.push(facts.description.trim());
  } else {
    lines.push("(No description was recorded for it.)");
  }

  lines.push("");
  lines.push("## Current state");
  lines.push(`- Alias used at send time: \`${facts.alias ?? "(none)"}\``);
  lines.push(`- Subject: ${facts.subject ? `"${facts.subject}"` : "(empty)"}`);
  lines.push(
    `- Bodies: ${
      [facts.hasHtml ? "HTML" : null, facts.hasText ? "plain text" : null]
        .filter(Boolean)
        .join(" and ") || "none yet"
    }`
  );
  if (facts.sendingDomain) lines.push(`- Sending domain: \`${facts.sendingDomain}\``);
  if (facts.branded) {
    lines.push(
      '- A small "Sent with Calder" footer is appended automatically on this plan; do not include one.'
    );
  }

  lines.push("");
  lines.push(
    variables.length === 0 ? "## Variables" : "## Variables you may use and must not rename"
  );
  if (variables.length === 0) {
    lines.push("This template declares no variables; it must render correctly with none.");
  } else {
    for (const v of variables) lines.push(variableLine(v.name, v.required));
    lines.push("");
    lines.push(
      `Use each one exactly as \`{{name}}\` — for example ${variableNames
        .slice(0, 3)
        .map((n) => `\`${n}\``)
        .join(
          ", "
        )}. Do not introduce a variable that is not on this list: it will not be supplied, and the send will fail.`
    );
  }

  lines.push("");
  lines.push("## What to produce");
  lines.push(
    [
      "1. A subject line under 60 characters that does not use ALL CAPS or exclamation marks.",
      "2. An HTML body and the same content as plain text.",
      "3. Inline styles only, no <style> block and no scripts — several clients strip both.",
      "4. A single clear call to action, and no more than one link besides it.",
      "5. No invented facts: do not add prices, dates, order numbers or names that are not in the variables list.",
      "6. Do not claim a relationship the product does not have (do not call this marketing if it is transactional).",
    ].join("\n")
  );

  lines.push("");
  lines.push("## How it will be sent");
  lines.push(
    [
      "```json",
      "POST /v1/emails",
      JSON.stringify(
        {
          from: facts.sendingDomain ? `noreply@${facts.sendingDomain}` : "sender_<id>",
          to: "recipient@example.com",
          template: facts.alias ?? "<alias>",
          ...(variables.length > 0
            ? {
                variables: Object.fromEntries(variables.map((v) => [v.name, `<${v.name}>`])),
              }
            : {}),
        },
        null,
        2
      ),
      "```",
    ].join("\n")
  );

  return lines.join("\n").trimEnd() + "\n";
}
