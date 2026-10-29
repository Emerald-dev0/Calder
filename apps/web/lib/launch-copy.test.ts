import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHANGELOG } from "./changelog";
it("links the actual merged packaging fixes, not the pending wake-up patch, as shipped history", () => {
  const commits = CHANGELOG.flatMap((entry) => [...entry.commits]);
  expect(commits).toContain("d16774cae8");
  expect(commits).toContain("646b4fe52b");
  expect(commits).not.toContain("2405986");
  for (const sha of commits) expect(sha).toMatch(/^[0-9a-f]{10}$/);
});
it("states billing and SDK publication limits on the public availability page", () => {
  const source = readFileSync(
    new URL("../app/docs/availability/page.tsx", import.meta.url),
    "utf8"
  );
  expect(source.replace(/\s+/g, " ")).toContain("not configured");
  expect(source).toContain("distribution: not verified");
  expect(source).toContain("PR #87");
});
