import { describe, expect, it } from "vitest";
import { EXPORT_ROW_CAP, csvCell, exportFilename, toCsv, type ExportRow } from "./csv";

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    id: "em_1",
    to: "a@example.com",
    from: "hello@example.com",
    subject: "Hello",
    stream: "transactional",
    status: "delivered",
    provider: "ses",
    providerMessageId: "0100-abc",
    createdAt: "2026-10-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("csvCell", () => {
  it("passes a plain value through", () => {
    expect(csvCell("hello")).toBe("hello");
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("defuses spreadsheet formula injection", () => {
    for (const evil of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const out = csvCell(evil);
      expect(out.startsWith("'") || out.startsWith("\"'")).toBe(true);
    }
  });

  it("still quotes a formula that also contains a comma", () => {
    expect(csvCell("=cmd|'/c calc',x")).toBe("\"'=cmd|'/c calc',x\"");
  });
});

describe("toCsv", () => {
  it("writes a header row and one line per message", () => {
    const csv = toCsv([row(), row({ id: "em_2" })]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "id,to,from,subject,stream,status,provider,provider_message_id,created_at"
    );
    expect(lines[1]!.startsWith("em_1,a@example.com,hello@example.com,Hello")).toBe(true);
  });

  it("keeps a null provider empty rather than printing null", () => {
    const csv = toCsv([row({ provider: null, providerMessageId: null })]);
    expect(csv).not.toContain("null");
  });

  it("caps the number of data rows", () => {
    const many = Array.from({ length: EXPORT_ROW_CAP + 5 }, (_, i) => row({ id: `em_${i}` }));
    const lines = toCsv(many).split("\n");
    expect(lines).toHaveLength(EXPORT_ROW_CAP + 1);
  });

  it("survives a subject that would otherwise break the row", () => {
    const csv = toCsv([row({ subject: 'Re: "quoted", with comma' })]);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('"Re: ""quoted"", with comma"');
  });
});

describe("exportFilename", () => {
  it("encodes the project and the date", () => {
    expect(exportFilename("acme", new Date("2026-10-22T05:00:00.000Z"))).toBe(
      "emails-acme-2026-10-22.csv"
    );
  });

  it("sanitises a slug so it cannot break the header", () => {
    const name = exportFilename('bad "slug"\n/x', new Date("2026-10-22T00:00:00.000Z"));
    expect(name).toBe("emails-bad--slug---x-2026-10-22.csv");
    expect(name).not.toContain('"');
    expect(name).not.toContain("\n");
  });

  it("falls back to a generic name for an empty slug", () => {
    expect(exportFilename("", new Date("2026-10-22T00:00:00.000Z"))).toBe(
      "emails-project-2026-10-22.csv"
    );
  });
});
