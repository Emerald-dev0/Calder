import { randomBytes } from "node:crypto";
import { Google, generateState, generateCodeVerifier } from "arctic";
import { eq, and, or } from "drizzle-orm";
import {
  getDb,
  organizationMembers,
  projects,
  projectTransports,
  senderIdentities,
} from "@calder/db";
import { getConfig } from "@calder/config";
import { encryptSecret, decryptSecret } from "./crypto.js";

/**
 * Gmail Quickstart connect flow. Minimum scope (openid + email identity +
 * gmail.send), never passwords, never broad mailbox access. Refresh tokens
 * are AES-GCM encrypted before storage; clients only ever see the address.
 */

export const GMAIL_CONNECT_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function connectRedirectURI(): string {
  const base = getConfig().DASHBOARD_URL.replace(/\/$/, "");
  return `${base}/api/auth/gmail/callback`;
}

function gmailClient(): Google | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getConfig();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  return new Google(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, connectRedirectURI());
}

export function gmailConnectAvailable(): boolean {
  return gmailClient() !== null;
}

/** True when the user owns/admins the project (required to connect shared infra). */
export async function canManageProject(userId: string, projectId: string): Promise<boolean> {
  const db = getDb();
  const proj = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const project = proj[0];
  if (!project) return false;
  const memberships = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, project.organizationId)
      )
    );
  return memberships.some((m) => m.role === "owner" || m.role === "admin");
}

export interface GmailConnectStart {
  url: string;
  state: string;
  codeVerifier: string;
}

/** Begin connect. Caller stores state/verifier in short-lived cookies. */
export function startGmailConnect(): GmailConnectStart {
  const client = gmailClient();
  if (!client) throw new Error("Gmail connect is not configured.");
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = client.createAuthorizationURL(state, codeVerifier, [...GMAIL_CONNECT_SCOPES]);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return { url: url.toString(), state, codeVerifier };
}

export interface GmailConnectTokens {
  senderEmail: string;
  refreshToken: string;
}

/**
 * Exchange code → tokens → Gmail address. Returns the encrypted-ready
 * material; persistence happens in saveGmailTransport once the caller has
 * resolved + authorized the target project from signed state.
 */
export async function completeGmailConnect(
  code: string,
  codeVerifier: string
): Promise<GmailConnectTokens> {
  const client = gmailClient();
  if (!client) throw new Error("Gmail connect is not configured.");
  const tokens = await client.validateAuthorizationCode(code, codeVerifier);
  if (
    !tokens.hasScopes() ||
    !tokens.scopes().includes("https://www.googleapis.com/auth/gmail.send")
  ) {
    throw new Error("Gmail sending permission was not granted.");
  }
  if (!tokens.hasRefreshToken()) {
    throw new Error(
      "Google did not return a refresh token, reconnect with consent (prompt=consent)."
    );
  }
  // Gmail users.getProfile requires a restricted mailbox scope. UserInfo uses
  // only the separately requested identity scope and is returned by Google
  // for this access token, not supplied by the browser.
  const meRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  if (!meRes.ok) throw new Error("Could not read the connected Google identity.");
  const me = (await meRes.json()) as { email?: string; email_verified?: boolean };
  if (!me.email || me.email_verified !== true)
    throw new Error("Google account has no verified email address.");
  return { senderEmail: me.email.toLowerCase(), refreshToken: tokens.refreshToken() };
}

/**
 * Persist the transport and ensure its sender identity. First transport on
 * a project becomes default; reconnects rotate credentials in place.
 */
export async function saveGmailTransport(input: {
  userId: string;
  projectId: string;
  senderEmail: string;
  refreshToken: string;
}): Promise<{ transportId: string; senderId: string | null }> {
  const db = getDb();
  const [iv, ciphertext, tag] = encryptSecret(
    JSON.stringify({ refreshToken: input.refreshToken }),
    "gmail"
  ).split(":");
  const creds = { iv: iv ?? "", ciphertext: ciphertext ?? "", tag: tag ?? "" };

  // Authorize and mutate under one project transaction. The project lock makes
  // default selection and reconnect/identity creation race-safe, while the
  // membership predicate is evaluated at the write boundary rather than in a
  // stale preflight check.
  return db.transaction(async (tx) => {
    const [authorized] = await tx
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(
        organizationMembers,
        eq(organizationMembers.organizationId, projects.organizationId)
      )
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(organizationMembers.userId, input.userId),
          or(eq(organizationMembers.role, "owner"), eq(organizationMembers.role, "admin"))
        )
      )
      .limit(1)
      .for("update");
    if (!authorized) throw new Error("Only organization owners or admins can connect Gmail.");

    const existing = await tx
      .select({ id: projectTransports.id })
      .from(projectTransports)
      .where(eq(projectTransports.projectId, input.projectId));
    // Reconnect rotates credentials on the existing row instead of violating
    // the (project, type, label) unique constraint.
    const [same] = await tx
      .select({ id: projectTransports.id })
      .from(projectTransports)
      .where(
        and(
          eq(projectTransports.projectId, input.projectId),
          eq(projectTransports.type, "gmail"),
          eq(projectTransports.label, input.senderEmail)
        )
      )
      .limit(1);
    let id: string;
    if (same) {
      id = same.id;
      await tx
        .update(projectTransports)
        .set({ encryptedCredentials: creds, status: "active", updatedAt: new Date() })
        .where(and(eq(projectTransports.id, id), eq(projectTransports.projectId, input.projectId)));
    } else {
      id = newId("tr");
      await tx.insert(projectTransports).values({
        id,
        projectId: input.projectId,
        type: "gmail",
        status: "active",
        label: input.senderEmail,
        encryptedCredentials: creds,
        dailyCap: 100,
        isDefault: existing.length === 0,
      });
    }
    // A connected account is immediately usable as a sender: mint the identity
    // idempotently so no transport is ever stranded without one. Default only
    // when the project has no senders at all; never steal an existing default.
    const [known] = await tx
      .select({ id: senderIdentities.id })
      .from(senderIdentities)
      .where(
        and(
          eq(senderIdentities.projectId, input.projectId),
          eq(senderIdentities.email, input.senderEmail)
        )
      )
      .limit(1);
    let senderId = known?.id ?? null;
    if (!senderId) {
      const [countRow] = await tx
        .select({ id: senderIdentities.id })
        .from(senderIdentities)
        .where(eq(senderIdentities.projectId, input.projectId))
        .limit(1);
      const [created] = await tx
        .insert(senderIdentities)
        .values({
          id: newId("sender"),
          projectId: input.projectId,
          displayName: input.senderEmail.split("@")[0] ?? input.senderEmail,
          email: input.senderEmail,
          type: "gmail",
          transportId: id,
          status: "connected",
          isDefault: !countRow,
        })
        .returning({ id: senderIdentities.id });
      senderId = created?.id ?? null;
    }
    return { transportId: id, senderId };
  });
}

/** Decrypt a stored Gmail refresh token for the worker. */
export function getGmailRefreshToken(encrypted: {
  iv: string;
  ciphertext: string;
  tag: string;
}): string {
  const raw = decryptSecret(`${encrypted.iv}:${encrypted.ciphertext}:${encrypted.tag}`, "gmail");
  const parsed = JSON.parse(raw) as { refreshToken?: string };
  if (!parsed.refreshToken) throw new Error("Stored Gmail credentials are malformed.");
  return parsed.refreshToken;
}
