import { NextResponse } from "next/server";
import { and, desc, eq, ilike } from "drizzle-orm";
import { getDb, suppressions } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { stringParam } from "../../../../lib/pagination";

/**
 * CSV export of the *filtered* view.
 *
 * Deliberately a route handler rather than a server action: the browser needs a
 * real file download, and the filters are carried in the query string so the
 * exported file matches exactly what the operator was looking at.
 *
 * Tenant scope comes from resolveProject against the caller's memberships, not
 * from the query string — a project id the caller does not belong to resolves
 * to null and yields 404.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, stringParam(url.searchParams.get("project") ?? undefined));
  if (!scope) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const projectId = scope.project.id;
  const q = stringParam(url.searchParams.get("q") ?? undefined);
  const reason = stringParam(url.searchParams.get("reason") ?? undefined);

  const db = getDb();
  const rows = await db
    .select({
      email: suppressions.email,
      reason: suppressions.reason,
      createdAt: suppressions.createdAt,
      organizationId: suppressions.organizationId,
    })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.projectId, projectId),
        reason && reason !== "all" ? eq(suppressions.reason, reason) : undefined,
        q ? ilike(suppressions.email, `%${q}%`) : undefined
      )
    )
    .orderBy(desc(suppressions.createdAt))
    .limit(50_000);

  const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [
    "email,reason,created_at,scope",
    ...rows.map((r) =>
      [
        escape(r.email),
        escape(r.reason),
        r.createdAt.toISOString(),
        r.reason === "bounce" || r.reason === "complaint" ? "organization" : "project",
      ].join(",")
    ),
  ].join("\n");

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="suppressions-${scope.project.slug}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
