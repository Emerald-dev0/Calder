import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  STREAM_LABELS,
  filtersToQuery,
  hasActiveFilters,
  looksLikeMessageId,
  normalizeDomain,
  parseFilters,
  rangeStart,
  describeFilters,
} from "./filters";

describe("parseFilters", () => {
  it("defaults to an unfiltered view for an empty query", () => {
    expect(parseFilters({})).toEqual(EMPTY_FILTERS);
  });

  it("keeps the database value for the marketing stream", () => {
    const f = parseFilters({ stream: "marketing" });
    expect(f.stream).toBe("marketing");
    // The label is the only thing that changes; the value in the URL and the
    // column stays `marketing`.
    expect(STREAM_LABELS[f.stream]).toBe("Broadcast");
  });

  it("accepts every known status and rejects an unknown one", () => {
    expect(parseFilters({ status: "delivered" }).status).toBe("delivered");
    expect(parseFilters({ status: "exploded" }).status).toBe("all");
  });

  it("drops an unknown range instead of throwing", () => {
    expect(parseFilters({ range: "3y" }).range).toBe("all");
  });

  it("defaults to newest-first and accepts oldest-first", () => {
    expect(parseFilters({}).sort).toBe("newest");
    expect(parseFilters({ sort: "oldest" }).sort).toBe("oldest");
    expect(parseFilters({ sort: "sideways" }).sort).toBe("newest");
  });

  it("only keeps sender ids that look like ids", () => {
    expect(parseFilters({ sender: "sender_abc123" }).sender).toBe("sender_abc123");
    expect(parseFilters({ sender: "'; drop table emails; --" }).sender).toBe("");
  });

  it("normalises the domain filter and rejects wildcards and URLs", () => {
    expect(normalizeDomain("Example.COM")).toBe("example.com");
    expect(normalizeDomain("*.example.com")).toBe("");
    expect(normalizeDomain("https://example.com")).toBe("");
    expect(normalizeDomain("not a domain")).toBe("");
    expect(parseFilters({ domain: "mail.example.com" }).domain).toBe("mail.example.com");
  });

  it("trims and caps the search term", () => {
    expect(parseFilters({ q: "  hello  " }).q).toBe("hello");
    expect(parseFilters({ q: "x".repeat(500) }).q).toHaveLength(200);
  });

  it("takes the first value when a parameter repeats", () => {
    expect(parseFilters({ stream: ["marketing", "transactional"] }).stream).toBe("marketing");
  });
});

describe("filtersToQuery", () => {
  it("omits defaults so the URL stays short", () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toBe("");
  });

  it("carries a non-default sort but not the default one", () => {
    expect(filtersToQuery({ ...EMPTY_FILTERS, sort: "oldest" })).toBe("sort=oldest");
    expect(filtersToQuery({ ...EMPTY_FILTERS, sort: "newest" })).toBe("");
  });

  it("round-trips every filter through parse + serialise", () => {
    const filters = {
      stream: "marketing" as const,
      sort: "oldest" as const,
      status: "bounced" as const,
      range: "7d" as const,
      sender: "sender_abc",
      domain: "example.com",
      q: "invoice 42",
    };
    const qs = filtersToQuery(filters);
    const back = parseFilters(Object.fromEntries(new URLSearchParams(qs)));
    expect(back).toEqual(filters);
  });

  it("appends extras such as project, cursor and the open message", () => {
    const qs = filtersToQuery(EMPTY_FILTERS, {
      project: "proj_1",
      cursor: "abc",
      message: "em_123456",
    });
    const p = new URLSearchParams(qs);
    expect(p.get("project")).toBe("proj_1");
    expect(p.get("cursor")).toBe("abc");
    expect(p.get("message")).toBe("em_123456");
  });
});

describe("hasActiveFilters", () => {
  it("is false only for the empty filter set", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("is false for a sort change alone: sorting is not a filter", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: "oldest" })).toBe(false);
  });

  it("is true when any single filter narrows the view", () => {
    for (const patch of [
      { stream: "marketing" as const },
      { status: "failed" as const },
      { range: "24h" as const },
      { sender: "sender_x" },
      { domain: "example.com" },
      { q: "abc" },
    ]) {
      expect(hasActiveFilters({ ...EMPTY_FILTERS, ...patch })).toBe(true);
    }
  });
});

describe("rangeStart", () => {
  const now = new Date("2026-10-22T12:00:00.000Z");

  it("returns null for all time", () => {
    expect(rangeStart("all", now)).toBeNull();
  });

  it("subtracts the bucket length", () => {
    expect(rangeStart("24h", now)!.toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(rangeStart("7d", now)!.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(rangeStart("30d", now)!.toISOString()).toBe("2026-09-22T12:00:00.000Z");
    expect(rangeStart("90d", now)!.toISOString()).toBe("2026-07-24T12:00:00.000Z");
  });
});

describe("looksLikeMessageId", () => {
  it("accepts our prefixed ids", () => {
    expect(looksLikeMessageId("em_abc123def456")).toBe(true);
  });

  it("rejects anything else before it reaches a query", () => {
    expect(looksLikeMessageId("")).toBe(false);
    expect(looksLikeMessageId("abc123")).toBe(false);
    expect(looksLikeMessageId("em_")).toBe(false);
    expect(looksLikeMessageId("em_abc123'; drop table emails; --")).toBe(false);
  });
});

describe("describeFilters", () => {
  it("names the filter set for the export caption", () => {
    expect(describeFilters({ ...EMPTY_FILTERS, stream: "marketing", status: "bounced" })).toContain(
      "Broadcast"
    );
    expect(describeFilters({ ...EMPTY_FILTERS, domain: "example.com" })).toContain("example.com");
  });
});
