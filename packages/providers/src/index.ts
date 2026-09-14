export {
  SesEmailProvider,
  createSesProvider,
  getSesAccountStatus,
  type SesAccountStatus,
} from "./ses";
export {
  GmailTransport,
  createGmailTransport,
  buildGmailMime,
  base64UrlEncode,
  GMAIL_SEND_SCOPE,
  type GmailCredentials,
} from "./gmail";
export { CalderEmailProvider, createCalderProvider } from "./calder";
export { MockEmailProvider } from "@calder/email";
export type { EmailProvider, EmailMessage, ProviderSendResult } from "@calder/email";
export {
  resolveEmailProvider,
  EmailProviderNotConfiguredError,
  type EmailProviderStatus,
  type ResolveEmailProviderOptions,
} from "./resolve";
