import { describe, it, expect } from "vitest";
import { ALERT_CATALOG, evaluateAlerts, formatAlert, type AlertThresholds } from "./alerts.js";
import { classifyError } from "./errors.js";
import { RequestMetrics, SlidingCounter } from "./metrics.js";

const thresholds: AlertThresholds = {
  queueDepthWarn: 100,
  oldestJobWarnSeconds: 600,
  dlqWarn: 10,
  enqueueFailureWarn: 3,
  workerHeartbeatStaleSeconds: 120,
  workerJobFailureWarn: 5,
  api5xxWarnPercent: 5,
  api5xxMinRequests: 20,
  apiLatencyWarnMs: 3000,
  providerFailureWarn: 10,
};

describe("evaluateAlerts", () => {
  it("stays silent on an empty signal set (never alerts on an unknown)", () => {
    expect(evaluateAlerts({}, thresholds)).toEqual([]);
  });

  it("raises Redis and database unavailability", () => {
    const active = evaluateAlerts({ redisOk: false, databaseOk: false }, thresholds);
    expect(active.map((a) => a.id).sort()).toEqual(["database_unavailable", "redis_unavailable"]);
    expect(active.every((a) => a.severity === "critical")).toBe(true);
  });

  it("raises enqueue failures only past the configured count", () => {
    expect(evaluateAlerts({ enqueueFailures: 2 }, thresholds)).toEqual([]);
    const active = evaluateAlerts({ enqueueFailures: 3 }, thresholds);
    expect(active[0]!.id).toBe("queue_enqueue_failures");
  });

  it("raises stale queue depth and old jobs separately", () => {
    const depth = evaluateAlerts({ queueDepth: 101 }, thresholds);
    expect(depth.map((a) => a.id)).toEqual(["queue_depth_high"]);
    const old = evaluateAlerts({ oldestJobAgeSeconds: 601 }, thresholds);
    expect(old.map((a) => a.id)).toEqual(["queue_oldest_job_stale"]);
    expect(old[0]!.severity).toBe("critical");
  });

  it("raises dead-letter growth", () => {
    expect(evaluateAlerts({ dlqDepth: 11 }, thresholds)[0]!.id).toBe("queue_dlq_growth");
  });

  it("treats a missing worker heartbeat as critical but leaves empty-worker systems alone when unchecked", () => {
    const none = evaluateAlerts(
      { workerHeartbeatCount: 0, freshestHeartbeatAgeSeconds: null },
      thresholds
    );
    expect(none[0]!.id).toBe("worker_no_heartbeat");
    // Not measured at all → no alert.
    expect(evaluateAlerts({ workerHeartbeatCount: 0 }, thresholds)).toEqual([]);
  });

  it("raises API 5xx only above the minimum request volume", () => {
    expect(evaluateAlerts({ apiRequests: 10, api5xx: 10 }, thresholds)).toEqual([]);
    const active = evaluateAlerts({ apiRequests: 100, api5xx: 6 }, thresholds);
    expect(active[0]!.id).toBe("api_5xx_rate");
  });

  it("raises latency, provider and job-failure rules from their windows", () => {
    expect(evaluateAlerts({ apiSlowestMs: 3001 }, thresholds)[0]!.id).toBe("api_latency_degraded");
    expect(evaluateAlerts({ providerFailures: 10 }, thresholds)[0]!.id).toBe(
      "provider_failure_sustained"
    );
    expect(evaluateAlerts({ exhaustedJobs: 5 }, thresholds)[0]!.id).toBe(
      "worker_repeated_job_failures"
    );
  });

  it("raises the durable queued-email rule when the drain stops", () => {
    const active = evaluateAlerts(
      { queuedEmailCount: 12, oldestQueuedEmailAgeSeconds: 4000 },
      thresholds
    );
    expect(active[0]!.id).toBe("queued_email_age");
    expect(formatAlert(active[0]!)).toContain("queued_email_age");
  });

  it("documents every rule in the catalog", () => {
    for (const alert of ALERT_CATALOG) {
      expect(alert.trigger.length).toBeGreaterThan(10);
      expect(alert.meaning.length).toBeGreaterThan(10);
      expect(alert.check.length).toBeGreaterThan(10);
      expect(alert.response.length).toBeGreaterThan(10);
      expect(["critical", "warning"]).toContain(alert.severity);
    }
    // Catalog ids and evaluated ids must stay in sync.
    const raised = evaluateAlerts(
      {
        redisOk: false,
        databaseOk: false,
        enqueueFailures: 99,
        queueDepth: 10_000,
        oldestJobAgeSeconds: 10_000,
        dlqDepth: 10_000,
        queuedEmailCount: 10_000,
        oldestQueuedEmailAgeSeconds: 10_000,
        workerHeartbeatCount: 0,
        freshestHeartbeatAgeSeconds: null,
        exhaustedJobs: 99,
        providerFailures: 99,
        apiRequests: 100,
        api5xx: 100,
        apiSlowestMs: 99_999,
      },
      thresholds
    );
    expect(new Set(raised.map((a) => a.id))).toEqual(new Set(ALERT_CATALOG.map((a) => a.id)));
  });
});

describe("classifyError", () => {
  it("does not report expected client errors", () => {
    const cls = classifyError({ code: "validation_error", status: 400 });
    expect(cls.class).toBe("validation_error");
    expect(cls.reportable).toBe(false);
  });

  it("treats routine auth failures as client errors, not incidents", () => {
    // A public API sees constant 401s from misconfigured clients; reporting
    // them would bury real failures.
    const cls = classifyError({ code: "authentication_error", status: 401 });
    expect(cls.class).toBe("client_error");
    expect(cls.reportable).toBe(false);
    expect(cls.severity).toBe("info");
  });

  it("treats signature failures and lockouts as reportable security events", () => {
    for (const code of ["invalid_signature", "webhook_signature_invalid", "lockout"]) {
      const cls = classifyError({ code, status: 401 });
      expect(cls.class).toBe("security_event");
      expect(cls.reportable).toBe(true);
      expect(cls.severity).toBe("warning");
    }
  });

  it("routes deliberate sending blocks through application_failure", () => {
    const cls = classifyError({ code: "organization_sending_unavailable", status: 403 });
    expect(cls.class).toBe("application_failure");
    expect(cls.reportable).toBe(true);
  });

  it("keeps transient infrastructure failures out of error tracking", () => {
    expect(classifyError(Object.assign(new Error("timeout"), { transient: true })).reportable).toBe(
      false
    );
    expect(classifyError(Object.assign(new Error("boom"), { status: 503 })).class).toBe(
      "retryable_infrastructure"
    );
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:6379")).class).toBe(
      "retryable_infrastructure"
    );
  });

  it("reports provider rejections and unexpected exceptions", () => {
    expect(classifyError(Object.assign(new Error("no"), { code: "InvalidRecipient" })).class).toBe(
      "provider_rejection"
    );
    expect(classifyError(new Error("undefined is not a function")).class).toBe(
      "unexpected_exception"
    );
    expect(classifyError(new Error("undefined is not a function")).severity).toBe("error");
  });

  it("classifies zod-style issues as validation, not incidents", () => {
    expect(classifyError({ issues: [{ path: ["to"], message: "invalid" }] }).class).toBe(
      "validation_error"
    );
  });
});

describe("metrics windows", () => {
  it("counts only samples inside the window", () => {
    const metrics = new RequestMetrics();
    const now = Date.now();
    metrics.record(200, 30, now - 10 * 60_000);
    metrics.record(200, 40, now - 1000);
    metrics.record(500, 90, now - 500);
    const snap = metrics.snapshot(5, now);
    expect(snap.requests).toBe(2);
    expect(snap.errors5xx).toBe(1);
    expect(snap.slowestMs).toBe(90);
  });

  it("bounds memory under sustained traffic", () => {
    const metrics = new RequestMetrics({ maxSamples: 100 });
    for (let i = 0; i < 1000; i++) metrics.record(200, 1);
    expect(metrics.snapshot(5).requests).toBeLessThanOrEqual(100);
  });

  it("expires sliding counter events", () => {
    const counter = new SlidingCounter(15);
    const now = Date.now();
    counter.inc(1, now - 20 * 60_000);
    counter.inc(2, now);
    expect(counter.value(now)).toBe(2);
  });
});
