import { describe, expect, it } from "vitest";
import {
  contactsFromCsv,
  isMailableEmail,
  isRoleAddress,
  normalizeEmail,
  parseCsv,
} from "./audience-service.js";
import { personalize } from "./broadcast-service.js";

describe("parseCsv", () => {
  it("reads a plain table and drops the trailing blank line", () => {
    expect(parseCsv("email,name\nada@example.com,Ada\n")).toEqual([
      ["email", "name"],
      ["ada@example.com", "Ada"],
    ]);
  });

  it("honours quotes, escaped quotes and CRLF", () => {
    const rows = parseCsv('email,note\r\n"a@b.co","He said ""hi"", loudly"\r\n');
    expect(rows[1]).toEqual(["a@b.co", 'He said "hi", loudly']);
  });

  it("keeps an empty line inside a quoted field", () => {
    const rows = parseCsv('email,note\na@b.co,"line one\nline two"');
    expect(rows[1]![1]).toBe("line one\nline two");
  });
});

describe("contactsFromCsv", () => {
  it("maps header aliases and keeps unknown columns as properties", () => {
    const { rows, invalid } = contactsFromCsv(
      "E-mail,First Name,Surname,Company\nAda@Example.com,Ada,Lovelace,Engines\n"
    );
    expect(invalid).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      properties: { company: "Engines" },
    });
  });

  it("treats a headerless file as email, first, last", () => {
    const { rows } = contactsFromCsv("grace@example.com,Grace,Hopper\n");
    expect(rows[0]).toMatchObject({
      email: "grace@example.com",
      firstName: "Grace",
      lastName: "Hopper",
    });
  });

  it("counts bad addresses instead of failing the whole file", () => {
    const { rows, invalid } = contactsFromCsv(
      "email\nada@example.com\nnot-an-email\n\nbob@example.com\n"
    );
    expect(rows).toHaveLength(2);
    expect(invalid).toBe(1);
  });
});

describe("address rules", () => {
  it("normalises case and whitespace", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("rejects addresses that cannot receive mail", () => {
    expect(isMailableEmail("ada@example.com")).toBe(true);
    expect(isMailableEmail("ada@example")).toBe(false);
    expect(isMailableEmail("ada@@example.com")).toBe(false);
    expect(isMailableEmail("ada..lovelace@example.com")).toBe(false);
    expect(isMailableEmail("")).toBe(false);
  });

  it("flags role addresses, including plus-addressed ones", () => {
    expect(isRoleAddress("support@example.com")).toBe(true);
    expect(isRoleAddress("no-reply@example.com")).toBe(true);
    expect(isRoleAddress("sales+eu@example.com")).toBe(true);
    expect(isRoleAddress("ada@example.com")).toBe(false);
  });
});

describe("personalize", () => {
  const contact = { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace" };

  it("substitutes the three supported tokens", () => {
    expect(personalize("Hi {{first_name}} {{last_name}} <{{email}}>", contact)).toBe(
      "Hi Ada Lovelace <ada@example.com>"
    );
  });

  it("falls back to a neutral greeting when the first name is missing", () => {
    expect(personalize("Hi {{first_name}}", { ...contact, firstName: null })).toBe("Hi there");
  });

  it("leaves unsupported tokens alone rather than blanking them", () => {
    expect(personalize("{{first_name}}, {{plan}}", contact)).toBe("Ada, {{plan}}");
  });
});
