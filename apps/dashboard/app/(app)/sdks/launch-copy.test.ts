import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("../onboarding/actions", () => ({ createTestKey: vi.fn() }));
import { SdkHub } from "./client";
it("offers HTTP examples without unverified SDK installs", () => {
  const html = renderToStaticMarkup(
    createElement(SdkHub, { projectId: "proj_fixture", hasKeys: true })
  );
  expect(html).toContain("Node.js");
  expect(html).toContain("Python");
  expect(html).toContain("cURL");
  expect(html).toContain("distribution is not verified");
  expect(html).not.toMatch(/npm install calder|pip install calder|Node SDK|Python SDK/);
  if (process.env.UI_QA_DIR) {
    mkdirSync(process.env.UI_QA_DIR, { recursive: true });
    writeFileSync(join(process.env.UI_QA_DIR, "http-examples.html"), html);
  }
});
