import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
  await requireSection("infrastructure");
  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Storage"
        subtitle="Attachments, exported data, and any future object storage — sized and observed."
      />
      <Panel title="Status" caption="scaffolded with its planned instruments">
        <Planned
          title="Storage monitoring"
          bullets={[
            "Attachment volume per project (25 MB base64 cap already enforced)",
            "Object storage utilization once exports land",
            "Growth trend + quota alerts",
          ]}
        >
          Email attachments currently ride the message payload with a hard cap; dedicated object
          storage arrives with bulk export and archive features, and this page activates with it.
        </Planned>
      </Panel>
    </>
  );
}
