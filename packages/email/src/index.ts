export {
  type EmailProvider,
  type EmailMessage,
  type EmailAttachment,
  type ProviderSendResult,
  type ProviderError,
  MockEmailProvider,
  isProviderError,
} from "./provider.js";
export { createEmailService, type EmailService } from "./service.js";
export { brandEmail, type BrandOptions } from "./brand.js";
export {
  type EmailTransport,
  type TransportType,
  type TransportCapabilities,
  type TransportHealth,
  type TransportRecord,
  pickDefaultTransport,
  transportResult,
  GMAIL_FREE_DAILY_CAP,
  GMAIL_WORKSPACE_DAILY_CAP,
} from "./transport.js";
export {
  type DomainVerificationProvider,
  type VerificationResult,
  DnsVerificationProvider,
  VercelVerificationProvider,
  CompositeVerificationProvider,
} from "./domain-verification.js";
