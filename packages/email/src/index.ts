export {
  type EmailProvider,
  type EmailMessage,
  type ProviderSendResult,
  type ProviderError,
  MockEmailProvider,
  isProviderError,
} from "./provider.js";
export { createEmailService, type EmailService } from "./service.js";
export {
  type DomainVerificationProvider,
  type VerificationResult,
  DnsVerificationProvider,
  VercelVerificationProvider,
  CompositeVerificationProvider,
} from "./domain-verification.js";
