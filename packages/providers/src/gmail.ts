import type {
 EmailMessage,
 EmailTransport,
 ProviderSendResult,
 TransportCapabilities,
 TransportHealth,
} from "@calder/email";
import { transportResult, GMAIL_FREE_DAILY_CAP } from "@calder/email";
import { getConfig } from "@calder/config";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GmailCredentials {
 /**
 * Decrypted OAuth refresh token, in-memory only, held for the life of one
 * send. Decrypt at the call site (auth.getGmailRefreshToken); this class
 * never touches storage, so a heap dump can't yield anything reusable
 * beyond the token's own lifetime.
 */
 refreshToken: string;
 /** The connected Gmail address. Used as the envelope sender. */
 senderEmail: string;
 /** True for Google Workspace senders (higher caps). */
 isWorkspace?: boolean;
}

interface TokenResponse {
 access_token: string;
 expires_in: number;
 refresh_token?: string;
 token_type: string;
}

/** Build a minimal RFC 822 message (multipart/alternative when both bodies exist). */
export function buildGmailMime(
 message: Required<Pick<EmailMessage, "from" | "to" | "subject">> & EmailMessage
): string {
 const lines: string[] = [
 `From: ${message.from}`,
 `To: ${message.to}`,
 ...(message.cc ? [`Cc: ${message.cc}`] : []),
 ...(message.bcc ? [`Bcc: ${message.bcc}`] : []),
 ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
 `Subject: ${message.subject}`,
 "MIME-Version: 1.0",
 ];
 let body = "";
 if (message.html && message.text) {
 const boundary = `calder_${Date.now().toString(36)}`;
 lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
 body = [
 "",
 `--${boundary}`,
 'Content-Type: text/plain; charset="UTF-8"',
 "",
 message.text,
 `--${boundary}`,
 'Content-Type: text/html; charset="UTF-8"',
 "",
 message.html,
 `--${boundary}--`,
 "",
 ].join("\r\n");
 } else if (message.html) {
 lines.push('Content-Type: text/html; charset="UTF-8"');
 body = `\r\n${message.html}\r\n`;
 } else {
 lines.push('Content-Type: text/plain; charset="UTF-8"');
 body = `\r\n${message.text ?? ""}\r\n`;
 }
 for (const [name, value] of Object.entries(message.headers ?? {})) {
 if (/^[A-Za-z0-9-]+$/.test(name)) lines.push(`${name}: ${value}`);
 }
 return `${lines.join("\r\n")}${body}`;
}

export function base64UrlEncode(input: string): string {
 return Buffer.from(input, "utf8")
 .toString("base64")
 .replace(/\+/g, "-")
 .replace(/\//g, "_")
 .replace(/=+$/, "");
}

function providerError(message: string, statusCode: number, code: string): Error {
 const transient = statusCode === 429 || (statusCode >= 500 && statusCode < 600);
 const err = new Error(message) as Error & {
 code: string;
 transient: boolean;
 statusCode: number;
 };
 err.code = code;
 err.transient = transient;
 err.statusCode = statusCode;
 return err;
}

/**
 * Gmail transport, delivers through a user-connected Gmail account via the
 * Gmail API. Intended for development, prototypes, and small apps; conservative
 * caps keep it off bulk-mail duty. Never collects passwords, OAuth refresh
 * tokens only, encrypted at rest, minimum scope (gmail.send).
 */
export class GmailTransport implements EmailTransport {
 readonly name = "gmail";
 readonly transportType = "gmail" as const;

 private accessToken: string | null = null;
 private accessTokenExpiresAt = 0;
 private refreshToken: string;

 constructor(
 private readonly credentials: GmailCredentials,
 private readonly dailyCap: number | null = GMAIL_FREE_DAILY_CAP
 ) {
 this.refreshToken = credentials.refreshToken;
 }

 getCapabilities(): TransportCapabilities {
 return {
 dailyLimit: this.dailyCap,
 maxMessageBytes: 25 * 1024 * 1024,
 supportsTracking: false,
 supportsTemplates: false,
 notes: [
 "Development and small-app sending, not bulk infrastructure.",
 "Daily sending cap enforced before delivery.",
 "Sender must be the connected Gmail address.",
 ],
 };
 }

 async healthCheck(): Promise<TransportHealth> {
 const start = Date.now();
 try {
 await this.getAccessToken();
 return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
 } catch (err) {
 return {
 healthy: false,
 latencyMs: Date.now() - start,
 detail: err instanceof Error ? err.message : "unknown",
 checkedAt: new Date(),
 };
 }
 }

 private async getAccessToken(): Promise<string> {
 if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
 return this.accessToken;
 }
 const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getConfig();
 if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
 throw providerError("Gmail OAuth client is not configured.", 500, "gmail_not_configured");
 }
 const res = await fetch(TOKEN_URL, {
 method: "POST",
 headers: { "Content-Type": "application/x-www-form-urlencoded" },
 body: new URLSearchParams({
 client_id: GOOGLE_CLIENT_ID,
 client_secret: GOOGLE_CLIENT_SECRET,
 refresh_token: this.refreshToken,
 grant_type: "refresh_token",
 }),
 });
 if (!res.ok) {
 const revoked = res.status === 400 || res.status === 401;
 throw providerError(
 revoked
 ? "Gmail authorization was revoked, reconnect the account."
 : `Gmail token refresh failed (HTTP ${res.status}).`,
 revoked ? 401 : res.status,
 revoked ? "gmail_revoked" : "gmail_token_error"
 );
 }
 const tokens = (await res.json()) as TokenResponse;
 this.accessToken = tokens.access_token;
 this.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
 if (tokens.refresh_token) this.refreshToken = tokens.refresh_token;
 return this.accessToken;
 }

 async send(message: EmailMessage): Promise<ProviderSendResult> {
 if (!message.html && !message.text) {
 throw providerError("Message needs html or text content.", 400, "gmail_validation");
 }
 const token = await this.getAccessToken();
 const raw = base64UrlEncode(
 buildGmailMime({
 ...message,
 from: this.credentials.senderEmail,
 })
 );
 const res = await fetch(GMAIL_API, {
 method: "POST",
 headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
 body: JSON.stringify({ raw }),
 });
 if (!res.ok) {
 if (res.status === 401) {
 // Token may have been revoked mid-flight, drop cache, surface clearly.
 this.accessToken = null;
 throw providerError(
 "Gmail authorization was revoked, reconnect the account.",
 401,
 "gmail_revoked"
 );
 }
 const body = await res.text().catch(() => "");
 throw providerError(
 `Gmail rejected the message (HTTP ${res.status}). ${body.slice(0, 200)}`,
 res.status,
 "gmail_rejected"
 );
 }
 const data = (await res.json()) as { id?: string };
 return transportResult(data.id ?? `gmail_${Date.now()}`, this.name);
 }
}

export function createGmailTransport(
 credentials: GmailCredentials,
 dailyCap?: number | null
): GmailTransport {
 return new GmailTransport(credentials, dailyCap ?? GMAIL_FREE_DAILY_CAP);
}
