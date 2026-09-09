import type { EmailProvider, ProviderSendResult } from "./provider";

/**
 * EmailTransport, what actually moves a message toward an inbox.
 *
 * Extends EmailProvider (same send contract, so transports stay drop-in
 * compatible with the existing pipeline) with the metadata the system needs
 * to route, cap, and observe delivery without knowing the underlying service:
 * Gmail today, SES and managed infrastructure tomorrow.
 */

export type TransportType = "gmail" | "ses" | "managed" | "mock";

export interface TransportCapabilities {
 /** Max sends per UTC day enforced before handing to the provider. Null = provider default. */
 dailyLimit: number | null;
 /** Max bytes per message accepted. */
 maxMessageBytes: number;
 /** Whether open/click tracking is available on this transport. */
 supportsTracking: boolean;
 /** Whether template rendering is available on this transport. */
 supportsTemplates: boolean;
 /** Human-readable constraints, shown in dashboard/docs. */
 notes: string[];
}

export interface TransportHealth {
 healthy: boolean;
 latencyMs?: number;
 detail?: string;
 checkedAt: Date;
}

export interface EmailTransport extends EmailProvider {
 readonly transportType: TransportType;
 getCapabilities(): TransportCapabilities;
 healthCheck(): Promise<TransportHealth>;
}

/** Conservative Gmail caps: free accounts allow 500/day, Workspace 2000/day.
 * We stay well under both, Gmail is the on-ramp, not bulk infrastructure. */
export const GMAIL_FREE_DAILY_CAP = 400;
export const GMAIL_WORKSPACE_DAILY_CAP = 1500;

/** Minimal shape the worker needs to route. Mirrors project_transports rows. */
export interface TransportRecord {
 id: string;
 projectId: string;
 type: string;
 status: string;
 label: string;
 encryptedCredentials: { iv: string; ciphertext: string; tag: string } | null;
 dailyCap: number | null;
 isDefault: boolean;
}

/**
 * Pure selection: the active default wins; otherwise no transport (caller
 * falls back to the global SES/mock provider). Suspended/revoked rows never
 * send, even if marked default, fail closed.
 */
export function pickDefaultTransport(rows: TransportRecord[]): TransportRecord | null {
 const active = rows.filter((r) => r.status === "active");
 return active.find((r) => r.isDefault) ?? null;
}

export function transportResult(providerMessageId: string, provider: string): ProviderSendResult {
 return { providerMessageId, provider, accepted: true };
}
