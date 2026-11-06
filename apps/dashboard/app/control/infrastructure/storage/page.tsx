import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
  await requireSection("infrastructure");
  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Storage"
        subtitle="No storage/object-storage telemetry is currently queryable. Database size is available from the database health view."
      />
      <Panel title="Current signal" caption="Use durable infrastructure data">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          Check <Link href="/control/infrastructure/database">Database</Link> for live Postgres size
          and table stats. Attachment/object storage metrics are not exposed until backed by real
          usage data.
        </p>
      </Panel>
    </>
  );
}
