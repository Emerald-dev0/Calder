export {
  SesEmailProvider,
  createSesProvider,
  getSesAccountStatus,
  createSesDomainIdentity,
  getSesDomainIdentity,
  type SesAccountStatus,
  type SesIdentityDnsRecord,
} from "./ses.js";
export {
  GmailTransport,
  createGmailTransport,
  buildGmailMime,
  base64UrlEncode,
  GMAIL_SEND_SCOPE,
  type GmailCredentials,
} from "./gmail.js";
export { CalderEmailProvider, createCalderProvider } from "./calder.js";
export { MockEmailProvider } from "@calder/email";
export type { EmailProvider, EmailMessage, ProviderSendResult } from "@calder/email";
export {
  resolveEmailProvider,
  EmailProviderNotConfiguredError,
  type EmailProviderStatus,
  type ResolveEmailProviderOptions,
} from "./resolve.js";
