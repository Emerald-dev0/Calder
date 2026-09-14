import Link from "next/link";
import { CONTROL_ROLE_LABEL } from "@/lib/control/roles";
import { requireControl } from "@/lib/control/guard";
import { PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const ctx = await requireControl();
  return (
    <>
      <PageHeader
        eyebrow="Control Plane"
        title="No access to this section"
        subtitle="Your platform role does not include the surface you tried to reach. The sidebar only shows what you may use — this page is what a stale or shared link reaches."
      />
      <Panel title="Your role" caption="platform permissions are section-scoped">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: "0 0 12px" }}>
          You are signed in as <b style={{ color: "var(--cp-text)" }}>{CONTROL_ROLE_LABEL[ctx.role]}</b>. If you
          believe you need this section, ask the founder — grants happen in Administration → Administrators and are
          audit-logged.
        </p>
        <Link className="cp-btn primary" href="/control">
          Back to Command Center
        </Link>
      </Panel>
    </>
  );
}
