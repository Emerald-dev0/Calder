import { randomBytes, timingSafeEqual } from "node:crypto";
import { Google, GitHub, generateState, generateCodeVerifier } from "arctic";
import { and, eq, isNull } from "drizzle-orm";
import {
  getDb,
  users,
  oauthAccounts,
  organizations,
  organizationMembers,
  orgInvitations,
  sessions,
} from "@calder/db";
import { getConfig } from "@calder/config";
import { rotateSession, rotateSessionInTransaction } from "./session.js";
import { assertNotDisposableEmail } from "./disposable-email.js";

export type OAuthProvider = "google" | "github";

export interface OAuthProfile {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function redirectURI(provider: OAuthProvider): string {
  // Dashboard owns the OAuth loop; callbacks land there.
  const base = getConfig().DASHBOARD_URL.replace(/\/$/, "");
  return `${base}/api/auth/callback/${provider}`;
}

function googleClient(): Google | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getConfig();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  return new Google(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectURI("google"));
}

function githubClient(): GitHub | null {
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = getConfig();
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) return null;
  return new GitHub(GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, redirectURI("github"));
}

/** Which providers are actually configured (login page renders only these). */
export function configuredProviders(): OAuthProvider[] {
  const out: OAuthProvider[] = [];
  if (googleClient()) out.push("google");
  if (githubClient()) out.push("github");
  return out;
}

export interface AuthStart {
  url: string;
  state: string;
  codeVerifier: string | null;
}

/** Begin OAuth: returns redirect URL + values the caller must store in cookies. */
export function startOAuth(provider: OAuthProvider): AuthStart {
  const state = generateState();
  if (provider === "google") {
    const client = googleClient();
    if (!client) throw new Error("Google OAuth is not configured.");
    const codeVerifier = generateCodeVerifier();
    const url = client.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);
    return { url: url.toString(), state, codeVerifier };
  }
  const client = githubClient();
  if (!client) throw new Error("GitHub OAuth is not configured.");
  const url = client.createAuthorizationURL(state, ["read:user", "user:email"]);
  return { url: url.toString(), state, codeVerifier: null };
}

function statesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Google profile.");
  const data = (await res.json()) as {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
  };
  if (!data.email) throw new Error("Google account has no email address.");
  return {
    providerUserId: data.sub,
    email: data.email.toLowerCase(),
    emailVerified: data.email_verified === true,
    name: data.name ?? null,
  };
}

async function fetchGithubProfile(accessToken: string): Promise<OAuthProfile> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const meRes = await fetch("https://api.github.com/user", { headers });
  if (!meRes.ok) throw new Error("Failed to fetch GitHub profile.");
  const me = (await meRes.json()) as { id: number; name?: string; email?: string | null };
  let email = me.email ?? null;
  let verified = false;
  // Primary email may be private, ask the emails endpoint.
  const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
  if (emailsRes.ok) {
    const list = (await emailsRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const primary = list.find((e) => e.primary) ?? list[0];
    if (primary) {
      email = primary.email;
      verified = primary.verified;
    }
  }
  if (!email) throw new Error("GitHub account has no visible email address.");
  return {
    providerUserId: String(me.id),
    email: email.toLowerCase(),
    emailVerified: verified,
    name: me.name ?? null,
  };
}

/**
 * Complete OAuth: validate state, exchange code, link-or-create user,
 * open a session. Returns the session id to seal into the cookie.
 */
export async function completeOAuth(
  provider: OAuthProvider,
  code: string,
  state: string,
  storedState: string | null,
  codeVerifier: string | null,
  meta: Parameters<typeof rotateSession>[2] = {},
  previousSessionId?: string | null
): Promise<string> {
  if (provider !== "google" && provider !== "github") {
    throw new Error("Unknown OAuth provider.");
  }
  if (!storedState || !statesEqual(state, storedState)) {
    throw new Error("OAuth state mismatch. Please try signing in again.");
  }
  const db = getDb();
  let tokens: { accessToken: () => string };
  if (provider === "google") {
    const client = googleClient();
    if (!client || !codeVerifier) throw new Error("Google OAuth is not configured.");
    tokens = await client.validateAuthorizationCode(code, codeVerifier);
  } else {
    const client = githubClient();
    if (!client) throw new Error("GitHub OAuth is not configured.");
    tokens = await client.validateAuthorizationCode(code);
  }

  const profile =
    provider === "google"
      ? await fetchGoogleProfile(tokens.accessToken())
      : await fetchGithubProfile(tokens.accessToken());

  const result = await db.transaction(async (tx) => {
    // Existing link → user. The whole link/create + session transition is one
    // transaction so concurrent callbacks cannot create two accounts or race
    // a disconnect/password invalidation into a live stale session.
    const [linked] = await tx
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerUserId, profile.providerUserId)
        )
      )
      .limit(1);
    let userId = linked?.userId ?? null;
    let userEmail = profile.email;

    if (!userId) {
      // Link by verified email, else create the user.
      const [same] = await tx
        .select()
        .from(users)
        .where(eq(users.email, profile.email))
        .limit(1)
        .for("update");
      if (same) {
        // H4 decision (ADR-040): an email the provider has NOT verified must
        // never auto-link to an existing Calder account — even when the Calder
        // row is itself verified. An attacker sets an unverified provider-side
        // email to the victim's address and would otherwise sign in AS the
        // victim. Verified-side linking requires the provider's explicit
        // verified flag; anything else signs in first and links deliberately.
        if (!profile.emailVerified) {
          throw new Error(
            "That email is already registered and this provider has not verified ownership. Sign in with your original method to link accounts."
          );
        }
        // Conversely: a provider-verified email proves control at link time —
        // mark the Calder side verified too if it wasn't yet.
        if (same.emailVerifiedAt == null) {
          await tx
            .update(users)
            .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
            .where(eq(users.id, same.id));
        }
        userId = same.id;
        userEmail = same.email;
      } else {
        // Do not create a signed-in Calder account from an unverified provider
        // email. The provider assertion is the only proof available at this
        // boundary; accepting it would create an account an attacker could
        // control with an unverified address and would make later linking
        // ambiguous. Existing Calder accounts are handled above without an
        // automatic link when provider verification is absent.
        if (!profile.emailVerified) {
          throw new Error(
            "This provider has not verified the email address. Use a verified account."
          );
        }
        assertNotDisposableEmail(profile.email);
        userId = newId("usr");
        await tx.insert(users).values({
          id: userId,
          email: profile.email,
          name: profile.name,
          emailVerifiedAt: new Date(),
        });
      }
      await tx.insert(oauthAccounts).values({
        id: newId("oa"),
        userId,
        provider,
        providerUserId: profile.providerUserId,
      });
    } else {
      const [canonical] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for("update");
      if (!canonical) throw new Error("OAuth account is not attached to an account.");
      // Never use a mutable provider profile email for founder/bootstrap or
      // invite decisions after an account is linked. The Calder row is the
      // canonical tenant/auth identity.
      userEmail = canonical.email;
    }

    const sessionId = await rotateSessionInTransaction(tx, userId, previousSessionId, meta);
    return { userId, userEmail, sessionId };
  });

  await ensureFounderAccess(db, result.userId, result.userEmail);
  await acceptPendingInvites(db, result.userId, result.userEmail);

  return result.sessionId;
}

/**
 * Disconnect a login provider without deleting the account's last usable
 * authentication method. Removing an OAuth identity is security-sensitive, so
 * all existing sessions are revoked after the identity row is deleted.
 */
export async function disconnectOAuthAccount(
  userId: string,
  provider: OAuthProvider
): Promise<{ ok: true }> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Serialize disconnect with OAuth linking, password changes, and session
    // creation. The last-auth-method check must use the locked, current rows.
    const [user] = await tx
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!user) throw new Error("Account not found.");
    const accounts = await tx
      .select({ id: oauthAccounts.id, provider: oauthAccounts.provider })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId));
    const target = accounts.find((account) => account.provider === provider);
    if (!target) throw new Error("OAuth account not found.");
    if (!user.passwordHash && accounts.length <= 1) {
      throw new Error(
        "Add a password or another sign-in method before disconnecting this account."
      );
    }
    await tx
      .delete(oauthAccounts)
      .where(and(eq(oauthAccounts.id, target.id), eq(oauthAccounts.userId, userId)));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  });
  return { ok: true };
}

/**
 * Invite auto-accept: any pending, unexpired invitation matching this email
 * becomes a membership on login/signup. Idempotent (unique index guards
 * double-accept); expired or already-accepted rows are ignored.
 */
export async function acceptPendingInvites(
  db: ReturnType<typeof getDb>,
  userId: string,
  email: string
): Promise<string[]> {
  const now = new Date();
  const pending = await db
    .select()
    .from(orgInvitations)
    .where(eq(orgInvitations.email, email.toLowerCase()));
  const accepted: string[] = [];
  for (const inv of pending) {
    if (inv.acceptedAt || inv.expiresAt < now) continue;
    await db
      .insert(organizationMembers)
      .values({
        id: newId("orgm"),
        organizationId: inv.organizationId,
        userId,
        role: inv.role,
      })
      .onConflictDoNothing();
    await db.update(orgInvitations).set({ acceptedAt: now }).where(eq(orgInvitations.id, inv.id));
    accepted.push(inv.organizationId);
  }
  return accepted;
}

/**
 * Founder bootstrap: emails listed in FOUNDER_EMAILS are granted owner of the
 * internal Calder org on first login, this is how the founder claims control
 * of Calder's own account (org_avenor) and sees its mail in the dashboard.
 * No-ops for everyone else. Never grants anything beyond org_avenor.
 */
export async function ensureFounderAccess(
  db: ReturnType<typeof getDb>,
  userId: string,
  email: string
): Promise<void> {
  // Same parsing as the dashboard's resolvePlatformRole: split on ","
  // then trim, so multi-email lists work with or without a space.
  const founders = (getConfig().FOUNDER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!founders.includes(email.toLowerCase())) return;

  await db
    .insert(organizations)
    .values({ id: "org_avenor", name: "Calder", slug: "calder" })
    .onConflictDoNothing();
  const existing = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, "org_avenor"),
        eq(organizationMembers.userId, userId)
      )
    )
    .limit(1);
  if (!existing[0]) {
    await db.insert(organizationMembers).values({
      id: newId("orgm"),
      organizationId: "org_avenor",
      userId,
      role: "owner",
    });
  }
}
