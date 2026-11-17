#!/usr/bin/env node
/**
 * CI dependency gate.
 *
 * pnpm exits non-zero for any advisory, including low/moderate findings. The
 * project policy is stricter for exploitable production risk: high and critical
 * findings fail CI; low/moderate findings remain visible in the report and
 * require an owner/expiry entry in SECURITY.md if they cannot be upgraded.
 *
 * A high finding with no released fix is the one case the policy names but the
 * gate could not express: "remediation **or an approved, time-bound
 * exception**". `security/audit-exceptions.json` is that exception — an entry
 * names the advisory, the owner, the reason and the date it stops counting. It
 * is deliberately narrow:
 *
 *  - only high and critical findings consult it (moderate findings never fail);
 *  - an expired entry suppresses nothing, so an exception cannot outlive its
 *    owner's attention;
 *  - an entry that matches no advisory is reported as stale, so the file cannot
 *    quietly fill with history.
 *
 * The alternative — quietly scoping the audit to production dependencies —
 * would hide exactly the advisory someone needed to see.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const EXCEPTIONS_PATH = "security/audit-exceptions.json";

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

function loadExceptions() {
  try {
    const parsed = JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8"));
    return Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    console.error(`Could not read ${EXCEPTIONS_PATH}: ${err.message}`);
    process.exit(1);
  }
}

const today = new Date().toISOString().slice(0, 10);
const exceptions = loadExceptions();
const used = new Set();
const blocking = [];

for (const advisory of Object.values(report.advisories ?? {})) {
  if (advisory.severity !== "high" && advisory.severity !== "critical") continue;
  const exception = exceptions.find(
    (entry) => Number(entry.id) === Number(advisory.id) && entry.module === advisory.module_name
  );
  if (exception && String(exception.expires) >= today) {
    used.add(Number(exception.id));
    console.warn(
      `accepted until ${exception.expires} (${exception.owner}): ${advisory.severity} ` +
        `${advisory.module_name} — ${advisory.title}`
    );
  } else {
    blocking.push(advisory);
  }
}

// An entry that suppressed nothing is either already fixed (remove it) or past
// its date (renew it on purpose, or upgrade). Either way it must not sit here
// looking like coverage.
for (const entry of exceptions) {
  if (used.has(Number(entry.id))) continue;
  console.warn(
    String(entry.expires) < today
      ? `stale exception: advisory ${entry.id} (${entry.module}) expired on ${entry.expires} — upgrade, or renew it deliberately.`
      : `stale exception: advisory ${entry.id} (${entry.module}) was not reported this run — remove the entry.`
  );
}

if (blocking.length > 0) {
  console.error(
    "Dependency audit failed: high/critical findings require remediation or an approved, time-bound exception."
  );
  for (const advisory of blocking) {
    console.error(`- ${advisory.id} ${advisory.severity}: ${advisory.title}`);
  }
  process.exit(1);
}

if (result.status !== 0) {
  console.warn("pnpm reported only below-threshold findings; review them against the owner/expiry policy.");
}
