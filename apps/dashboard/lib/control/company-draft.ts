/**
 * The operator's company-email draft: merge fields, validation, and what the
 * preview actually renders.
 *
 * Two problems this file exists to fix.
 *
 * 1. The preview panel showed a *catalogue* sample and the send form rendered
 *    whatever the operator typed. So "I have read the preview" was a checkbox
 *    about a different email — the one failure mode an operator console must not
 *    have, because a broadcast cannot be recalled.
 * 2. "Hi {{name}}" is what a real announcement opens with, and the composer had
 *    no way to say it. Substituting a name at send time is also the place where
 *    a bad value could reach every inbox at once, so the merge vocabulary is a
 *    closed list: an unknown field is refused before anything is sent, rather
 *    than shipped literally to 500 people.
 *
 * The functions here are pure so both the page (preview) and the action (send)
 * go through exactly the same rules.
 */
import { defaultUrls, renderCompanyEmail, type CompanyEmailId } from "@calder/notify";

/** The only merge fields an operator may use. Adding one is a product decision. */
export const MERGE_FIELDS = ["name"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/** What a recipient with no name on file is called. Never an empty greeting. */
export const NAME_FALLBACK = "there";

const MERGE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export const DRAFT_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  bodyMin: 20,
  bodyMax: 1500,
  ctaLabelMax: 40,
} as const;

/** The greeting a fresh draft starts with, so nobody has to remember syntax. */
export const DRAFT_BODY_SKELETON = "Hi {{name}},\n\n";

export interface DraftFields {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export type DraftValidation = { ok: true; fields: MergeField[] } | { ok: false; error: string };

/** Every `{{field}}` in a string, in order, without duplicates. */
export function mergeFieldsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MERGE_PATTERN)) {
    const field = match[1]!;
    if (!found.includes(field)) found.push(field);
  }
  return found;
}

/** All the merge fields used across the draft. */
export function mergeFieldsUsed(draft: DraftFields): string[] {
  const found: string[] = [];
  for (const field of [
    ...mergeFieldsIn(draft.title),
    ...mergeFieldsIn(draft.body),
    ...mergeFieldsIn(draft.ctaLabel ?? ""),
  ]) {
    if (!found.includes(field)) found.push(field);
  }
  return found;
}

/**
 * Everything that must be true before a draft can be previewed or sent.
 *
 * The messages are written for the operator reading them: they name the thing
 * that is wrong and what to do instead.
 */
export function validateDraft(draft: DraftFields): DraftValidation {
  const title = draft.title.trim();
  const body = draft.body.trim();

  if (title.length < DRAFT_LIMITS.titleMin) {
    return { ok: false, error: "Give the email a title of at least 3 characters." };
  }
  if (title.length > DRAFT_LIMITS.titleMax) {
    return { ok: false, error: `Keep the title under ${DRAFT_LIMITS.titleMax} characters.` };
  }
  if (body.length < DRAFT_LIMITS.bodyMin) {
    return { ok: false, error: "Write at least a sentence of body copy (20+ characters)." };
  }
  if (body.length > DRAFT_LIMITS.bodyMax) {
    return {
      ok: false,
      error: `Keep the body under ${DRAFT_LIMITS.bodyMax} characters; link out for detail.`,
    };
  }
  if ((draft.ctaLabel ?? "").length > DRAFT_LIMITS.ctaLabelMax) {
    return {
      ok: false,
      error: `Keep the button label under ${DRAFT_LIMITS.ctaLabelMax} characters.`,
    };
  }
  const url = (draft.ctaUrl ?? "").trim();
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
    return { ok: false, error: "The button URL must start with http:// or https://." };
  }

  const unknown = mergeFieldsUsed(draft).filter(
    (field) => !(MERGE_FIELDS as readonly string[]).includes(field)
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `Unknown merge field${unknown.length === 1 ? "" : "s"} ${unknown
          .map((field) => `{{${field}}}`)
          .join(", ")}. ` +
        `Use ${MERGE_FIELDS.map((field) => `{{${field}}}`).join(", ")} — anything else would be sent literally.`,
    };
  }

  return { ok: true, fields: mergeFieldsUsed(draft) as MergeField[] };
}

/**
 * What one recipient sees: first name if we have one, "there" if we do not.
 *
 * First token only — "Hi Daniel Oluwadare," reads like a bank letter, and the
 * full name is not something an announcement needs.
 */
export function displayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return NAME_FALLBACK;
  const first = trimmed.split(/\s+/)[0]!;
  return first || NAME_FALLBACK;
}

/** Substitute every merge field for one recipient. Escaping happens in the renderer. */
export function personaliseDraft(
  draft: DraftFields,
  recipient: { name?: string | null }
): DraftFields {
  const values: Record<MergeField, string> = { name: displayName(recipient.name) };
  const fill = (text: string): string =>
    text.replace(MERGE_PATTERN, (whole, field: string) =>
      (MERGE_FIELDS as readonly string[]).includes(field) ? values[field as MergeField] : whole
    );
  return {
    title: fill(draft.title.trim()),
    body: fill(draft.body.trim()),
    ctaLabel: draft.ctaLabel?.trim() ? fill(draft.ctaLabel.trim()) : undefined,
    ctaUrl: draft.ctaUrl?.trim() || undefined,
  };
}

/**
 * The per-recipient `data` map `sendCompanyEmail` accepts.
 *
 * Separate from `personaliseDraft` only because the renderer takes
 * `Record<string, unknown>` and a typed shape is not assignable to it.
 */
export function personalisedEmailData(
  draft: DraftFields,
  recipient: { name?: string | null }
): Record<string, unknown> {
  const fields = personaliseDraft(draft, recipient);
  return {
    title: fields.title,
    body: fields.body,
    ...(fields.ctaLabel ? { ctaLabel: fields.ctaLabel } : {}),
    ...(fields.ctaUrl ? { ctaUrl: fields.ctaUrl } : {}),
  };
}

export interface DraftPreview {
  document: string;
  subject: string;
  /** The persona the preview was rendered with, so the page can say so. */
  persona: { name: string; email: string };
}

export const PREVIEW_PERSONA = { name: "Ada Lovelace", email: "ada@example.com" } as const;

/**
 * Render the operator's own words through the real template.
 *
 * Same renderer, same footer, same unsubscribe line as the send — that is the
 * only kind of preview worth confirming.
 */
export function renderDraftPreview(template: CompanyEmailId, draft: DraftFields): DraftPreview {
  const rendered = renderCompanyEmail({
    id: template,
    data: {
      ...personaliseDraft(draft, { name: PREVIEW_PERSONA.name }),
    },
    urls: defaultUrls(),
    preview: true,
  });
  return {
    document: rendered.document,
    subject: rendered.subject,
    persona: { name: PREVIEW_PERSONA.name, email: PREVIEW_PERSONA.email },
  };
}

/** Read a draft back off the URL the GET preview form produced. */
export function draftFromSearchParams(params: {
  template?: string;
  title?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): DraftFields | null {
  const title = (params.title ?? "").trim();
  const body = (params.body ?? "").trim();
  if (!title && !body) return null;
  return {
    title,
    body,
    ctaLabel: (params.ctaLabel ?? "").trim() || undefined,
    ctaUrl: (params.ctaUrl ?? "").trim() || undefined,
  };
}
