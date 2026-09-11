import { eq } from "drizzle-orm";
import { getDb, senderIdentities } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { Composer } from "./composer";

export const metadata = { title: "Calder — New email" };

export default async function NewEmailPage({
  searchParams,
}: {
  searchParams: { project?: string };
}) {
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>New email</h1>
        <p style={{ color: "#737373" }}>No project found. Create one to start sending.</p>
      </div>
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: senderIdentities.id,
      displayName: senderIdentities.displayName,
      email: senderIdentities.email,
      status: senderIdentities.status,
      isDefault: senderIdentities.isDefault,
    })
    .from(senderIdentities)
    .where(eq(senderIdentities.projectId, scope.project.id));
  const def = rows.find((r) => r.isDefault) ?? rows.find((r) => r.status === "verified" || r.status === "connected") ?? null;

  return (
    <div>
      <p style={{ fontSize: 13, margin: "0 0 8px" }}>
        <a href={`/emails?project=${scope.project.id}`} style={{ color: "#737373" }}>
          ← Emails
        </a>
      </p>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>New email</h1>
      <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
        {scope.organization.name} → {scope.project.name}
      </p>
      <Composer
        projectId={scope.project.id}
        senders={rows.map((r) => ({
          id: r.id,
          displayName: r.displayName,
          email: r.email,
          status: r.status,
          isDefault: r.isDefault,
        }))}
        defaultSenderId={def?.id ?? null}
      />
    </div>
  );
}
