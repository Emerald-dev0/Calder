-- Plan-catalogue migration audit
--
-- READ-ONLY. Every statement is a SELECT inside `BEGIN TRANSACTION READ ONLY`,
-- so the database refuses a write even if this file is edited badly later.
-- Safe to run against a production replica; nothing here locks a table beyond
-- the usual MVCC snapshot.
--
-- ── How a tier is resolved today ─────────────────────────────────────────────
--
-- `resolveOrgTier()` in `packages/db/src/usage.ts`:
--
--   SELECT plans.tier
--     FROM subscriptions JOIN plans ON plans.id = subscriptions.plan_id
--    WHERE subscriptions.organization_id = $1
--      AND subscriptions.status = 'active'
--    LIMIT 1
--
--   … falling back to 'free' when there is no active subscription.
--
-- There is **no operator-granted entitlement layer**. The control-room
-- "Entitlements" page describes an override engine (+quota, +projects,
-- temporary plan grants) as *planned*; no table, column or code path stores an
-- override yet. So the effective tier is exactly "the active subscription's
-- plan, else free", and the only thing an operator can do today is write a
-- different `subscriptions` row.
--
-- Two caveats the query encodes:
--   * An organization with several active subscriptions is resolved by
--     `updated_at DESC` here. The application uses an unordered `LIMIT 1`; if
--     this query returns a duplicate `dup_active_subscriptions` flag, that org
--     is genuinely ambiguous and must be cleaned up before any remap.
--   * The usage window mirrors `orgUsagePeriod()`: the subscription's stamped
--     cycle when it has one, otherwise the current UTC calendar month. A
--     monthly cycle is assumed, which is what every plan sells.
--
-- ── What changes ─────────────────────────────────────────────────────────────
--
--   tier      old ceiling   new ceiling
--   free      5,000         5,000      (Beginner: unchanged)
--   starter   50,000        10,000     ← drops
--   pro       250,000       50,000     ← drops
--   premium   —             250,000    (new tier; no org can hold it yet)
--   scale     unlimited     unlimited
--
-- The two that drop are why this audit exists: nobody's data changes, but a
-- workspace on `starter` loses 40,000 emails of monthly headroom and one on
-- `pro` loses 200,000 at its next period.

BEGIN TRANSACTION READ ONLY;

WITH active_sub AS (
  SELECT DISTINCT ON (s.organization_id)
         s.organization_id,
         p.tier,
         s.current_period_start,
         s.current_period_end,
         count(*) OVER (PARTITION BY s.organization_id) AS active_count
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
   WHERE s.status = 'active'
   ORDER BY s.organization_id, s.updated_at DESC
),
windowed AS (
  SELECT a.organization_id,
         a.tier,
         a.active_count,
         CASE
           WHEN a.current_period_start IS NOT NULL
            AND a.current_period_end IS NOT NULL
            AND a.current_period_start < a.current_period_end
           THEN GREATEST(
                  a.current_period_start,
                  (SELECT max(m)
                     FROM generate_series(a.current_period_start, now(), interval '1 month') AS m
                    WHERE m <= now())
                )
           ELSE date_trunc('month', now() AT TIME ZONE 'UTC')
         END AS period_start
    FROM active_sub a
),
ceilings (tier, old_ceiling, new_ceiling) AS (
  VALUES ('free',    5000::bigint,   5000::bigint),
         ('starter', 50000::bigint,  10000::bigint),
         ('pro',     250000::bigint, 50000::bigint),
         ('premium', NULL::bigint,   250000::bigint),
         ('scale',   NULL::bigint,   NULL::bigint)
)
SELECT
  o.id                                             AS organization_id,
  o.name                                           AS organization_name,
  o.slug                                           AS organization_slug,
  w.tier,
  CASE w.tier::text
    WHEN 'free'    THEN 'Beginner'
    WHEN 'starter' THEN 'Starter'
    WHEN 'pro'     THEN 'Pro'
    WHEN 'premium' THEN 'Premium'
    WHEN 'scale'   THEN 'Scale'
  END                                              AS plan_display_name,
  w.period_start,
  w.period_start + interval '1 month'              AS period_end,
  COALESCE(m.used, 0)                              AS emails_used_this_period,
  c.old_ceiling,
  c.new_ceiling,
  CASE
    WHEN c.new_ceiling IS NULL THEN NULL
    ELSE round((COALESCE(m.used, 0)::numeric * 100) / c.new_ceiling, 1)
  END                                              AS pct_of_new_ceiling,
  CASE
    WHEN c.new_ceiling IS NULL                       THEN 'unmetered'
    WHEN COALESCE(m.used, 0) > c.new_ceiling         THEN 'over_new_ceiling_today'
    WHEN COALESCE(m.used, 0) >= c.new_ceiling * 0.8  THEN 'above_80pct'
    WHEN COALESCE(m.used, 0) >= c.new_ceiling * 0.5  THEN 'above_50pct'
    ELSE 'within_limits'
  END                                              AS new_ceiling_state,
  COALESCE(m.used, 0) > COALESCE(c.old_ceiling, 9223372036854775807)
                                                   AS already_over_old_ceiling,
  (w.active_count > 1)                             AS dup_active_subscriptions
FROM windowed w
JOIN organizations o   ON o.id = w.organization_id
JOIN ceilings c        ON c.tier = w.tier::text
LEFT JOIN LATERAL (
  SELECT count(*) AS used
    FROM emails e
    JOIN projects p ON p.id = e.project_id
   WHERE p.organization_id = w.organization_id
     AND e.env = 'live'
     AND e.created_at >= w.period_start
     AND e.created_at <  w.period_start + interval '1 month'
) m ON true
WHERE w.tier::text IN ('starter', 'pro')
ORDER BY (c.new_ceiling IS NOT NULL AND COALESCE(m.used, 0) > c.new_ceiling) DESC,
         COALESCE(m.used, 0) DESC,
         o.name;

COMMIT;

-- ── Optional follow-up: resource counts against the new ceilings ─────────────
-- Same question for projects / domains / senders / seats. Nothing is deleted
-- by the migration; this only shows who is already above a new ceiling and
-- therefore cannot create another of that resource.
--
-- BEGIN TRANSACTION READ ONLY;
--
-- WITH active_sub AS (
--   SELECT DISTINCT ON (s.organization_id) s.organization_id, p.tier
--     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
--    WHERE s.status = 'active'
--    ORDER BY s.organization_id, s.updated_at DESC
-- ),
-- counts AS (
--   SELECT o.id,
--          o.name,
--          COALESCE(a.tier, 'free') AS tier,
--          (SELECT count(*) FROM projects pr WHERE pr.organization_id = o.id)                    AS projects,
--          (SELECT count(*) FROM domains d JOIN projects pr ON pr.id = d.project_id
--            WHERE pr.organization_id = o.id)                                                    AS domains,
--          (SELECT count(*) FROM sender_identities si JOIN projects pr ON pr.id = si.project_id
--            WHERE pr.organization_id = o.id AND si.archived_at IS NULL)                         AS senders,
--          (SELECT count(*) FROM organization_members om WHERE om.organization_id = o.id)        AS seats
--     FROM organizations o
--     LEFT JOIN active_sub a ON a.organization_id = o.id
-- )
-- SELECT id, name, tier, projects, domains, senders, seats
--   FROM counts
--  ORDER BY tier, projects DESC, seats DESC;
--
-- COMMIT;
