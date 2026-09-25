"use server";

import { and, desc, eq } from "drizzle-orm";
import { getDb, templates, templateVersions, apiKeys } from "@calder/db";
import { generateApiKey } from "@calder/auth";
import { getConfig } from "@calder/config";
import { assertProjectAccess } from "../onboarding/actions";

const ALIAS_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

function rid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export async function createTemplate(
  projectId: string,
  input: { name: string; alias: string; subject: string; html: string; text: string }
) {
  await assertProjectAccess(projectId);
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
  await db.insert(templateVersions).values({
    id: rid("tplv"),
    templateId: id,
    version: "v1",
    subject: input.subject.trim() || null,
    html: input.html || null,
    text: input.text || null,
  });
  return { id };
}

/** Editing a template appends an immutable version; sends always take latest. */
export async function addTemplateVersion(
  projectId: string,
  templateId: string,
  input: { subject: string; html: string; text: string }
) {
  await assertProjectAccess(projectId);
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
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.createdAt))
    .limit(1);
  const n = Number((latest?.version ?? "v0").slice(1)) + 1;
  await db.insert(templateVersions).values({
    id: rid("tplv"),
    templateId,
    version: `v${n}`,
    subject: input.subject.trim() || null,
    html: input.html || null,
    text: input.text || null,
  });
  return { version: `v${n}` };
}

export async function deleteTemplate(projectId: string, templateId: string) {
  await assertProjectAccess(projectId);
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
  await assertProjectAccess(projectId);
  if (!to.includes("@")) throw new Error("Enter a valid test recipient.");
  const db = getDb();
  const [tpl] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.projectId, projectId)))
    .limit(1);
  if (!tpl || !tpl.alias) throw new Error("Template not found (or missing alias).");

  const key = generateApiKey("test");
  const keyId = rid("key");
  await db.insert(apiKeys).values({
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
        from: "welcome@calder.click",
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
    return { emailId: body.id };
  } finally {
    // One-time key revoked immediately after use.
    await db.delete(apiKeys).where(eq(apiKeys.id, keyId)).catch(() => {});
  }
}
