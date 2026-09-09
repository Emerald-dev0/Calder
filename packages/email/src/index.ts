export {
 type EmailProvider,
 type EmailMessage,
 type ProviderSendResult,
 type ProviderError,
 MockEmailProvider,
 isProviderError,
} from "./provider";
export { createEmailService, type EmailService } from "./service";
export { brandEmail, type BrandOptions } from "./brand";
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
} from "./transport";
export {
 type DomainVerificationProvider,
 type VerificationResult,
 DnsVerificationProvider,
 VercelVerificationProvider,
 CompositeVerificationProvider,
} from "./domain-verification";
