// Selected merged-main history, not a claim that every feature is deployed.
export const CHANGELOG = [
  {
    date: "2026-10-28",
    title: "Production API packaging and diagnostics",
    points: [
      "Added a tracked Vercel function entry so discovery no longer depends on a generated file.",
      "Embedded the OpenAPI document in the serverless bundle to fix cold-start failures when the source JSON is absent.",
      "Improved readiness/deploy verification and provider failure diagnostics. Liveness, dependency readiness, provider acceptance and inbox delivery remain distinct.",
    ],
    commits: ["d16774cae8", "646b4fe52b", "277db97caf", "35b54cd0cb", "faa5cf1e3c"],
  },
  {
    date: "2026-10-27",
    title: "Configuration, schema and dependency repairs",
    points: [
      "Upgraded first-party Zod usage to the patched v4 release and corrected organization-profile schema gaps.",
      "Updated CSP and the five-tier configuration catalogue. A catalogue entry is not an active payment subscription.",
    ],
    commits: ["2c829ec627", "2833ed1c02", "b27c0e9cf8"],
  },
  {
    date: "2026-10-26",
    title: "Source integrity and migration checks",
    points: [
      "Added source/history integrity scans, pinned CI actions, schema-coverage checks and review ownership for sensitive paths.",
      "Repaired migration generation/build prerequisites and strengthened post-deploy verification.",
    ],
    commits: ["9f6d2e6607", "017c77513c", "834ed4695f", "d184451fa8", "04624db2e0"],
  },
  {
    date: "2026-10-22–23",
    title: "Sender, message and marketing foundations",
    points: [
      "Added plan-limited sender identities, message filters/detail/resend/CSV export and reason-aware suppression controls.",
      "Implemented audience consent/history and broadcast/reporting code plus company-email/control tooling. Marketing production rollout remains unverified and publicly marked in development.",
    ],
    commits: ["61e8243528", "de73b8d33c", "de588d88fa", "1681c15734", "311a459d54", "995c4247f4"],
  },
  {
    date: "2026-10-03–19",
    title: "Abuse controls and operational hardening",
    points: [
      "Added sending safeguards, operational checks and dashboard improvements; corrected simulated-send and provider-accepted-versus-delivered wording.",
      "Added SES stream configuration/setup tooling and stuck-message detection. Provider-event and infrastructure configuration still require deployment validation.",
    ],
    commits: ["542c73670c", "2da0af47ec", "21daba66e3", "63e76482fe", "c01301f601", "137da8c3b6"],
  },
  {
    date: "2026-09-25–30",
    title: "Delivery correctness and SDK source",
    points: [
      "Added transactional/marketing stream separation, safer SES retry classification and delivery-path tests.",
      "Authored SDK source and corrected API response-envelope handling. This records source implementation, not registry publication or a production SDK support commitment.",
      "Fixed test-mode sender tests and strengthened auth/schema migration handling.",
    ],
    commits: ["f70c11907e", "124290b4ba", "25ce1bd368", "ffa9d22a43", "743d61c882", "462a8c9b9a"],
  },
  {
    date: "2026-09-09–19",
    title: "Dashboard and control-plane expansion",
    points: [
      "Added team invites, organization/project controls and founder/admin operational views.",
      "Expanded dashboard message, template and delivery data views and documented the production-readiness roadmap.",
    ],
    commits: ["63c3bca85c", "d2a9977134", "c0bbc98c93", "f0a01ad133"],
  },
  {
    date: "2026-09-06–08",
    title: "Foundation and first pipeline",
    points: [
      "Created the monorepo and public site, rebranded Avenor to Calder, and added onboarding, domain/key/usage dashboard pages and Redis delivery foundations.",
      "Documented an SMTP gateway program; this did not deploy a public SMTP service.",
    ],
    commits: ["53c3c5714b", "a3eb44b529", "7367a7f3eb", "9c3b1635da", "be8be5acd7", "9b6964e29e"],
  },
] as const;
