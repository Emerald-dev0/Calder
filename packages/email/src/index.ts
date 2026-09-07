export {
  type EmailProvider,
  type EmailMessage,
  type ProviderSendResult,
  type ProviderError,
  MockEmailProvider,
  isProviderError,
} from "./provider";
export { createEmailService, type EmailService } from "./service";
export {
  type DomainVerificationProvider,
  type VerificationResult,
  DnsVerificationProvider,
  VercelVerificationProvider,
  CompositeVerificationProvider,
} from "./domain-verification";
