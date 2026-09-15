import pino, { type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

const isDev = process.env.NODE_ENV === "development";

function createPinoOptions(level: string = process.env.LOG_LEVEL ?? "info") {
  if (isDev) {
    // pino-pretty is a dev-only pretty printer loaded via dynamic require by
    // pino's transport. In bundled/serverless runs (Vercel) the string target
    // is not statically traceable and the file may not be included, so verify
    // it can be resolved before asking pino to use it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require.resolve("pino-pretty");
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
    } catch {
      // Fall through to JSON logger when pino-pretty is not bundled.
    }
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
  try {
    return pino({ ...base, ...options });
  } catch (err) {
    // pino throws "unable to determine transport target for pino-pretty" when
    // the pretty printer is not in the function's file set (Vercel tracing).
    // Fall back to JSON logging rather than crashing the whole function.
    const hasTransport = !!(base as { transport?: unknown }).transport;
    if (hasTransport) {
      const { transport: _t, ...rest } = base as pino.LoggerOptions & { transport?: unknown };
      return pino({ ...rest, ...options } as pino.LoggerOptions);
    }
    throw err;
  }
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
