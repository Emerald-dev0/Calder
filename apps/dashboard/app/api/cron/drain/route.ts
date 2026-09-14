import { NextResponse } from "next/server";
import {
  getDb,
  emails,
  emailEvents,
  suppressions,
  projectTransports,
  senderIdentities,
} from "@calder/db";
import { eq, and, lte, or, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  createEmailService,
  pickDefaultTransport,
  GMAIL_FREE_DAILY_CAP,
  isProviderError,
} from "@calder/email";
import { GmailTransport, resolveEmailProvider } from "@calder/providers";
import { getGmailRefreshToken } from "@calder/auth";
import { isTransientError } from "@calder/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BATCH = 25;
const MAX_ATTEMPTS = 5;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const adminKey = process.env.ADMIN_API_KEY ?? "";
  if (cronSecret && token === cronSecret) return true;
  if (adminKey && token === adminKey) return true;
  if (!cronSecret && req.headers.get("x-vercel-cron") === "1") return true;
  return false;
}

function getProvider() {
  return resolveEmailProvider().provider;
}

async function buildGmail(
  db: ReturnType<typeof getDb>,
  projectId: string,
  chosen: {
    label: string;
    dailyCap: number | null;
    encryptedCredentials: { iv: string; ciphertext: string; tag: string } | null;
  }
) {
  const cap = chosen.dailyCap ?? GMAIL_FREE_DAILY_CAP;
  const { count, gte } = await import("drizzle-orm");
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const sent = await db
    .select({ value: count() })
    .from(emails)
    .where(and(eq(emails.projectId, projectId), gte(emails.createdAt, dayStart)));
  const today = (sent[0] as { value: number } | undefined)?.value ?? 0;
  if (today >= cap)
    throw Object.assign(new Error(`Gmail daily cap reached (${today}/${cap}). Add a domain.`), {
      code: "gmail_cap",
      transient: false,
      statusCode: 429,
    });
  if (!chosen.encryptedCredentials)
    throw Object.assign(new Error("Gmail credentials missing."), {
      code: "sender_not_ready",
      transient: false,
      statusCode: 422,
    });
  const refreshToken = getGmailRefreshToken(chosen.encryptedCredentials as never);
  return {
    service: createEmailService(
      new GmailTransport({ refreshToken, senderEmail: chosen.label }, chosen.dailyCap)
    ),
    transport: "gmail",
  };
}

async function resolveChain(projectId: string, senderIdentityId: string | null) {
  const fallback = { service: createEmailService(getProvider()), transport: "default" };
  const chain: Array<{ service: ReturnType<typeof createEmailService>; transport: string }> = [];
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(projectTransports)
      .where(eq(projectTransports.projectId, projectId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const def = pickDefaultTransport(
      rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        type: r.type,
        status: r.status,
        label: r.label,
        encryptedCredentials: r.encryptedCredentials as never,
        dailyCap: r.dailyCap,
        isDefault: r.isDefault,
      }))
    );
    if (senderIdentityId) {
      const [sender] = await db
        .select()
        .from(senderIdentities)
        .where(eq(senderIdentities.id, senderIdentityId))
        .limit(1);
      if (sender && sender.projectId === projectId) {
        if (sender.status !== "verified" && sender.status !== "connected")
          throw Object.assign(new Error(`Sender ${sender.email} is ${sender.status}.`), {
            code: "sender_not_ready",
            transient: false,
            statusCode: 422,
          });
        const linked = sender.transportId ? byId.get(sender.transportId) : undefined;
        if (linked && linked.status === "active" && (!def || linked.id !== def.id)) {
          if (linked.type === "gmail") chain.push(await buildGmail(db, projectId, linked as never));
          else chain.push({ service: createEmailService(getProvider()), transport: linked.type });
        }
      }
    }
    if (def && def.status === "active" && def.encryptedCredentials) {
      if (def.type === "gmail") chain.push(await buildGmail(db, projectId, def as never));
      else chain.push({ service: createEmailService(getProvider()), transport: def.type });
    }
  } catch (err) {
    if (
      (err instanceof Error && (err as { code?: string }).code === "gmail_cap") ||
      (err instanceof Error && (err as { code?: string }).code === "sender_not_ready")
    )
      throw err;
  }
  chain.push(fallback);
  return chain;
}

export async function GET(req: Request) {
  if (!authorized(req))
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Invalid cron secret. Set Authorization: Bearer $CRON_SECRET or x-vercel-cron",
        },
      },
      { status: 401 }
    );
  const db = getDb();
  const now = new Date();
  const pending = await db
    .select()
    .from(emails)
    .where(
      and(
        eq(emails.status, "queued"),
        or(isNull(emails.scheduledFor), lte(emails.scheduledFor, now))
      )
    )
    .limit(BATCH);
  let sent = 0,
    failed = 0,
    skipped = 0;
  for (const row of pending) {
    if ((row.attemptCount ?? 0) >= MAX_ATTEMPTS) {
      await db
        .update(emails)
        .set({ status: "failed", lastError: "Exhausted retries", updatedAt: now })
        .where(eq(emails.id, row.id));
      failed++;
      continue;
    }
    const sup = await db
      .select()
      .from(suppressions)
      .where(and(eq(suppressions.projectId, row.projectId), eq(suppressions.email, row.to)))
      .limit(1);
    if (sup.length > 0) {
      await db
        .update(emails)
        .set({ status: "suppressed", lastError: sup[0]!.reason, updatedAt: now })
        .where(eq(emails.id, row.id));
      await db.insert(emailEvents).values({
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "suppressed",
        data: { reason: sup[0]!.reason },
      });
      skipped++;
      continue;
    }
    await db
      .update(emails)
      .set({ attemptCount: (row.attemptCount ?? 0) + 1, updatedAt: now })
      .where(eq(emails.id, row.id));
    const headers =
      typeof row.metadata === "object" &&
      row.metadata !== null &&
      typeof (row.metadata as Record<string, unknown>).headers === "object"
        ? ((row.metadata as Record<string, unknown>).headers as Record<string, string>)
        : {};
    const payload = {
      from: row.from,
      to: row.to,
      subject: row.subject,
      html: row.html ?? undefined,
      text: row.text ?? undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      attachments:
        Array.isArray(row.attachments) && row.attachments.length > 0
          ? (row.attachments as never)
          : undefined,
    };
    let result: { providerMessageId: string; provider: string } | null = null;
    let transportName = "default";
    let lastErr: unknown = null;
    let isCap = false,
      senderNotReady = false;
    try {
      const chain = await resolveChain(
        row.projectId,
        (row as { senderIdentityId?: string | null }).senderIdentityId ?? null
      );
      for (let i = 0; i < chain.length; i++) {
        const leg = chain[i]!;
        try {
          const r = await leg.service.send(payload as never);
          result = r;
          transportName = leg.transport;
          break;
        } catch (err) {
          lastErr = err;
          if (err instanceof Error && (err as { code?: string }).code === "gmail_cap") {
            isCap = true;
            break;
          }
          if (err instanceof Error && (err as { code?: string }).code === "sender_not_ready") {
            senderNotReady = true;
            break;
          }
          const transient = isProviderError(err)
            ? (err as { transient: boolean }).transient
            : isTransientError(err);
          if (transient && i < chain.length - 1) continue;
          break;
        }
      }
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && (err as { code?: string }).code === "gmail_cap") isCap = true;
      if (err instanceof Error && (err as { code?: string }).code === "sender_not_ready")
        senderNotReady = true;
    }
    if (result) {
      await db
        .update(emails)
        .set({
          status: "sent",
          providerMessageId: result.providerMessageId,
          transport: transportName,
          provider: result.provider,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(emails.id, row.id));
      await db.insert(emailEvents).values({
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "sent",
        data: {
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          transport: transportName,
        },
      });
      sent++;
      continue;
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (isCap || senderNotReady) {
      await db
        .update(emails)
        .set({ status: "failed", lastError: msg, updatedAt: new Date() })
        .where(eq(emails.id, row.id));
      await db.insert(emailEvents).values({
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "failed",
        data: { error: msg, transient: false },
      });
      failed++;
      continue;
    }
    const transient = isTransientError(lastErr);
    if (transient && (row.attemptCount ?? 0) + 1 < MAX_ATTEMPTS) {
      await db
        .update(emails)
        .set({ lastError: msg, updatedAt: new Date() })
        .where(eq(emails.id, row.id));
      failed++;
      continue;
    }
    await db
      .update(emails)
      .set({ status: "failed", lastError: `Exhausted: ${msg}`, updatedAt: new Date() })
      .where(eq(emails.id, row.id));
    await db.insert(emailEvents).values({
      id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      emailId: row.id,
      projectId: row.projectId,
      type: "failed",
      data: { error: msg, exhausted: true },
    });
    failed++;
  }
  return NextResponse.json({ ok: true, checked: pending.length, sent, failed, skipped });
}
