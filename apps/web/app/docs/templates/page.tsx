import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Templates, Calder Docs",
  description: "Versioned email templates (in development). Send any HTML today.",
};

export default function TemplatesDoc() {
  return (
    <>
      <h1>Templates</h1>
      <div className="docs-note">
        <strong>In development.</strong> Templates come after the delivery core. Nothing below is
        available today, and sending rendered HTML now keeps working after they ship.
      </div>
      <p className="docs-lede">
        The planned shape: versioned templates with variables and previews.
      </p>
      <h2>Planned behaviour</h2>
      <p>
        Named variables with defaults, previews against sample data, published versions, and sends
        that reference the template and version they used, so a rollback is a click. Test sends go
        to yourself before anything reaches a customer.
      </p>
    </>
  );
}
