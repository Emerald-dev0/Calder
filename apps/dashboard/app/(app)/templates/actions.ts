"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import {
  getDb,
  templates,
  templateVersions,
  senderIdentities,
  apiKeys,
  insertApiKeyForActiveOrganization,
} from "@calder/db";
import { generateApiKey } from "@calder/auth";
import { getConfig } from "@calder/config";
import { assertProjectManager } from "../onboarding/actions";

const ALIAS_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

function rid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export async function createTemplate(
  projectId: string,
  input: { name: string; alias: string; subject: string; html: string; text: string }
) {
  await assertProjectManager(projectId);
  const name = input.name.trim();
  const alias = input.alias.trim().toLowerCase();
  if (!name) throw new Error("Name the template.");
  if (!ALIAS_RE.test(alias))
    throw new Error("Alias: lowercase letters, digits, hyphens (used in send requests).");
  if (!input.html.trim() && !input.text.trim())
    throw new Error("Provide HTML or plain-text content (or both).");
  const db = getDb();
  const [dup] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.projectId, projectId), eq(templates.alias, alias)))
    .limit(1);
  if (dup) throw new Error(`Alias "${alias}" is taken on this project.`);
  const id = rid("tpl");
  await db.insert(templates).values({ id, projectId, name, alias });
  const { extractVariables, normaliseVariables, validateForPublish } =
    await import("@calder/email");
  const variables = normaliseVariables(extractVariables(input.subject, input.html, input.text));
  const content = {
    subject: input.subject.trim() || null,
    html: input.html || null,
    text: input.text || null,
  };
  // A brand-new template has nothing to compare against, so its first version is
  // published — but only if it would actually be sendable.
  const problems = validateForPublish(content, variables);
  if (problems.length > 0) {
    throw new Error(problems.map((p) => p.message).join(" "));
  }
  await db.insert(templateVersions).values({
    id: rid("tplv"),
    templateId: id,
    version: "v1",
    subject: content.subject,
    html: content.html,
    text: content.text,
    status: "published",
    publishedAt: new Date(),
    variables,
  });
  return { id };
}

/**
 * Editing a template appends a version, as a **draft**.
 *
 * Saving is not sending: the previous published version stays live until
 * someone publishes this one, so a half-finished edit cannot reach a recipient.
 */
export async function addTemplateVersion(
  projectId: string,
  templateId: string,
  input: { subject: string; html: string; text: string }
) {
  await assertProjectManager(projectId);
  const db = getDb();
  const [tpl] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.projectId, projectId)))
    .limit(1);
  if (!tpl) throw new Error("Template not found.");
  if (!input.html.trim() && !input.text.trim())
    throw new Error("Provide HTML or plain-text content (or both).");
  const [latest] = await db
    .select({ version: templateVersions.version })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(and(eq(templateVersions.templateId, templateId), eq(templates.projectId, projectId)))
    .orderBy(desc(templateVersions.createdAt))
    .limit(1);
  const n = Number((latest?.version ?? "v0").slice(1)) + 1;
  const { extractVariables, normaliseVariables } = await import("@calder/email");
  // Declaring what the template uses is part of saving: publishing refuses a
  // placeholder the template never announced.
  const variables = normaliseVariables(extractVariables(input.subject, input.html, input.text));
  await db.insert(templateVersions).values({
    id: rid("tplv"),
    templateId,
    version: `v${n}`,
    subject: input.subject.trim() || null,
    html: input.html || null,
    text: input.text || null,
    status: "draft",
    variables,
  });
  return { version: `v${n}` };
}

/**
 * Publish a version, after the same validation the API performs.
 *
 * Returns the problems instead of throwing so the editor can list them; a
 * publish that silently did nothing would be worse than a refusal.
 */
export async function publishTemplateVersion(
  projectId: string,
  templateId: string,
  version: string
): Promise<{ ok: true; version: string } | { ok: false; problems: string[] }> {
  await assertProjectManager(projectId);
  const db = getDb();
  const [row] = await db
    .select({
      id: templateVersions.id,
      version: templateVersions.version,
      status: templateVersions.status,
      subject: templateVersions.subject,
      html: templateVersions.html,
      text: templateVersions.text,
      variables: templateVersions.variables,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(
      and(
        eq(templateVersions.templateId, templateId),
        eq(templates.projectId, projectId),
        eq(templateVersions.version, version)
      )
    )
    .limit(1);
  if (!row) throw new Error("Template version not found.");

  const { validateForPublish, normaliseVariables } = await import("@calder/email");
  const problems = validateForPublish(
    { subject: row.subject, html: row.html, text: row.text },
    normaliseVariables(row.variables)
  );
  if (problems.length > 0) return { ok: false, problems: problems.map((p) => p.message) };

  if (row.status !== "published") {
    await db
      .update(templateVersions)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(templateVersions.id, row.id));
  }
  return { ok: true, version: row.version };
}

export async function deleteTemplate(projectId: string, templateId: string) {
  await assertProjectManager(projectId);
  const db = getDb();
  const deleted = await db
    .delete(templates)
    .where(and(eq(templates.id, templateId), eq(templates.projectId, projectId)))
    .returning({ id: templates.id });
  if (deleted.length === 0) throw new Error("Template not found.");
  return { ok: true as const };
}

/**
 * Test-send through the REAL API: mint a one-time test key, send
 * template-by-alias with sample variables, revoke the key. No key material
 * leaves the server; the email row + lifecycle are 100% real.
 */
export async function testSendTemplate(
  projectId: string,
  templateId: string,
  to: string,
  variables: Record<string, string>
) {
  await assertProjectManager(projectId);
  if (!to.includes("@")) throw new Error("Enter a valid test recipient.");
  const db = getDb();
  const [tpl] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.projectId, projectId)))
    .limit(1);
  if (!tpl || !tpl.alias) throw new Error("Template not found (or missing alias).");

  /**
   * A test send must be attributable to a real sender identity on this
   * project. The previous version hardcoded `welcome@calder.click`, which is
   * not a customer identity: in a hosted environment sender resolution
   * rejects it, so the advertised "send test email" could never work for the
   * person trying it. Failing here with an actionable message is honest; a
   * silent unattributed fallback is not.
   */
  const [sender] = await db
    .select({ id: senderIdentities.id, email: senderIdentities.email })
    .from(senderIdentities)
    .where(
      and(
        eq(senderIdentities.projectId, projectId),
        isNull(senderIdentities.archivedAt),
        eq(senderIdentities.status, "verified")
      )
    )
    .limit(1);
  if (!sender) {
    throw new Error(
      "Add and verify a sender identity first — a template test send needs a real 'from' address on this project."
    );
  }

  const key = generateApiKey("test");
  const keyId = rid("key");
  await insertApiKeyForActiveOrganization(db, projectId, {
    id: keyId,
    projectId,
    name: "template test-send (one-time)",
    keyPrefix: key.prefix,
    keyHash: key.hash,
    env: "test",
  });
  try {
    const base = getConfig().API_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/v1/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.secret}`,
        "Idempotency-Key": `tpltest-${templateId}-${Date.now()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender.id,
        to,
        template: tpl.alias,
        variables,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      id?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok || !body?.id)
      throw new Error(body?.error?.message ?? `Send failed (HTTP ${res.status}).`);
    return { emailId: body.id, sandbox: true as const };
  } finally {
    // One-time key revoked immediately after use.
    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)))
      .catch(() => {});
  }
}
