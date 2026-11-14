import "../server-only"; // M6: build-time guard — control queries may never enter a client bundle
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { apiKeys, emails, getDb, organizations, projects } from "@calder/db";
import { ACCEPTED_EMAIL_STATUSES } from "./email-volume";

/**
 * Activation: what happens between "signed up" and "sending".
 *
 * The unit is the **organization**, because that is the account: one signup
 * creates one, and everything a customer does — projects, keys, mail — hangs
 * off it. Every stage is a plain existence question ("does this org have a
 * project / a live key / an accepted email?"), not a state machine, so the
 * numbers cannot drift from the tables they describe.
 *
 * Three honesty rules this file follows, because a growth chart that flatters
 * is worse than none:
 *
 *  1. The cohort is fixed at creation time. Six of this week's signups are
 *     counted in this week's denominator forever, even if they churn; a stage
 *     is "as of now", so it can only ever shrink relative to the cohort.
 *  2. Test mail counts as activation. The question is "did they get an email
 *     out of the product", not "did they pay" — a first send in the sandbox is
 *     the moment the product becomes real, and `env` is reported beside it
 *     rather than used to filter it away.
 *
 *     "Sent" means the platform accepted the message and a provider took it:
 *     the accepted-status set (sent, delivered, bounced, complained). A bounce
 *     is a real attempt by a real integration, so it counts. `created`,
 *     `queued` and `sending` do not — those are a row, not a send.
 *  3. Every count comes from one snapshot. Read as separate statements, a
 *     signup arriving between two of them would make a later stage larger than
 *     the stage before it, and the page would show an impossible funnel.
 */

export type FunnelStageKey = "signup" | "project" | "key" | "first_send" | "active_7d";

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  /** What has to be true for an organization to be counted here. */
  requires: string;
  orgs: number;
}

export interface RecentSignup {
  organizationId: string;
  name: string;
  slug: string;
  createdAt: Date;
  projects: number;
  activeKeys: number;
  firstSendAt: Date | null;
  lastSendAt: Date | null;
  /** True when at least one accepted email was sent through a live key. */
  sentLive: boolean;
}

export interface ActivationFunnel {
  windowDays: number;
  since: Date;
  cohort: number;
  stages: FunnelStage[];
  /** Hours from signup to first accepted email, median across activated orgs. */
  medianHoursToFirstSend: number | null;
  recent: RecentSignup[];
}

const DEFAULT_WINDOW_DAYS = 30;

export async function activationFunnel(
  options: {
    windowDays?: number;
    /** Overrides `windowDays`; the integration test needs a narrow cohort. */
    since?: Date;
    now?: Date;
    recentLimit?: number;
  } = {}
): Promise<ActivationFunnel> {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = options.since ?? new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentLimit = options.recentLimit ?? 20;

  const db = getDb();

  return db.transaction(
    async (tx) => {
      const cohort = tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(gte(organizations.createdAt, since));

      const scalar = async (rows: PromiseLike<Array<{ value: number }>>): Promise<number> => {
        const [row] = await rows;
        return Number(row?.value ?? 0);
      };

      const [cohortCount, withProject, withKey, withSend, activeLast7d] = await Promise.all([
        scalar(
          tx
            .select({ value: count() })
            .from(organizations)
            .where(gte(organizations.createdAt, since))
        ),
        scalar(
          tx
            .select({ value: sql<number>`count(distinct ${projects.organizationId})` })
            .from(projects)
            .where(inArray(projects.organizationId, cohort))
        ),
        scalar(
          tx
            .select({ value: sql<number>`count(distinct ${projects.organizationId})` })
            .from(apiKeys)
            .innerJoin(projects, eq(apiKeys.projectId, projects.id))
            .where(and(inArray(projects.organizationId, cohort), isNull(apiKeys.revokedAt)))
        ),
        scalar(
          tx
            .select({ value: sql<number>`count(distinct ${projects.organizationId})` })
            .from(emails)
            .innerJoin(projects, eq(emails.projectId, projects.id))
            .where(
              and(
                inArray(projects.organizationId, cohort),
                inArray(emails.status, [...ACCEPTED_EMAIL_STATUSES])
              )
            )
        ),
        scalar(
          tx
            .select({ value: sql<number>`count(distinct ${projects.organizationId})` })
            .from(emails)
            .innerJoin(projects, eq(emails.projectId, projects.id))
            .where(
              and(
                inArray(projects.organizationId, cohort),
                inArray(emails.status, [...ACCEPTED_EMAIL_STATUSES]),
                gte(emails.createdAt, sevenDaysAgo)
              )
            )
        ),
      ]);

      // Median hours from signup to first accepted send. Median, not mean: one
      // customer who came back a month later must not move a number the page
      // presents as "how long it takes".
      const firstSends = await tx
        .select({
          createdAt: organizations.createdAt,
          firstSendAt: sql<Date>`min(${emails.createdAt})`,
        })
        .from(organizations)
        .innerJoin(projects, eq(projects.organizationId, organizations.id))
        .innerJoin(
          emails,
          and(
            eq(emails.projectId, projects.id),
            inArray(emails.status, [...ACCEPTED_EMAIL_STATUSES])
          )
        )
        .where(gte(organizations.createdAt, since))
        .groupBy(organizations.id, organizations.createdAt);

      const gaps = firstSends
        .map(
          (row) =>
            (new Date(row.firstSendAt).getTime() - new Date(row.createdAt).getTime()) / 3_600_000
        )
        .filter((hours) => Number.isFinite(hours) && hours >= 0)
        .sort((a, b) => a - b);
      const medianHoursToFirstSend =
        gaps.length === 0
          ? null
          : gaps.length % 2 === 1
            ? gaps[(gaps.length - 1) / 2]!
            : (gaps[gaps.length / 2 - 1]! + gaps[gaps.length / 2]!) / 2;

      const recent = await tx
        .select({
          organizationId: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          createdAt: organizations.createdAt,
          projects: sql<number>`count(distinct ${projects.id})`,
          activeKeys: sql<number>`count(distinct ${apiKeys.id}) filter (where ${apiKeys.revokedAt} is null)`,
          firstSendAt: sql<Date | null>`min(${emails.createdAt})`,
          lastSendAt: sql<Date | null>`max(${emails.createdAt})`,
          sentLive: sql<boolean>`bool_or(${emails.env} = 'live')`,
        })
        .from(organizations)
        .leftJoin(projects, eq(projects.organizationId, organizations.id))
        .leftJoin(apiKeys, eq(apiKeys.projectId, projects.id))
        .leftJoin(
          emails,
          and(
            eq(emails.projectId, projects.id),
            inArray(emails.status, [...ACCEPTED_EMAIL_STATUSES])
          )
        )
        .where(gte(organizations.createdAt, since))
        .groupBy(organizations.id, organizations.name, organizations.slug, organizations.createdAt)
        .orderBy(desc(organizations.createdAt))
        .limit(recentLimit);

      const stages: FunnelStage[] = [
        {
          key: "signup",
          label: "Signed up",
          requires: "an organization exists",
          orgs: cohortCount,
        },
        {
          key: "project",
          label: "Created a project",
          requires: "at least one project",
          orgs: withProject,
        },
        {
          key: "key",
          label: "Held a live API key",
          requires: "at least one unrevoked key",
          orgs: withKey,
        },
        {
          key: "first_send",
          label: "Sent an email",
          requires: "one send the provider took (sent, delivered, bounced, complained)",
          orgs: withSend,
        },
        {
          key: "active_7d",
          label: "Still sending",
          requires: "such a send in the last 7 days",
          orgs: activeLast7d,
        },
      ];

      return {
        windowDays,
        since,
        cohort: cohortCount,
        stages,
        medianHoursToFirstSend,
        recent: recent.map((row) => ({
          ...row,
          projects: Number(row.projects),
          activeKeys: Number(row.activeKeys),
          firstSendAt: row.firstSendAt ? new Date(row.firstSendAt) : null,
          lastSendAt: row.lastSendAt ? new Date(row.lastSendAt) : null,
          sentLive: Boolean(row.sentLive),
        })),
      };
    },
    { isolationLevel: "repeatable read" }
  );
}
