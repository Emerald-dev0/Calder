import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The schedule guard.
 *
 * A cron route that nothing schedules is not a feature, it is a comment. That
 * is exactly how the maintenance sweep — credit expiry, crashed-lease
 * reaping, payment reconciliation — spent months defined and never run: the
 * route existed, `vercel.json` did not mention it, and no test could tell the
 * difference between "deployed" and "running".
 *
 * These assertions are deliberately about the *wiring*, not the work: the
 * work is covered by its own tests. What is checked here is that every
 * schedule points at a route that exists, that the plan's job limit is not
 * silently exceeded, and that the one scheduled tick still carries the jobs
 * that have no schedule of their own.
 */

const vercelJson = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
) as { crons?: Array<{ path: string; schedule: string }> };

const cronSource = readFileSync(new URL("./cron.ts", import.meta.url), "utf8");

/** Routes declared on the cron router (`cron.on([...], "/x", ...)`). */
const declaredPaths = [
  ...cronSource.matchAll(/cron\.(?:on\(\[[^\]]*\],\s*|get\(|post\()"(\/[^"]+)"/g),
].map((m) => m[1] as string);

const scheduled = (vercelJson.crons ?? []).map((c) => c.path);

describe("cron wiring", () => {
  it("schedules at least one job", () => {
    expect(scheduled.length).toBeGreaterThan(0);
  });

  it("only schedules routes the cron router actually declares", () => {
    for (const path of scheduled) {
      expect(path.startsWith("/v1/cron/"), `${path} is not under the cron router`).toBe(true);
      const suffix = path.slice("/v1/cron".length);
      expect(declaredPaths, `${path} has no route in cron.ts`).toContain(suffix);
    }
  });

  it("stays within the two cron jobs the Hobby plan allows", () => {
    // Exceeding this is a build-time error on Vercel, not a runtime one, so it
    // is checked here where the failure is readable.
    expect(scheduled.length).toBeLessThanOrEqual(2);
  });

  it("keeps every declared route reachable by hand", () => {
    // A route that is not scheduled may still be an operator tool; what must
    // never happen is a scheduled path with no handler, checked above.
    expect(declaredPaths).toContain("/maintenance");
    expect(declaredPaths).toContain("/drain");
  });

  it("runs the maintenance sweep on the one scheduled daily tick", () => {
    // Vercel Hobby has no spare schedule, so the daily drain tick is the only
    // clock the platform has. Anything that must happen daily has to be
    // called from it — asserted against the handler body, not the file at
    // large, so moving the call somewhere unreachable fails here.
    const start = cronSource.indexOf('"/drain"');
    expect(start).toBeGreaterThan(-1);
    const handler = cronSource.slice(start, cronSource.indexOf("cron.on(", start + 1));
    expect(handler).toContain("runScheduledMaintenance(");
    expect(handler).toContain("drainPendingEmails(");
    expect(handler).toContain("runQueueProcessor(");
  });
});
