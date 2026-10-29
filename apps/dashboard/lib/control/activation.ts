import "../server-only";
import { getDb } from "@calder/db";
import { sql } from "drizzle-orm";
import type { DateWindow } from "./range";

/** Organization-created cohort, current milestones, NOT an ordered event funnel. */
export async function organizationActivation(window: DateWindow) {
  const rows = await getDb().execute(sql`
    with cohort as (
      select o.id,
        exists(select 1 from organization_members m join users u on u.id=m.user_id
          where m.organization_id=o.id and m.role='owner' and u.email_verified_at is not null) as verified_owner,
        exists(select 1 from projects p where p.organization_id=o.id) as has_project,
        exists(select 1 from projects p join sender_identities s on s.project_id=p.id
          where p.organization_id=o.id and s.status in ('verified', 'connected') and s.archived_at is null) as has_sender,
        exists(select 1 from projects p join emails e on e.project_id=p.id
          where p.organization_id=o.id and e.env='live' and e.provider_message_id is not null
          and e.provider in ('ses', 'gmail')) as accepted_live
      from organizations o
      where (${window.start?.toISOString() ?? null}::timestamptz is null or o.created_at >= ${window.start?.toISOString() ?? null}::timestamptz)
        and (${window.end?.toISOString() ?? null}::timestamptz is null or o.created_at < ${window.end?.toISOString() ?? null}::timestamptz)
    )
    select count(*) as organizations,
      count(*) filter(where verified_owner) as verified,
      count(*) filter(where verified_owner and has_project) as projects,
      count(*) filter(where verified_owner and has_project and has_sender) as senders,
      count(*) filter(where verified_owner and has_project and has_sender and accepted_live) as activated
    from cohort
  `);
  const row = rows[0];
  return {
    organizations: Number(row?.organizations ?? 0),
    verified: Number(row?.verified ?? 0),
    projects: Number(row?.projects ?? 0),
    senders: Number(row?.senders ?? 0),
    activated: Number(row?.activated ?? 0),
  };
}
