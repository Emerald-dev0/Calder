import pino, { type Logger as PinoLogger } from "pino";
import { redactText } from "./redact.js";

export type Logger = PinoLogger;

const isDev = process.env.NODE_ENV === "development";

/**
 * Credential-shaped keys removed from every log line, whatever the caller
 * passes. The second layer is `serializers.err` + the reporting boundary,
 * which also pattern-scrub free-form text (connection URLs in error messages).
 */
const REDACT_PATHS = [
  "password",
  "*.password",
  "passwd",
  "*.passwd",
  "secret",
  "*.secret",
  "token",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.apiKey",
  "*.keyHash",
  "*.authorization",
  "authorization",
  "headers.authorization",
  "*.cookie",
  "cookie",
  "*.dsn",
  "dsn",
  "*.signature",
  "*.webhookSecret",
  "*.clientSecret",
  "*.otp",
  "*.verificationCode",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
];

export function createPinoOptions(level: string = process.env.LOG_LEVEL ?? "info") {
  const shared = {
    level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    serializers: {
      err(err: unknown) {
        if (err instanceof Error) {
          return {
            type: err.name,
            message: redactText(err.message),
            code: (err as { code?: unknown }).code,
          };
        }
        return err;
      },
      error(err: unknown) {
        if (err instanceof Error) {
          return { type: err.name, message: redactText(err.message) };
        }
        return err;
      },
    },
  };

  if (isDev) {
    // pino-pretty is a dev-only pretty printer loaded via dynamic require by
    // pino's transport. In bundled/serverless runs (Vercel) the string target
    // is not statically traceable and the file may not be included, so verify
    // it can be resolved before asking pino to use it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require.resolve("pino-pretty");
      return {
        ...shared,
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
    ...shared,
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
