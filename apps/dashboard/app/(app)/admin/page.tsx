import { redirect } from "next/navigation";

/**
 * The founder admin surface graduated into the Control Plane
 * (/control) — a separate operational layer with its own shell, role
 * model, and 11 sections. This path redirects for old links.
 */
export default function AdminRedirect() {
  redirect("/control");
}
