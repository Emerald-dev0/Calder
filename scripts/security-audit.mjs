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

const APPROVED_EXCEPTIONS = new Set([
  "1243066", // Zod <4.6.6 (Zod v3 is used in codebase; v4 has breaking API changes)
]);

const unexceptedAdvisories = Object.values(report.advisories ?? {}).filter(
  (advisory) =>
    (advisory.severity === "high" || advisory.severity === "critical") &&
    !APPROVED_EXCEPTIONS.has(String(advisory.id))
);

if (unexceptedAdvisories.length > 0) {
  console.error(
    "Dependency audit failed: high/critical findings require remediation or an approved, time-bound exception."
  );
  for (const advisory of unexceptedAdvisories) {
    console.error(`- ${advisory.id} ${advisory.severity}: ${advisory.title}`);
  }
  process.exit(1);
}

if (result.status !== 0) {
  console.warn("pnpm reported only below-threshold findings; review them against the owner/expiry policy.");
}
