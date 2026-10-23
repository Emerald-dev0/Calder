/**
 * Audiences, contacts and consent — shared by the API and the dashboard.
 *
 * This lives in a package, not in `apps/api`, because both surfaces edit the
 * same state and a second implementation would drift: the dashboard would
 * happily add somebody to a list the API had marked unsubscribed. The delivery
 * path (broadcast sending) stays in the API, because it needs the send
 * pipeline; everything up to "here is the frozen list" lives here.
 */
export {
  addContacts,
  archiveAudience,
  audienceStats,
  contactsFromCsv,
  createAudience,
  getAudience,
  importCsv,
  isMailableEmail,
  isRoleAddress,
  listAudienceContacts,
  listAudiences,
  normalizeEmail,
  parseCsv,
  searchAudienceContacts,
  MAX_IMPORT_ROWS,
  type ConsentSource,
  type ContactInput,
  type ImportCounts,
  type ParsedContacts,
} from "./audience-service.js";

export {
  consentHistory,
  findContact,
  recordResubscribe,
  recordUnsubscribe,
  type ConsentContext,
  type ResubscribeSource,
  type UnsubscribeSource,
} from "./consent-service.js";
