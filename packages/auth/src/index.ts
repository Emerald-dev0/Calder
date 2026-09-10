export {
  hashApiKey,
  verifyApiKey,
  generateApiKey,
  extractKeyPrefix,
  type GeneratedApiKey,
} from "./api-keys";
export { type AuthContext, type ApiKeyContext, type SessionContext } from "./types";
export { requireProjectAccess, requireOrgAccess, assertTenantScope } from "./authorization";
export { encryptSecret, decryptSecret } from "./crypto";
export {
  startGmailConnect,
  completeGmailConnect,
  saveGmailTransport,
  getGmailRefreshToken,
  canManageProject,
  gmailConnectAvailable,
  GMAIL_CONNECT_SCOPES,
  type GmailConnectStart,
  type GmailConnectTokens,
} from "./gmail-connect";
export { ensureFounderAccess, acceptPendingInvites } from "./oauth";
export {
  startOAuth,
  completeOAuth,
  configuredProviders,
  type OAuthProvider,
  type OAuthProfile,
} from "./oauth";
export {
  createSession,
  getSessionUser,
  revokeSession,
  sealSessionCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
  secureFlag,
  SESSION_COOKIE,
  type SessionUser,
} from "./session";
export { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";
export {
  requestMagicLink,
  consumeMagicLink,
  normalizeEmail,
  isPlausibleEmail,
  hashMagicToken,
  magicLinkExpiry,
  isMagicTokenLive,
  MAGIC_LINK_TTL_MINUTES,
  MAGIC_LINK_FROM,
} from "./magic-link";
export {
  issueEmailCode,
  verifyEmailCode,
  generateOtpCode,
  hashCode as hashOtpCode,
  EMAIL_CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  type EmailCodePurpose,
  type IssueEmailCodeResult,
} from "./email-code";
export {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  signupWithPassword,
  loginWithPassword,
  verifySignupCode,
  resetPasswordWithCode,
  MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN,
  type SignupWithPasswordResult,
  type LoginWithPasswordResult,
} from "./password";
