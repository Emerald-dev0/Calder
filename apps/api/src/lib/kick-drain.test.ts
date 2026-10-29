import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ waitUntil: vi.fn(), wake: vi.fn(), warn: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: mocks.waitUntil }));
vi.mock("@calder/queue", () => ({ wakeDeliveryDrain: mocks.wake }));
vi.mock("@calder/observability", () => ({ logger: { warn: mocks.warn } }));
import { kickDrain, executionCtxOf } from "./kick-drain.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.wake.mockResolvedValue({ ok: true });
});
describe("API post-response wake-up", () => {
  it("registers with Vercel when Hono has no execution context", async () => {
    kickDrain();
    expect(mocks.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    await mocks.waitUntil.mock.calls[0]?.[0];
  });
  it("uses a supplied host lifecycle", () => {
    const waitUntil = vi.fn();
    kickDrain({ waitUntil });
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });
  it("does not drop closely spaced enqueue wake-ups", () => {
    kickDrain();
    kickDrain();
    expect(mocks.wake).toHaveBeenCalledTimes(2);
    expect(mocks.waitUntil).toHaveBeenCalledTimes(2);
  });
  it("logs safe wake-up failures", async () => {
    mocks.wake.mockResolvedValue({ ok: false, reason: "http_error", status: 401 });
    kickDrain();
    await mocks.waitUntil.mock.calls[0]?.[0];
    expect(mocks.warn).toHaveBeenCalledWith(
      { ok: false, reason: "http_error", status: 401 },
      expect.any(String)
    );
  });
  it("handles Hono throwing on executionCtx access", () => {
    expect(
      executionCtxOf({
        get executionCtx() {
          throw new Error("not available");
        },
      })
    ).toBeUndefined();
  });
});
