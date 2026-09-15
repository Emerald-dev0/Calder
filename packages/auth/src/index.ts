export {
  hashApiKey,
  verifyApiKey,
  generateApiKey,
  extractKeyPrefix,
  type GeneratedApiKey,
} from "./api-keys.js";
export { type AuthContext, type ApiKeyContext, type SessionContext } from "./types.js";
export { requireProjectAccess, requireOrgAccess, assertTenantScope } from "./authorization.js";
export { encryptSecret, decryptSecret } from "./crypto.js";
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
} from "./gmail-connect.js";
export { ensureFounderAccess, acceptPendingInvites } from "./oauth.js";
export {
  startOAuth,
  completeOAuth,
  configuredProviders,
  type OAuthProvider,
  type OAuthProfile,
} from "./oauth.js";
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
} from "./session.js";
export { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe.js";
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
} from "./magic-link.js";
export {
  issueEmailCode,
  verifyEmailCode,
  generateOtpCode,
  hashCode as hashOtpCode,
  EMAIL_CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  type EmailCodePurpose,
  type IssueEmailCodeResult,
} from "./email-code.js";
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
} from "./password.js";
