import pino, { type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

const isDev = process.env.NODE_ENV !== "production";

function createPinoOptions(level: string = process.env.LOG_LEVEL ?? "info") {
 if (isDev) {
 return {
 level,
 transport: {
 target: "pino-pretty",
 options: {
 colorize: true,
 translateTime: "SYS:standard",
 ignore: "pid, hostname",
 },
 },
 } as pino.LoggerOptions;
 }
 return {
 level,
 formatters: {
 level(label: string) {
 return { level: label };
 },
 },
 timestamp: pino.stdTimeFunctions.isoTime,
 } as pino.LoggerOptions;
}

export function createLogger(options?: pino.LoggerOptions & { name?: string }): Logger {
 const base = createPinoOptions(options?.level as string | undefined);
 return pino({ ...base, ...options });
}

/**
 * Global logger. Prefer createLogger({ name }) per module in production code.
 */
export const logger = createLogger({ name: "calder" });

/**
 * Create a child logger with request-scoped context.
 */
export function loggerWithContext(base: Logger, context: Record<string, unknown>): Logger {
 return base.child(context);
}
