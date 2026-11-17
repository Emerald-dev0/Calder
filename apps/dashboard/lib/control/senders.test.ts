import { describe, it, expect } from "vitest";
import {
  DEFAULT_AUTH_SENDER,
  companySenders,
  defaultCompanySender,
  findCompanySender,
  parseSenderEntry,
} from "./senders";

const env = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({ ...overrides }) as NodeJS.ProcessEnv;

describe("parseSenderEntry", () => {
  it("reads a display name and an address", () => {
    expect(parseSenderEntry("Calder Support <support@calder.click>")).toEqual({
      email: "support@calder.click",
      name: "Calder Support",
      label: "Calder Support <support@calder.click>",
    });
  });

  it("accepts a bare address and lowercases it", () => {
    expect(parseSenderEntry("Hello@Calder.Click")).toEqual({
      email: "hello@calder.click",
      name: null,
      label: "hello@calder.click",
    });
  });

  it("refuses things that cannot be an address", () => {
    for (const value of ["", "   ", "hello", "hello@", "@calder.click", "Calder <hello>"]) {
      expect(parseSenderEntry(value)).toBeNull();
    }
  });

  it("drops a display name that could break the header, keeping the address", () => {
    // A name is a courtesy. It is not a place to smuggle a second header.
    const parsed = parseSenderEntry("Bad\r\nBcc: x@y.z <hello@calder.click>");
    expect(parsed?.email).toBe("hello@calder.click");
    expect(parsed?.label).toBe("hello@calder.click");
  });
});

describe("companySenders", () => {
  it("is the declared list plus the transactional sender, default first", () => {
    const senders = companySenders(
      env({
        COMPANY_EMAIL_SENDERS: "Calder Support <support@calder.click>, updates@calder.click",
        AUTH_EMAIL_FROM: "Calder <hello@calder.click>",
      })
    );
    expect(senders.map((sender) => sender.email)).toEqual([
      "support@calder.click",
      "updates@calder.click",
      "hello@calder.click",
    ]);
  });

  it("collapses the auth sender when it is declared too", () => {
    const senders = companySenders(
      env({
        COMPANY_EMAIL_SENDERS: "Calder <hello@calder.click>",
        AUTH_EMAIL_FROM: "hello@calder.click",
      })
    );
    expect(senders.map((sender) => sender.email)).toEqual(["hello@calder.click"]);
  });

  it("falls back to the known auth sender when nothing is configured", () => {
    const senders = companySenders(env());
    expect(senders).toHaveLength(1);
    expect(senders[0]?.label).toBe(DEFAULT_AUTH_SENDER);
    expect(defaultCompanySender(env()).email).toBe("hello@calder.click");
  });

  it("ignores unusable entries instead of inventing one", () => {
    const senders = companySenders(
      env({ COMPANY_EMAIL_SENDERS: "nonsense, , hello@calder.click" })
    );
    expect(senders.map((sender) => sender.email)).toEqual(["hello@calder.click"]);
  });
});

describe("findCompanySender", () => {
  const envWithList = env({
    COMPANY_EMAIL_SENDERS: "Calder Support <support@calder.click>",
    AUTH_EMAIL_FROM: "Calder <hello@calder.click>",
  });

  it("matches by address, case-insensitively", () => {
    expect(findCompanySender("Support@Calder.Click", envWithList)?.email).toBe(
      "support@calder.click"
    );
  });

  it("refuses anything not on the list — including free text", () => {
    // The action turns null into a refusal. A fallback here would silently send
    // from a different address than the one on screen.
    expect(findCompanySender("noreply@evil.example", envWithList)).toBeNull();
    expect(findCompanySender("Calder Support", envWithList)).toBeNull();
    expect(findCompanySender("", envWithList)).toBeNull();
    expect(findCompanySender(undefined, envWithList)).toBeNull();
  });
});
