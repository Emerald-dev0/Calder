import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Where Paystack sends the customer back. It carries no trusted state: the
 * reference is forwarded to /billing, which asks the API to verify it against
 * Paystack before anything is shown as paid.
 *
 * Point PAYSTACK_CALLBACK_URL at this route.
 */
export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string; project?: string }>;
}) {
  const query = await searchParams;
  const reference = query.reference ?? query.trxref;
  const project = query.project ? `project=${encodeURIComponent(query.project)}&` : "";
  redirect(reference ? `/billing?${project}ref=${encodeURIComponent(reference)}` : "/billing");
}
