import { describe, expect, it } from "vitest";
import { parseSuppressionCsv } from "./csv";

/**
 * CSV import is a bulk write into a deliverability list, so the parser is
 * tested against the shapes an operator will actually paste in — including the
 * ones that used to silently drop rows.
 */
describe("parseSuppressionCsv", () => {
  it("parses a bare list of addresses", () => {
    const out = parseSuppressionCsv("a@x.test\nb@x.test\nc@x.test\n");
    expect(out.valid).toBe(3);
    expect(out.rows.map((r) => r.email)).toEqual(["a@x.test", "b@x.test", "c@x.test"]);
    expect(out.rows.every((r) => r.reason === "import")).toBe(true);
  });

  it("does not treat the first address as a header", () => {
    const out = parseSuppressionCsv("first@x.test\nsecond@x.test\n");
    expect(out.valid).toBe(2);
    expect(out.rows[0]!.email).toBe("first@x.test");
  });

  it("honours a header row and maps named columns", () => {
    const out = parseSuppressionCsv(
      "email,reason\nbounce@x.test,bounce\nunsub@x.test,unsubscribe\n"
    );
    expect(out.valid).toBe(2);
    expect(out.rows[0]!.reason).toBe("bounce");
    expect(out.rows[1]!.reason).toBe("unsubscribe");
  });

  it("finds columns in any order and ignores extra ones", () => {
    const out = parseSuppressionCsv("reason,notes,address\ncomplaint,why,person@x.test\n");
    expect(out.valid).toBe(1);
    expect(out.rows[0]!.email).toBe("person@x.test");
    expect(out.rows[0]!.reason).toBe("complaint");
  });

  it("accepts 'address' as the email column", () => {
    const out = parseSuppressionCsv("address\naddr@x.test\n");
    expect(out.rows[0]!.email).toBe("addr@x.test");
  });

  it("supports semicolon and tab delimiters", () => {
    expect(parseSuppressionCsv("email;reason\na@x.test;bounce\n").rows[0]!.reason).toBe("bounce");
    expect(parseSuppressionCsv("email\treason\na@x.test\tbounce\n").rows[0]!.reason).toBe("bounce");
  });

  it("normalises CRLF line endings", () => {
    const out = parseSuppressionCsv("a@x.test\r\nb@x.test\r\n");
    expect(out.valid).toBe(2);
  });

  it("lowercases addresses and trims cells", () => {
    const out = parseSuppressionCsv("  A@X.Test  \n");
    expect(out.rows[0]!.email).toBe("a@x.test");
  });

  it("counts duplicates instead of importing them twice", () => {
    const out = parseSuppressionCsv("a@x.test\nA@X.TEST\nb@x.test\n");
    expect(out.valid).toBe(2);
    expect(out.duplicate).toBe(1);
    expect(out.rows.find((r) => r.status === "duplicate")!.line).toBe(2);
  });

  it("reports invalid rows per line without discarding the rest", () => {
    const out = parseSuppressionCsv("good@x.test\nnot-an-email\nperson@\nalso-good@x.test\n");
    expect(out.valid).toBe(2);
    expect(out.invalid).toBe(2);
    expect(out.rows.filter((r) => r.status === "invalid").map((r) => r.line)).toEqual([2, 3]);
  });

  it("skips blank lines without counting them as invalid", () => {
    const out = parseSuppressionCsv("a@x.test\n\n\n   \nb@x.test\n");
    expect(out.valid).toBe(2);
    expect(out.invalid).toBe(0);
  });

  it("falls back to 'import' for an unknown reason instead of dropping the row", () => {
    const out = parseSuppressionCsv("email,reason\nx@y.test,hard_bounce\n");
    expect(out.valid).toBe(1);
    expect(out.rows[0]!.reason).toBe("import");
  });

  it("keeps a reviewed reason exactly as written", () => {
    for (const reason of ["bounce", "complaint", "unsubscribe", "manual", "import"]) {
      expect(parseSuppressionCsv(`email,reason\nx@y.test,${reason}\n`).rows[0]!.reason).toBe(
        reason
      );
    }
  });

  it("handles quoted cells containing a comma", () => {
    const out = parseSuppressionCsv('email,reason,notes\nx@y.test,bounce,"said, loudly"\n');
    expect(out.valid).toBe(1);
    expect(out.rows[0]!.email).toBe("x@y.test");
  });

  it("handles an escaped quote inside a quoted cell", () => {
    const out = parseSuppressionCsv('email,notes\nx@y.test,"a ""quoted"" note"\n');
    expect(out.valid).toBe(1);
  });

  it("caps materialised rows but reports true totals", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `user${i}@x.test`).join("\n");
    const out = parseSuppressionCsv(lines, { limit: 10 });
    expect(out.rows).toHaveLength(10);
    expect(out.valid).toBe(40);
    expect(out.truncated).toBe(true);
  });

  it("does not mark a file truncated when it is exactly at the limit", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `user${i}@x.test`).join("\n");
    const out = parseSuppressionCsv(lines, { limit: 10 });
    expect(out.rows).toHaveLength(10);
    expect(out.truncated).toBe(false);
  });

  it("returns empty counts for an empty file", () => {
    const out = parseSuppressionCsv("");
    expect(out).toEqual({ rows: [], valid: 0, invalid: 0, duplicate: 0, truncated: false });
  });

  it("returns empty counts for a header-only file", () => {
    const out = parseSuppressionCsv("email,reason\n");
    expect(out.valid).toBe(0);
    expect(out.invalid).toBe(0);
  });
});
