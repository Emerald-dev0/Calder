import { describe, expect, it, vi } from "vitest";
import { finishOptionalOnboarding } from "./optional-onboarding";

describe("finishing optional onboarding", () => {
  it("saves deferred sending before finishing and opening the dashboard", async () => {
    const calls: string[] = [];
    await finishOptionalOnboarding("proj_1", {
      deferSending: true,
      saveDeferred: async (project) => {
        calls.push(`save:${project}`);
      },
      complete: async () => {
        calls.push("complete");
      },
      openDashboard: (project) => {
        calls.push(`open:${project}`);
      },
    });
    expect(calls).toEqual(["save:proj_1", "complete", "open:proj_1"]);
  });
  it("skips the test without changing the already chosen sending setup", async () => {
    const saveDeferred = vi.fn();
    const complete = vi.fn(async () => {});
    const openDashboard = vi.fn();
    await finishOptionalOnboarding("proj_1", {
      deferSending: false,
      saveDeferred,
      complete,
      openDashboard,
    });
    expect(saveDeferred).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
    expect(openDashboard).toHaveBeenCalledWith("proj_1");
  });
  it("never completes or navigates when saving the deferred choice fails", async () => {
    const complete = vi.fn();
    const openDashboard = vi.fn();
    await expect(
      finishOptionalOnboarding("proj_1", {
        deferSending: true,
        saveDeferred: async () => {
          throw new Error("unavailable");
        },
        complete,
        openDashboard,
      })
    ).rejects.toThrow("unavailable");
    expect(complete).not.toHaveBeenCalled();
    expect(openDashboard).not.toHaveBeenCalled();
  });
  it("does not navigate if completion fails", async () => {
    const openDashboard = vi.fn();
    await expect(
      finishOptionalOnboarding("proj_1", {
        deferSending: false,
        saveDeferred: vi.fn(),
        complete: async () => {
          throw new Error("unavailable");
        },
        openDashboard,
      })
    ).rejects.toThrow("unavailable");
    expect(openDashboard).not.toHaveBeenCalled();
  });
});
