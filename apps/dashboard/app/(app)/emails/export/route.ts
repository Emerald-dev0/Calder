import { NextResponse } from "next/server";
import { getDb } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { parseFilters } from "../../../../lib/emails/filters";
import { exportFilename, toCsv } from "../../../../lib/emails/csv";
import { listEmailsForExport } from "../../../../lib/emails/queries";

/**
 * CSV export of the filtered message log.
 *
 * The filters come from the same query string the page renders from and the
 * rows come from the same predicate (`lib/emails/queries`), so the file matches
 * what the operator was looking at. Scope comes from `resolveProject` against
 * the caller's memberships: a project id the caller does not belong to resolves
 * to null and yields 404, so an export can never widen beyond a tenant.
 *
 * Rows are capped; `x-calder-truncated` says so rather than silently dropping.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, params.project);
  if (!scope) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const filters = parseFilters(params);
  const { rows, truncated, cap } = await listEmailsForExport(getDb(), {
    projectId: scope.project.id,
    filters,
  });

  const csv = toCsv(
    rows.map((r) => ({
      id: r.id,
      to: r.to,
      from: r.from,
      subject: r.subject,
      stream: r.stream,
      status: r.status,
      provider: r.provider,
      providerMessageId: r.providerMessageId,
      createdAt: r.createdAt.toISOString(),
    }))
  );

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(scope.project.slug)}"`,
      "cache-control": "no-store",
      "x-calder-rows": String(rows.length),
      "x-calder-truncated": truncated ? "1" : "0",
      "x-calder-row-cap": String(cap),
    },
  });
}
