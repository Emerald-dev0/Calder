import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Templates, Calder Docs",
  description: "Implemented template endpoints, versioned content and sending options.",
};
export default function TemplatesDoc() {
  return (
    <>
      <h1>Templates</h1>
      <p className="docs-lede">
        Template management and versioned content are implemented in the API and dashboard.
      </p>
      <p>
        The API includes project-scoped template creation, reads, deletion and version listing under{" "}
        <code>/v1/templates</code>. The send service can resolve a template alias and render
        variables; read the <Link href="/docs/api-reference">API reference</Link> for the exact
        request schema rather than relying on planned examples.
      </p>
      <p>
        You can also send raw HTML or text. A template does not bypass sender eligibility,
        suppression, usage limits or the queue. Test keys simulate sends rather than delivering a
        template preview to a real inbox. Production template journeys still need validation in your
        account before relying on them.
      </p>
    </>
  );
}
