import { brandEmail } from "@calder/email";
import { companyEmailDefinition, isOptionalCategory, type CompanyEmailId } from "../catalogue.js";
import {
  button as ctaBlock,
  callout,
  codeBlock,
  detailsTable,
  divider,
  heading,
  linkLine,
  muted,
  paragraph,
} from "./blocks.js";
import { TEMPLATES, type RenderUrls } from "./templates.js";

export interface RenderCompanyEmailInput {
  id: CompanyEmailId;
  data?: Record<string, unknown>;
  urls: RenderUrls;
  /** Present only for opt-out categories. */
  unsubscribeUrl?: string;
  /**
   * Build the full branded document too. Off by default: the delivery path
   * wraps at the boundary and paying for a second `brandEmail` per message is
   * pure cost. Only previews and tests need the standalone document.
   */
  preview?: boolean;
}

export interface RenderedCompanyEmail {
  subject: string;
  /** Inner content only — `brandEmail` wraps it at the delivery boundary. */
  html: string;
  /** Full standalone document. Empty unless `preview` was requested. */
  document: string;
  text: string;
  category: string;
  /** True when the category may be switched off; drives the List-Unsubscribe header. */
  unsubscribable: boolean;
}

export function defaultUrls(overrides: Partial<RenderUrls> = {}): RenderUrls {
  const app = overrides.app ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://calder.click";
  const dashboard = overrides.dashboard ?? process.env.CALDER_DASHBOARD_URL ?? `${app}`;
  return {
    app,
    dashboard,
    preferences: overrides.preferences ?? `${dashboard}/settings/notifications`,
    support: overrides.support ?? "mailto:support@calder.click",
  };
}

function buildText(
  content: ReturnType<(typeof TEMPLATES)[CompanyEmailId]>,
  unsubscribeUrl: string | undefined
): string {
  const lines: string[] = [];
  lines.push(content.heading.toUpperCase(), "");
  for (const p of content.intro) lines.push(p, "");
  if (content.code) lines.push(content.code, content.codeCaption ?? "", "");
  if (content.details?.length) {
    for (const row of content.details) lines.push(`${row.label}: ${row.value}`);
    lines.push("");
  }
  if (content.callout) {
    lines.push(`[${content.callout.title ?? content.callout.tone}] ${content.callout.body}`, "");
  }
  if (content.cta) lines.push(`${content.cta.label}: ${content.cta.url}`, "");
  for (const p of content.outro ?? []) lines.push(p, "");
  if (content.footnote) lines.push(content.footnote, "");
  if (unsubscribeUrl) lines.push(`Unsubscribe: ${unsubscribeUrl}`, "");
  lines.push("—", "Calder · https://calder.click");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function renderCompanyEmail(input: RenderCompanyEmailInput): RenderedCompanyEmail {
  const definition = companyEmailDefinition(input.id);
  if (!definition) throw new Error(`Unknown company email template: ${input.id}`);

  const builder = TEMPLATES[input.id];
  if (!builder) throw new Error(`Template ${input.id} is in the catalogue but has no copy`);

  const content = builder(input.data ?? {}, input.urls);
  const unsubscribable = isOptionalCategory(definition.category);

  const inner = [
    heading(content.heading),
    ...content.intro.map(paragraph),
    content.code ? codeBlock(content.code, content.codeCaption) : "",
    content.details?.length ? detailsTable(content.details) : "",
    content.callout ? callout(content.callout.tone, content.callout.title, content.callout.body) : "",
    content.cta ? ctaBlock(content.cta.label, content.cta.url) : "",
    ...(content.outro ?? []).map(paragraph),
    content.footnote ? divider() + muted(content.footnote) : "",
    content.linkLine ? linkLine(content.linkLine.text, content.linkLine.label, content.linkLine.url) : "",
  ]
    .filter(Boolean)
    .join("\n");

  const document = input.preview
    ? brandEmail(inner, {
        preheader: content.preheader,
        unsubscribeUrl: unsubscribable ? input.unsubscribeUrl : undefined,
        unsubscribeReason: unsubscribable ? "You asked for Calder product news." : undefined,
      })
    : "";

  return {
    subject: content.subject,
    html: inner,
    document,
    text: buildText(content, unsubscribable ? input.unsubscribeUrl : undefined),
    category: definition.category,
    unsubscribable,
  };
}
