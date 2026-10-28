import { describe, expect, it } from "vitest";
import { footerLine, type TrendFooterSpec } from "./footer";

const conversion: TrendFooterSpec = {
  label: "Conversion that day",
  numerator: "confirmed",
  denominator: "visitors",
};

describe("trend chart footer", () => {
  it("reports a conversion rate the way the Control pages did before the fix", () => {
    expect(footerLine(conversion, { visitors: 200, confirmed: 25 })).toBe(
      "Conversion that day: 12.5%"
    );
  });

  it("renders nothing when nobody visited, instead of dividing by zero", () => {
    expect(footerLine(conversion, { visitors: 0, confirmed: 0 })).toBeNull();
    expect(footerLine(conversion, { confirmed: 3 })).toBeNull();
  });

  it("renders nothing when the denominator is not a number", () => {
    expect(footerLine(conversion, { visitors: Number.NaN, confirmed: 3 })).toBeNull();
  });

  it("honours an explicit threshold", () => {
    const spec: TrendFooterSpec = { ...conversion, whenDenominatorAbove: 100 };
    expect(footerLine(spec, { visitors: 100, confirmed: 10 })).toBeNull();
    expect(footerLine(spec, { visitors: 101, confirmed: 10 })).toBe("Conversion that day: 9.9%");
  });

  it("can show a raw ratio and a chosen precision", () => {
    expect(
      footerLine({ ...conversion, format: "ratio", digits: 2 }, { visitors: 8, confirmed: 2 })
    ).toBe("Conversion that day: 0.25");
    expect(footerLine({ ...conversion, digits: 0 }, { visitors: 3, confirmed: 1 })).toBe(
      "Conversion that day: 33%"
    );
  });

  it("treats a missing numerator as zero rather than NaN", () => {
    expect(footerLine(conversion, { visitors: 40 })).toBe("Conversion that day: 0.0%");
  });

  it("is plain data, so it survives the server/client boundary", () => {
    // JSON round-trip stands in for React's serialiser: anything that is not
    // plain data (a function, a Map, a class instance) would not survive, and
    // this spec's whole point is that it does.
    const wire = JSON.parse(JSON.stringify(conversion)) as TrendFooterSpec;
    expect(wire).toEqual(conversion);
    expect(footerLine(wire, { visitors: 200, confirmed: 25 })).toBe("Conversion that day: 12.5%");
  });
});
