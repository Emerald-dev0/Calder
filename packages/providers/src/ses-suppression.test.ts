import { describe, expect, it, vi } from "vitest";
import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { getSuppressedDestination, listSuppressedDestinations } from "./ses.js";

/**
 * The account suppression list is the only authority on whether an address can
 * receive mail from this deployment, so the two failure modes that matter are:
 * a "not suppressed" answer must never throw (every clean send would fail), and
 * anything we cannot interpret must throw rather than be read as a pass.
 */

function stubClient(send: (command: unknown) => Promise<unknown>): SESv2Client {
  return { send } as unknown as SESv2Client;
}

function named(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe("getSuppressedDestination", () => {
  it("reports a bounce with its timestamp", async () => {
    const at = new Date("2026-01-02T03:04:05Z");
    const client = stubClient(async () => ({
      SuppressedDestination: { EmailAddress: "a@b.test", Reason: "BOUNCE", LastUpdateTime: at },
    }));
    await expect(getSuppressedDestination("a@b.test", client)).resolves.toEqual({
      suppressed: true,
      reason: "BOUNCE",
      lastUpdateTime: at,
    });
  });

  it("reports a complaint", async () => {
    const client = stubClient(async () => ({
      SuppressedDestination: { Reason: "COMPLAINT" },
    }));
    const result = await getSuppressedDestination("a@b.test", client);
    expect(result).toMatchObject({ suppressed: true, reason: "COMPLAINT" });
  });

  it("treats NotFoundException as 'not on the list', not as an error", async () => {
    const client = stubClient(async () => {
      throw named("NotFoundException");
    });
    await expect(getSuppressedDestination("clean@b.test", client)).resolves.toEqual({
      suppressed: false,
    });
  });

  it("lets any other failure escape so the sender can fail closed", async () => {
    const client = stubClient(async () => {
      throw named("ThrottlingException");
    });
    await expect(getSuppressedDestination("a@b.test", client)).rejects.toThrow();
  });

  it("asks about the address it was given", async () => {
    const send = vi.fn(async () => ({ SuppressedDestination: { Reason: "BOUNCE" } }));
    await getSuppressedDestination("someone@example.test", stubClient(send));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toHaveLength(1);
    const command = (send.mock.calls[0] as unknown[])[0] as { input: { EmailAddress: string } };
    expect(command.input.EmailAddress).toBe("someone@example.test");
  });
});

describe("listSuppressedDestinations", () => {
  it("maps entries and reports the continuation token", async () => {
    const client = stubClient(async () => ({
      SuppressedDestinationSummaries: [
        { EmailAddress: "one@b.test", Reason: "BOUNCE", LastUpdateTime: new Date("2026-01-01") },
        { EmailAddress: "two@b.test", Reason: "COMPLAINT" },
      ],
      NextToken: "page-2",
    }));
    const page = await listSuppressedDestinations({ client });
    expect(page.entries).toEqual([
      { email: "one@b.test", reason: "BOUNCE", lastUpdateTime: new Date("2026-01-01") },
      { email: "two@b.test", reason: "COMPLAINT", lastUpdateTime: null },
    ]);
    expect(page.nextToken).toBe("page-2");
  });

  it("reports completion as a null token, not an empty page", async () => {
    const client = stubClient(async () => ({
      SuppressedDestinationSummaries: [{ EmailAddress: "one@b.test", Reason: "BOUNCE" }],
    }));
    const page = await listSuppressedDestinations({ client });
    expect(page.nextToken).toBeNull();
  });

  it("skips entries SES returns without an address rather than writing a blank row", async () => {
    const client = stubClient(async () => ({
      SuppressedDestinationSummaries: [{ Reason: "BOUNCE" }, { EmailAddress: "ok@b.test" }],
    }));
    const page = await listSuppressedDestinations({ client });
    expect(page.entries.map((e) => e.email)).toEqual(["ok@b.test"]);
  });
});
