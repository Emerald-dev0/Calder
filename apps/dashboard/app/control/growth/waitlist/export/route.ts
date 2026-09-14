import { requireControl } from "@/lib/control/guard";
import { waitlistRows } from "@/lib/control/queries";

export const dynamic = "force-dynamic";

/**
 * CSV export of the waitlist, honoring the same filters as the table.
 * Streams as an attachment; operator session required.
 */
export async function GET(req: Request) {
  await requireControl();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const source = url.searchParams.get("source") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const referred = url.searchParams.get("referred") ?? undefined;
  const sort = url.searchParams.get("sort") === "oldest" ? "oldest" : "newest";

  // Export everything matching the filter, paginated.
  const rows: Array<Awaited<ReturnType<typeof waitlistRows>>["rows"][number]> = [];
  let page = 1;
  for (;;) {
    const chunk = await waitlistRows({ q, source, status, referred, sort, page, perPage: 500 });
    rows.push(...chunk.rows);
    if (rows.length >= chunk.total || chunk.page >= chunk.pages) break;
    page += 1;
  }

  const esc = (v: string | null | undefined) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    "email,name,joined,source,country,status,referral_code,referred_by,tags,note",
    ...rows.map((r) =>
      [
        esc(r.email),
        esc(r.name),
        new Date(r.createdAt).toISOString(),
        esc(r.source ?? "direct"),
        esc(r.country),
        esc(r.status),
        esc(r.referralCode),
        esc(r.referredBy),
        esc((r.tags ?? []).join("|")),
        esc(r.note),
      ].join(",")
    ),
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="calder-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST() {
  await requireControl();
  return new Response("Use GET to export.", { status: 405 });
}
