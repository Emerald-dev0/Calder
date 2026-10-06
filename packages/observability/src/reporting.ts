import type * as SentryTypes from "@sentry/node";
import { getConfig, getDeployEnv } from "@calder/config";
import { logger } from "./logger.js";
import { classifyError, describeClassification, type ErrorClassification } from "./errors.js";
import { redactValue, redactText, REDACTED } from "./redact.js";

/**
 * Error reporting.
 *
 * Calder has exactly one error-tracking integration, wired here. It is
 * opt-in: without SENTRY_DSN this is a structured-log sink and nothing leaves
 * the process. That is deliberate — local development and CI must never ship
 * failures anywhere, and a deploy without a DSN must still record them.
 *
 * Sentry is loaded lazily so the dependency costs nothing at boot when unused.
 * Captured context is deliberately limited to identifiers and classification:
 * no request bodies, no headers, no message payloads, no secrets (see
 * `redact.ts` and the `beforeSend` scrubber below).
 */

export interface ErrorContext {
  /** "api" | "worker" | "dashboard" | "script" — which process saw it. */
  service: string;
  requestId?: string;
  organizationId?: string;
  projectId?: string;
  jobId?: string;
  emailId?: string;
  route?: string;
  /** Free-form identifiers only. Values are redacted before they leave. */
  [key: string]: unknown;
}

export interface ErrorReportingStatus {
  enabled: boolean;
  service: string;
  environment: string;
}

let sentry: typeof SentryTypes | null = null;
let initPromise: Promise<ErrorReportingStatus> | null = null;
let status: ErrorReportingStatus = { enabled: false, service: "unknown", environment: "unknown" };

/**
 * Initialize reporting once per process. Safe to call from several entry
 * points (serverless module + request path); repeat calls return the same
 * promise and never re-initialize.
 */
export function initErrorReporting(opts: { service: string }): Promise<ErrorReportingStatus> {
  if (initPromise) return initPromise;
  const config = getConfig();
  const environment = config.SENTRY_ENVIRONMENT ?? getDeployEnv();
  status = { enabled: false, service: opts.service, environment };

  initPromise = (async () => {
    if (!config.SENTRY_DSN) {
      logger.info(
        { service: opts.service, environment, errorTracking: "log-only" },
        "Error tracking is not configured (SENTRY_DSN unset); failures are logged, not shipped"
      );
      return status;
    }
    try {
      const mod = await import("@sentry/node");
      mod.init({
        dsn: config.SENTRY_DSN,
        environment,
        release: config.SENTRY_RELEASE,
        // Error tracking only by default. Tracing stays off unless a deploy
        // explicitly asks for it (SENTRY_TRACES_SAMPLE_RATE > 0).
        tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
        // Never attach IP addresses, cookies or request bodies by default.
        // (Sentry v11 dropped `sendDefaultPii`; `scrubEvent` below removes the
        // request payload regardless of what integrations collect.)
        beforeSend(event) {
          return scrubEvent(event as unknown as Record<string, unknown>) as never;
        },
      });
      sentry = mod;
      status = { enabled: true, service: opts.service, environment };
      logger.info({ service: opts.service, environment }, "Error tracking enabled");
    } catch (err) {
      // A broken tracker must never take the app down with it.
      logger.error(
        { err: redactText(err instanceof Error ? err.message : String(err)) },
        "Error tracking could not be initialized; continuing with log-only reporting"
      );
    }
    return status;
  })();

  return initPromise;
}

/** Await initialization (tests, graceful shutdown). */
export async function errorReportingReady(): Promise<ErrorReportingStatus> {
  if (!initPromise) return status;
  return initPromise;
}

export function errorReportingStatus(): ErrorReportingStatus {
  return status;
}

/**
 * Capture a server-side failure. Expected client errors are logged at the
 * matching level and never become error-tracking events (alert fatigue).
 */
export function captureError(err: unknown, context: ErrorContext): ErrorClassification {
  const classification = classifyError(err);
  const message = err instanceof Error ? err.message : String(err);
  const safeMessage = redactText(message, 500);
  const base = {
    service: context.service,
    class: classification.class,
    severity: classification.severity,
    errorReason: classification.reason,
    requestId: context.requestId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    jobId: context.jobId,
    emailId: context.emailId,
    route: context.route,
  };

  // Log every failure with enough context to diagnose it from logs alone.
  const logPayload = {
    ...base,
    err: redactValue(err instanceof Error ? { message: err.message, name: err.name } : err),
  };
  if (classification.severity === "info") logger.info(logPayload, `handled: ${safeMessage}`);
  else if (classification.severity === "warning")
    logger.warn(logPayload, `failure: ${safeMessage}`);
  else logger.error(logPayload, `failure: ${safeMessage}`);

  const client = sentry;
  if (classification.reportable && client) {
    try {
      client.withScope((scope) => {
        scope.setLevel(sentryLevel(classification.severity));
        scope.setTag("service", context.service);
        scope.setTag("error_class", classification.class);
        scope.setTag("error_reason", classification.reason);
        if (context.requestId) scope.setTag("request_id", String(context.requestId));
        if (context.organizationId) scope.setTag("organization_id", String(context.organizationId));
        if (context.projectId) scope.setTag("project_id", String(context.projectId));
        if (context.jobId) scope.setTag("job_id", String(context.jobId));
        if (context.emailId) scope.setTag("email_id", String(context.emailId));
        if (context.route) scope.setTag("route", String(context.route));
        scope.setContext("calder", {
          classification: describeClassification(classification),
          ...(redactValue(context) as Record<string, unknown>),
        });
        client.captureException(err);
      });
    } catch {
      // Reporting must never throw into the request path.
    }
  }

  return classification;
}

/** Capture a message (e.g. an alert breach). Always logged; shipped when enabled. */
export function captureMessage(
  message: string,
  context: ErrorContext & {
    severity?: "info" | "warning" | "error" | "fatal";
    fingerprint?: string;
  }
): void {
  const severity = context.severity ?? "warning";
  const payload = {
    service: context.service,
    severity,
    ...(redactValue(context) as Record<string, unknown>),
  };
  const safeMessage = redactText(message, 500);
  if (severity === "info") logger.info(payload, safeMessage);
  else if (severity === "warning") logger.warn(payload, safeMessage);
  else logger.error(payload, safeMessage);

  const client = sentry;
  if (client) {
    try {
      client.withScope((scope) => {
        scope.setLevel(sentryLevel(severity));
        scope.setTag("service", context.service);
        if (context.service) scope.setTag("alert_source", context.service);
        if (context.fingerprint) scope.setFingerprint([context.fingerprint]);
        scope.setContext("calder", redactValue(context) as Record<string, unknown>);
        client.captureMessage(redactText(message, 500));
      });
    } catch {
      // ignore
    }
  }
}

/** Flush buffered events before a process exits. */
export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  try {
    await sentry.flush(timeoutMs);
  } catch {
    // ignore
  }
}

function sentryLevel(severity: "info" | "warning" | "error" | "fatal"): SentryTypes.SeverityLevel {
  // Sentry's level union is wider ("log", "debug"); the four Calder severities
  // map onto it directly and are valid SeverityLevel values.
  return severity;
}

/**
 * Strip anything that could carry a secret or customer payload from an event
 * before it is shipped. Request bodies, cookies, headers and query strings are
 * dropped wholesale; message/exception text is pattern-scrubbed.
 */
export function scrubEvent<T extends Record<string, unknown>>(event: T): T {
  const copy = { ...event } as Record<string, unknown>;

  if (copy.request && typeof copy.request === "object") {
    const request = { ...(copy.request as Record<string, unknown>) };
    delete request.data;
    delete request.cookies;
    delete request.headers;
    if (typeof request.query_string === "string") request.query_string = "";
    if (typeof request.url === "string") {
      try {
        const parsed = new URL(request.url);
        request.url = `${parsed.origin}${parsed.pathname}`;
      } catch {
        request.url = REDACTED;
      }
    }
    copy.request = request;
  }

  if (typeof copy.message === "string") copy.message = redactText(copy.message);
  const exception = copy.exception as { values?: Array<{ value?: string }> } | undefined;
  if (exception?.values) {
    copy.exception = {
      ...exception,
      values: exception.values.map((v) =>
        v && typeof v.value === "string" ? { ...v, value: redactText(v.value) } : v
      ),
    };
  }
  for (const extraKey of ["extra", "contexts", "tags"]) {
    if (copy[extraKey] && typeof copy[extraKey] === "object") {
      copy[extraKey] = redactValue(copy[extraKey]);
    }
  }
  return copy as T;
}
