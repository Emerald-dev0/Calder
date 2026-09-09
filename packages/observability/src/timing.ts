import type { Logger } from "./logger";

export async function withTiming<T>(
 logger: Logger,
 operation: string,
 fn: () => Promise<T>,
 context: Record<string, unknown> = {}
): Promise<T> {
 const start = performance.now();
 try {
 const result = await fn();
 logger.info(
 { ...context, operation, durationMs: Math.round(performance.now() - start) },
 `${operation} completed`
 );
 return result;
 } catch (err) {
 logger.error(
 { ...context, operation, durationMs: Math.round(performance.now() - start), err },
 `${operation} failed`
 );
 throw err;
 }
}

export function measure(start: number): number {
 return Math.round(performance.now() - start);
}
