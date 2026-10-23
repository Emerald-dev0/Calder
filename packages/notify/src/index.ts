/**
 * The company email system: everything Calder itself sends to its own users.
 *
 * Layering, so nothing here needs a browser or an HTTP framework:
 *   catalogue.ts   what exists, who it is for, whether it can be switched off
 *   render/        copy → HTML + text, with escaping in one place
 *   preferences.ts what each person has opted out of
 *   tokens.ts      signed links so opt-out works without a session
 *   send.ts        consent → idempotent claim → provider → recorded outcome
 */
export {
  COMPANY_EMAILS,
  COMPANY_EMAIL_CATEGORIES,
  COMPANY_EMAIL_IDS,
  OPTIONAL_CATEGORIES,
  companyEmailDefinition,
  isOptionalCategory,
  type CompanyEmailCategory,
  type CompanyEmailDefinition,
  type CompanyEmailId,
} from "./catalogue.js";

export {
  defaultUrls,
  renderCompanyEmail,
  type RenderCompanyEmailInput,
  type RenderedCompanyEmail,
} from "./render/render.js";
export type { CompanyEmailContent, RenderUrls } from "./render/templates.js";
export { escapeHtml, safeUrl } from "./render/blocks.js";

export {
  getDisabledCategories,
  getEmailPreferences,
  isCategoryDisabled,
  setCategoryDisabled,
  OPTIONAL_CATEGORY_LIST,
  type EmailPreferencesView,
} from "./preferences.js";

export {
  signPreferenceToken,
  verifyPreferenceToken,
  type PreferenceTokenPayload,
} from "./tokens.js";

export {
  resolveOrganizationRecipients,
  sendOrganizationEmail,
  type OrganizationRecipient,
  type SendOrganizationEmailParams,
  type SendOrganizationEmailResult,
} from "./recipients.js";

export {
  deliver,
  listCompanyEmailsForUser,
  sendCompanyEmail,
  sendCompanyEmailQuietly,
  type CompanyEmailSkipReason,
  type CompanyEmailStatus,
  type SendCompanyEmailParams,
  type SendCompanyEmailDeps,
  type SendCompanyEmailResult,
} from "./send.js";
export { drizzleCompanyEmailStore, type CompanyEmailStore } from "./store.js";
