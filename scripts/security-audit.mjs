#!/usr/bin/env node
/**
 * CI dependency gate.
 *
 * pnpm exits non-zero for any advisory, including low/moderate findings. The
 * project policy is stricter for exploitable production risk: high and critical
 * findings fail CI; low/moderate findings remain visible in the report and
 * require an owner/expiry entry in SECURITY.md if they cannot be upgraded.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout || "");
} catch {
  console.error("Dependency audit did not return valid JSON.");
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

/**
 * Time-bound explicit advisory exceptions per SECURITY.md §10 policy.
 * Each entry must record: advisory ID -> { reason, owner, expiry (YYYY-MM-DD) }.
 */
const APPROVED_EXCEPTIONS = new Map([
  [
    1243066,
    {
      reason: "Zod array validation resource consumption advisory GHSA-mrhx-c7xc-m3w5 requires Zod 4 migration.",
      owner: "security",
      expiry: "2026-11-30",
    },
  ],
]);

const counts = report.metadata?.vulnerabilities ?? {};
const low = Number(counts.low ?? 0);
const moderate = Number(counts.moderate ?? 0);
const high = Number(counts.high ?? 0);
const critical = Number(counts.critical ?? 0);
const total = low + moderate + high + critical;
console.log(
  `Dependency audit: ${total} vulnerabilities ` +
    `(low=${counts.low ?? 0}, moderate=${counts.moderate ?? 0}, ` +
    `high=${high}, critical=${critical}).`
);

const today = new Date().toISOString().slice(0, 10);
const unapprovedHighCritical = Object.values(report.advisories ?? {}).filter((advisory) => {
  if (advisory.severity !== "high" && advisory.severity !== "critical") return false;
  const exception = APPROVED_EXCEPTIONS.get(Number(advisory.id));
  if (exception && exception.expiry >= today) {
    console.warn(
      `[SECURITY EXCEPTION] Advisory ${advisory.id} (${advisory.severity}) allowed until ${exception.expiry} (Owner: ${exception.owner}): ${exception.reason}`
    );
    return false;
  }
  return true;
});

if (unapprovedHighCritical.length > 0) {
  console.error(
    "Dependency audit failed: high/critical findings require remediation or an approved, time-bound exception."
  );
  for (const advisory of unapprovedHighCritical) {
    console.error(`- ${advisory.id} ${advisory.severity}: ${advisory.title}`);
  }
  process.exit(1);
}

if (result.status !== 0) {
  console.warn("pnpm reported only below-threshold findings; review them against the owner/expiry policy.");
}
