import { randomUUID } from "node:crypto";

export const requestIdHeader = "x-request-id" as const;

/**
 * Generate a request ID with prefix req_ for identification in logs/errors.
 */
export function generateRequestId(): string {
 return `req_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
