import { randomBytes } from "node:crypto";
import { Google, generateState, generateCodeVerifier } from "arctic";
import { eq, and } from "drizzle-orm";
import { getDb, organizationMembers, projects, projectTransports } from "@calder/db";
import { getConfig } from "@calder/config";
import { encryptSecret, decryptSecret } from "./crypto";

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
  return `${base}/api/auth/callback/gmail-connect`;
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
  const tokens = (await client.validateAuthorizationCode(code, codeVerifier)) as unknown as {
    accessToken: () => string;
    refresh_token?: string;
  };
  const accessToken = tokens.accessToken();
  if (!accessToken) throw new Error("Gmail did not return an access token.");

  const meRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) {
    throw new Error("Could not read the Gmail address (gmail.send scope required).");
  }
  const me = (await meRes.json()) as { emailAddress?: string };
  if (!me.emailAddress) throw new Error("Gmail profile has no address.");
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token, reconnect with consent (prompt=consent)."
    );
  }
  return { senderEmail: me.emailAddress.toLowerCase(), refreshToken: tokens.refresh_token };
}

/** Persist the transport. First transport on a project becomes default. */
export async function saveGmailTransport(input: {
  userId: string;
  projectId: string;
  senderEmail: string;
  refreshToken: string;
}): Promise<{ transportId: string }> {
  if (!(await canManageProject(input.userId, input.projectId))) {
    throw new Error("Only organization owners or admins can connect Gmail.");
  }
  const db = getDb();
  const existing = await db
    .select({ id: projectTransports.id })
    .from(projectTransports)
    .where(eq(projectTransports.projectId, input.projectId));
  const [iv, ciphertext, tag] = encryptSecret(
    JSON.stringify({ refreshToken: input.refreshToken }),
    "gmail"
  ).split(":");
  const id = newId("tr");
  await db.insert(projectTransports).values({
    id,
    projectId: input.projectId,
    type: "gmail",
    status: "active",
    label: input.senderEmail,
    encryptedCredentials: { iv: iv ?? "", ciphertext: ciphertext ?? "", tag: tag ?? "" },
    dailyCap: 400,
    isDefault: existing.length === 0,
  });
  return { transportId: id };
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
