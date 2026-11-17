import { describe, it, expect } from "vitest";
import { checkDmarc, checkDomainAuth, checkSpf, parseDmarc } from "./dns-auth.js";
import type { TxtOracle } from "./dns-challenge.js";

/**
 * SPF and DMARC readiness.
 *
 * These are the checks that were missing entirely: the records were printed as
 * copy-paste strings and never looked up, so a domain could read "verified"
 * while its SPF excluded SES and its DMARC policy rejected its own mail. Each
 * case below is a real failure mode, paired with the sentence we show.
 */

describe("SPF", () => {
  it("passes when the record includes Amazon SES", () => {
    const got = checkSpf(["v=spf1 include:amazonses.com ~all"]);
    expect(got.state).toBe("pass");
    expect(got.found).toEqual(["v=spf1 include:amazonses.com ~all"]);
  });

  it("ignores unrelated TXT records (verification, site ownership, Google)", () => {
    const got = checkSpf([
      "calder-verification=cvt_abc",
      "google-site-verification=xyz",
      "v=spf1 include:amazonses.com -all",
    ]);
    expect(got.state).toBe("pass");
    expect(got.found).toHaveLength(1);
  });

  it("calls out a missing record", () => {
    const got = checkSpf(["google-site-verification=xyz"]);
    expect(got.state).toBe("missing");
    expect(got.detail).toContain("v=spf1 include:amazonses.com");
  });

  it("treats two SPF records as broken, not as one valid one", () => {
    const got = checkSpf([
      "v=spf1 include:amazonses.com ~all",
      "v=spf1 include:_spf.google.com ~all",
    ]);
    expect(got.state).toBe("broken");
    // RFC 7208 §4.5: this is a permanent error, so every message fails.
    expect(got.detail).toContain("permanent error");
    expect(got.found).toHaveLength(2);
  });

  it("names the missing authorisation when SPF excludes SES", () => {
    const got = checkSpf(["v=spf1 include:_spf.google.com ~all"]);
    expect(got.state).toBe("broken");
    expect(got.detail).toContain("does not include Amazon SES");
  });

  it("refuses to bless +all even when it mentions SES", () => {
    const got = checkSpf(["v=spf1 include:amazonses.com +all"]);
    expect(got.state).toBe("broken");
    expect(got.detail).toContain("+all");
  });

  it("matches case-insensitively", () => {
    expect(checkSpf(["V=SPF1 INCLUDE:AMAZONSES.COM ~ALL"]).state).toBe("pass");
  });
});

describe("DMARC", () => {
  it("parses tags, defaults and alignment", () => {
    const parsed = parseDmarc("v=DMARC1; p=reject; aspf=s; adkim=s; pct=50; sp=quarantine");
    expect(parsed).toMatchObject({
      policy: "reject",
      spfAlignment: "strict",
      dkimAlignment: "strict",
      percentage: 50,
      subdomainPolicy: "quarantine",
    });
    // Absent tags mean relaxed alignment and full coverage, per the RFC.
    expect(parseDmarc("v=DMARC1; p=none")).toMatchObject({
      policy: "none",
      spfAlignment: "relaxed",
      dkimAlignment: "relaxed",
      percentage: 100,
    });
  });

  it("calls out a missing policy", () => {
    const got = checkDmarc([]);
    expect(got.state).toBe("missing");
    expect(got.detail).toContain("p=none");
  });

  it("flags p=reject with strict SPF alignment — the self-inflicted outage", () => {
    // The return path on SES is *.amazonses.com, which never aligns strictly
    // with the customer's From domain, so their own policy rejects their mail.
    const got = checkDmarc(["v=DMARC1; p=reject; aspf=s"]);
    expect(got.state).toBe("warning");
    expect(got.detail).toContain("amazonses.com");
    expect(got.detail).toContain("aspf=r");
  });

  it("accepts p=reject when only DKIM alignment is strict", () => {
    // DKIM is signed with the customer's own domain, so strict DKIM alignment
    // holds; only SPF alignment is the hazard.
    expect(checkDmarc(["v=DMARC1; p=reject; adkim=s"]).state).toBe("pass");
  });

  it("accepts an enforcing policy with relaxed alignment", () => {
    expect(checkDmarc(["v=DMARC1; p=quarantine; pct=100"]).state).toBe("pass");
  });

  it("says monitoring-only is not enforcement", () => {
    const got = checkDmarc(["v=DMARC1; p=none; rua=mailto:dmarc@example.com"]);
    expect(got.state).toBe("warning");
    expect(got.detail).toContain("spoofing");
  });

  it("flags partial coverage", () => {
    const got = checkDmarc(["v=DMARC1; p=reject; pct=25"]);
    expect(got.state).toBe("warning");
    expect(got.detail).toContain("25%");
  });

  it("rejects a record with no usable policy tag", () => {
    expect(checkDmarc(["v=DMARC1; rua=mailto:x@example.com"]).state).toBe("broken");
  });

  it("rejects duplicate records", () => {
    const got = checkDmarc(["v=DMARC1; p=none", "v=DMARC1; p=reject"]);
    expect(got.state).toBe("broken");
  });
});

describe("checkDomainAuth", () => {
  const oracle = (map: Record<string, string[]>): TxtOracle => {
    return async (host) => {
      const rows = map[host];
      if (!rows) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return rows;
    };
  };

  it("reads the apex and _dmarc in one pass", async () => {
    const report = await checkDomainAuth(
      "example.com",
      oracle({
        "example.com": ["v=spf1 include:amazonses.com ~all"],
        "_dmarc.example.com": ["v=DMARC1; p=quarantine"],
      })
    );
    expect(report.spf.state).toBe("pass");
    expect(report.dmarc.state).toBe("pass");
  });

  it("reports an unreadable lookup as broken-unknown, never as a pass", async () => {
    const report = await checkDomainAuth(
      "example.com",
      oracle({ "example.com": ["v=spf1 include:amazonses.com ~all"] })
    );
    expect(report.spf.state).toBe("pass");
    // No DMARC record vs DNS failure: the error path must not claim "missing"
    // either, because the customer would publish a duplicate.
    expect(report.dmarc.state).toBe("broken");
    expect(report.dmarc.detail).toContain("could not be read");
  });
});
