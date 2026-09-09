import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Quickstart — Calder",
  description: "Pick a language and send your first Calder email in minutes.",
  alternates: { canonical: "https://calder.click/docs/quickstart/nodejs" },
};

export default function QuickstartIndex() {
  redirect("/docs/quickstart/nodejs");
}
