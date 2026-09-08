import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Templates — Calder Docs",
  description: "Versioned email templates (in development). Send any HTML today.",
};

export default function TemplatesDoc() {
  return (
    <>
      <h1>Templates</h1>
      <div className="docs-note">
        <strong>Coming soon.</strong> Templates are in active development, after the delivery core.
        Nothing below is shippable yet — send fully-rendered HTML today and it keeps working when
        templates land.
      </div>
      <p className="docs-lede">
        The plan, briefly: versioned templates with variables and previews.
      </p>
      <h2>Intended shape</h2>
      <p>
        Named variables with safe defaults, preview with sample data, publish versions, and send by
        template + version with one-click rollback. Test sends before anything goes live.
      </p>
    </>
  );
}
