import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ after: vi.fn(), wake: vi.fn(), warn: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@calder/queue", () => ({ wakeDeliveryDrain: mocks.wake }));
vi.mock("@calder/observability", () => ({ logger: { warn: mocks.warn } }));
import { scheduleDeliveryDrain } from "./wake-drain";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.wake.mockResolvedValue({ ok: true });
});
it("wakes only in Next's post-response lifecycle", async () => {
  scheduleDeliveryDrain();
  expect(mocks.wake).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0]?.[0]();
  expect(mocks.wake).toHaveBeenCalledTimes(1);
});
it("makes wake-up errors observable without undoing acceptance", async () => {
  mocks.wake.mockResolvedValue({ ok: false, reason: "missing_secret" });
  scheduleDeliveryDrain();
  await mocks.after.mock.calls[0]?.[0]();
  expect(mocks.warn).toHaveBeenCalledWith(
    { ok: false, reason: "missing_secret" },
    expect.any(String)
  );
});
it.each(["./transactional.ts", "../senders/service.ts", "../control/editor-actions.ts"])(
  "%s schedules a wake-up after queue enqueue",
  (path) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).toMatch(
      /await queue\.enqueue\("send-email"[^\n]+\n\s+scheduleDeliveryDrain\(\);/
    );
  }
);
