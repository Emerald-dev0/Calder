import { describe, it, expect } from "vitest";
import {
  ReactTreeError,
  parseReactTree,
  renderReactTree,
  type ReactElementNode,
} from "./react-tree.js";

/**
 * Rendering a React Email element tree to email-safe HTML + text.
 *
 * The security surface is the interesting part: a template tree arrives from a
 * customer, so every value in it is untrusted. What must hold is that markup is
 * escaped, URLs are restricted to schemes a mail client should follow, props are
 * filtered, and nothing is silently dropped — a receipt that loses its total is
 * worse than one that fails to render.
 */

const tree = (node: unknown) => node as ReactElementNode;

const simple: ReactElementNode = {
  component: "Html",
  children: [
    { component: "Head" },
    { component: "Preview", children: ["Your receipt is inside"] },
    {
      component: "Body",
      children: [
        {
          component: "Container",
          children: [
            { component: "Heading", children: ["Receipt"] },
            {
              component: "Text",
              children: [
                "Thanks for your order, ",
                {
                  component: "Link",
                  props: { href: "https://example.test/o/1" },
                  children: ["view it"],
                },
                ".",
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("renderReactTree", () => {
  it("renders a document with inline styles and a text alternative", () => {
    const out = renderReactTree(simple);
    expect(out.html).toContain("<!DOCTYPE html");
    expect(out.html).toContain("<h1");
    expect(out.html).toContain('href="https://example.test/o/1"');
    // Tables, because Outlook ignores div-based layout.
    expect(out.html).toContain('<table role="presentation"');
    expect(out.text).toContain("Receipt");
    expect(out.text).toContain("Thanks for your order");
    expect(out.text).toContain("view it");
  });

  it("keeps preview text out of the visible body but in the document", () => {
    const out = renderReactTree(simple);
    expect(out.html).toContain("Your receipt is inside");
    expect(out.html).toContain("display:none");
    // Preview text is a header hint, not body copy.
    expect(out.text).not.toContain("Your receipt is inside");
  });

  it("escapes markup in text, so a template cannot inject HTML", () => {
    const out = renderReactTree(
      tree({ component: "Text", children: ['<script>alert(1)</script> & "quoted"'] })
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("&amp;");
  });

  it("refuses javascript: and data: links but keeps their text", () => {
    const out = renderReactTree(
      tree({
        component: "Text",
        children: [
          { component: "Link", props: { href: "javascript:alert(1)" }, children: ["click me"] },
        ],
      })
    );
    expect(out.html).not.toContain("javascript:");
    expect(out.html).toContain("click me");
  });

  it("allows a placeholder href, because links are filled at send time", () => {
    const out = renderReactTree(
      tree({ component: "Button", props: { href: "{{reset_url}}" }, children: ["Reset"] })
    );
    expect(out.html).toContain('href="{{reset_url}}"');
    expect(out.html).toContain('role="button"');
  });

  it("never emits event handlers, style strings or arbitrary attributes", () => {
    const out = renderReactTree(
      tree({
        component: "Button",
        props: { href: "https://example.test", onClick: "alert(1)", style: "color:red", id: "x" },
        children: ["Go"],
      })
    );
    expect(out.html).not.toContain("onClick");
    expect(out.html).not.toContain("onclick");
    expect(out.html).not.toContain("color:red");
    expect(out.html).not.toContain('id="x"');
  });

  it("turns an image without a usable source into its alt text", () => {
    const broken = renderReactTree(
      tree({ component: "Img", props: { src: "javascript:alert(1)", alt: "Company logo" } })
    );
    expect(broken.html).not.toContain("<img");
    expect(broken.html).toContain("Company logo");

    const ok = renderReactTree(
      tree({
        component: "Img",
        props: { src: "https://example.test/logo.png", alt: "Logo", width: 120 },
      })
    );
    expect(ok.html).toContain('src="https://example.test/logo.png"');
    expect(ok.html).toContain('width="120"');
  });

  it("wraps a bare fragment in a document rather than emitting invalid HTML", () => {
    const out = renderReactTree(tree({ component: "Text", children: ["Just text"] }));
    expect(out.html).toContain("<!DOCTYPE html>");
    expect(out.html).toContain("<body");
    expect(out.html).toContain("Just text");
  });

  it("refuses an unknown component instead of dropping it", () => {
    // Silently skipping is how a message arrives missing its total.
    expect(() => renderReactTree(tree({ component: "Tabs", children: ["x"] }))).toThrow(
      ReactTreeError
    );
    expect(() => renderReactTree(tree({ component: "Tabs" }))).toThrow(/Unsupported component/);
  });

  it("bounds depth and element count", () => {
    let deep: ReactElementNode = { component: "Text", children: ["x"] };
    for (let i = 0; i < 60; i += 1) deep = { component: "Section", children: [deep] };
    expect(() => renderReactTree(deep)).toThrow(/nests too deeply/);

    const wide: ReactElementNode = {
      component: "Section",
      children: Array.from({ length: 2100 }, () => ({ component: "Text", children: ["x"] })),
    };
    expect(() => renderReactTree(wide)).toThrow(/too many elements/);
  });

  it("is deterministic: the same tree renders byte-identically", () => {
    expect(renderReactTree(simple).html).toBe(renderReactTree(simple).html);
  });
});

describe("parseReactTree", () => {
  it("accepts a well-formed tree", () => {
    expect(parseReactTree({ component: "Text", children: ["ok"] })).toMatchObject({
      component: "Text",
    });
  });

  it("refuses a tree without a component name, and non-array children", () => {
    expect(() => parseReactTree(null)).toThrow(ReactTreeError);
    expect(() => parseReactTree({ children: [] })).toThrow(/component/);
    expect(() => parseReactTree({ component: "Text", children: "nope" })).toThrow(/children/);
    expect(() => parseReactTree({ component: "Text", children: [{ children: [] }] })).toThrow(
      /Every element/
    );
  });
});
