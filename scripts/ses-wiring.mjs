#!/usr/bin/env node
/**
 * SES -> SNS -> Calder feedback wiring, from scratch.
 *
 * Delivery truth (ADR-035) needs four things that cannot be done from
 * application code: an SNS topic, a subscription of that topic to the public
 * API endpoint, a SES configuration set publishing events into the topic, and
 * that configuration set attached to every identity you send from. This script
 * does all four, in the order the API's security gates require.
 *
 * It shells out to the `aws` CLI (already required by docs/DEPLOYMENT.md) so
 * there is no SDK version to pin and no dependency to install.
 *
 *   node scripts/ses-wiring.mjs plan                  # read-only: what exists, what is missing
 *   node scripts/ses-wiring.mjs apply [--dry-run]     # topic + config set + destination + attach
 *   node scripts/ses-wiring.mjs subscribe [--dry-run] # gate on /ready, then subscribe and confirm
 *   node scripts/ses-wiring.mjs check                 # what the deployed API says right now
 *   node scripts/ses-wiring.mjs test <from> [kind]    # simulator bounce|success|complaint
 *   node scripts/ses-wiring.mjs policy                # IAM policy if you hit AccessDenied
 *
 * ORDER MATTERS: `subscribe` refuses to run until the deployed API reports the
 * topic allowlist as configured. That is not a bug being worked around — the
 * endpoint deliberately will not auto-confirm a subscription from a topic it
 * was not told to trust, because otherwise anyone could point their own topic
 * at the public URL.
 *
 * Env overrides: AWS_REGION, CALDER_API_URL, SES_TOPIC_NAME, SES_CONFIGURATION_SET,
 * SES_IDENTITIES (space separated), SES_EVENT_DESTINATION_NAME.
 */
import { execFileSync } from "node:child_process";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const API_URL = (process.env.CALDER_API_URL ?? "https://api.calder.click").replace(/\/+$/, "");
const TOPIC_NAME = process.env.SES_TOPIC_NAME ?? "calder-ses-events";
const CONFIG_SET = process.env.SES_CONFIGURATION_SET ?? "calder-default";
const DESTINATION_NAME = process.env.SES_EVENT_DESTINATION_NAME ?? "sns-all";
const IDENTITIES = (process.env.SES_IDENTITIES ?? "calder.click intake.calder.click")
  .split(/\s+/)
  .filter(Boolean);

// Everything Calder can act on. SEND gives volume, DELIVERY/BOUNCE/COMPLAINT
// give truth, OPEN/CLICK give engagement, REJECT/RENDERING_FAILURE explain
// failures that never left SES.
const EVENT_TYPES = [
  "SEND",
  "DELIVERY",
  "BOUNCE",
  "COMPLAINT",
  "REJECT",
  "DELIVERY_DELAY",
  "OPEN",
  "CLICK",
  "RENDERING_FAILURE",
];

// SES simulator destinations produce real, deterministic events without
// touching a real inbox. This is how delivery truth gets proven rather than
// asserted: each kind exercises a different branch of applySesEvent.
const SIMULATORS = {
  bounce: {
    address: "bounce@simulator.amazonses.com",
    expect: "BOUNCE -> email.status bounced, suppressions row auto-created",
  },
  success: {
    address: "success@simulator.amazonses.com",
    expect: "DELIVERY -> email.status delivered",
  },
  complaint: {
    address: "complaint@simulator.amazonses.com",
    expect: "COMPLAINT -> suppressions row + organization reputation counter",
  },
};

const AUTH_DENIED = /AuthorizationError|AccessDenied|not authorized|UnauthorizedOperation/i;

const args = process.argv.slice(2);
const command = args[0];
const dryRun = args.includes("--dry-run");

function say(line = "") {
  console.log(line);
}
function head(line) {
  console.log(`\n=== ${line} ===`);
}
function ok(line) {
  console.log(`  ok       ${line}`);
}
function missing(line) {
  console.log(`  MISSING  ${line}`);
}
function warn(line) {
  console.log(`  warn     ${line}`);
}
function die(line) {
  console.error(`\nerror: ${line}`);
  process.exit(1);
}

/**
 * Run `aws <argv>` and parse JSON.
 *
 * Read-only calls (`mutating: false`) always execute, even with --dry-run, so
 * the plan you see is based on the real account. Mutating calls are printed
 * instead of run when --dry-run is set.
 */
function aws(argv, { mutating = true, allowFailure = false } = {}) {
  const full = ["aws", ...argv, "--region", REGION, "--output", "json"];
  const printable = full
    .map((a) => (/[\s{]/.test(a) ? `'${a}'` : a))
    .join(" ");

  if (mutating && dryRun) {
    console.log(`  would run  ${printable}`);
    return null;
  }

  try {
    const stdout = execFileSync(full[0], full.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return stdout ? JSON.parse(stdout) : {};
  } catch (err) {
    const stderr = String(err.stderr ?? err.message).trim();
    if (allowFailure) return { __error: stderr };
    if (AUTH_DENIED.test(stderr)) {
      console.error(
        "\n  The credentials in use are not allowed to do that. Nothing changed.\n" +
          "  Attach the policy printed by `node scripts/ses-wiring.mjs policy` to this user,\n" +
          "  or run the command as an admin/root principal."
      );
    }
    die(`${printable}\n       ${stderr}`);
  }
}

const read = (argv) => aws(argv, { mutating: false, allowFailure: true });

function requireAws() {
  try {
    execFileSync("aws", ["--version"], { stdio: "ignore" });
  } catch {
    die("the `aws` CLI is not on PATH. Install it and configure credentials first.");
  }
}

function account() {
  const out = read(["sts", "get-caller-identity"]);
  const id = out?.Account;
  if (!id) die(`could not determine the AWS account id: ${out?.__error ?? "no output"}`);
  return id;
}

function topicArn() {
  return `arn:aws:sns:${REGION}:${account()}:${TOPIC_NAME}`;
}

function findTopic() {
  const out = read(["sns", "list-topics"]);
  const topics = (out?.Topics ?? []).map((t) => t.TopicArn);
  return topics.find((a) => a.endsWith(`:${TOPIC_NAME}`)) ?? null;
}

function findConfigSet() {
  const out = read(["sesv2", "list-configuration-sets"]);
  const names = (out?.ConfigurationSets ?? []).map((c) => c.ConfigurationSetName);
  return names.includes(CONFIG_SET) ? CONFIG_SET : null;
}

function eventDestinations() {
  const out = read([
    "sesv2",
    "get-configuration-set-event-destinations",
    "--configuration-set-name",
    CONFIG_SET,
  ]);
  return out?.EventDestinations ?? [];
}

function subscriptions(arn) {
  const out = read(["sns", "list-subscriptions-by-topic", "--topic-arn", arn]);
  return out?.Subscriptions ?? [];
}

function identityState(identity) {
  return read(["sesv2", "get-email-identity", "--email-identity", identity]);
}

function isConfirmed(sub) {
  return Boolean(sub?.SubscriptionArn) && !/pending/i.test(sub.SubscriptionArn);
}

// ── plan ────────────────────────────────────────────────────────────────────
async function plan() {
  requireAws();
  head(`SES feedback wiring plan  (region ${REGION})`);
  say(`  account ${account()}`);
  say(`  api     ${API_URL}`);
  say(`  topic   ${TOPIC_NAME}`);
  say(`  config  ${CONFIG_SET}`);

  head("Account");
  const acct = read(["sesv2", "get-account"]);
  if (!acct || acct.__error) {
    warn(`cannot read account: ${acct?.__error ?? "no output"}`);
  } else if (acct.ProductionAccessEnabled !== true) {
    warn("SES is in the sandbox: only verified recipients will receive mail");
  } else {
    ok(`production access enabled, enforcement ${acct.EnforcementStatus ?? "unknown"}`);
  }

  head("Sending identities");
  for (const identity of IDENTITIES) {
    const state = identityState(identity);
    if (!state || state.__error) {
      missing(`${identity} — not found in ${REGION}`);
      continue;
    }
    const dkim = state.DkimAttributes?.Status ?? "unknown";
    const mailFrom = state.MailFromAttributes?.MailFromDomainStatus ?? "not configured";
    if (state.VerifiedForSendingStatus === true && dkim === "SUCCESS") {
      ok(`${identity} — verified, DKIM ${dkim}, MAIL FROM ${mailFrom}`);
    } else {
      warn(`${identity} — verified=${state.VerifiedForSendingStatus} dkim=${dkim}`);
    }
  }

  head("SNS topic");
  const topic = findTopic();
  if (!topic) {
    missing(`topic ${TOPIC_NAME} does not exist`);
  } else {
    ok(`exists ${topic}`);
    const subs = subscriptions(topic).filter((s) => s.Protocol === "https");
    if (subs.length === 0) missing(`no HTTPS subscription — /v1/ses/events is not wired`);
    for (const sub of subs) {
      if (isConfirmed(sub)) ok(`confirmed ${sub.Endpoint}`);
      else missing(`pending confirmation ${sub.Endpoint}`);
    }
  }

  head("Configuration set");
  if (!findConfigSet()) {
    missing(`configuration set ${CONFIG_SET} does not exist`);
  } else {
    ok(`exists ${CONFIG_SET}`);
    const sns = eventDestinations().filter((d) => d.SnsDestination?.TopicArn);
    if (sns.length === 0) missing("no SNS event destination — SES events go nowhere");
    for (const d of sns) ok(`destination ${d.Name} -> ${d.SnsDestination.TopicArn}`);
  }

  head("Deployed API");
  try {
    const res = await fetch(`${API_URL}/ready`, { signal: AbortSignal.timeout(20_000) });
    const body = await res.json();
    const de = body?.checks?.delivery_events;
    if (de?.configured === true) ok(`delivery_events configured (state ${de.state})`);
    else missing(`delivery_events not configured (state ${de?.state})`);
  } catch (err) {
    warn(`could not read ${API_URL}/ready: ${err.message}`);
  }

  head("Next");
  say("  node scripts/ses-wiring.mjs apply        AWS side, idempotent, safe to re-run");
  say("  ...then set the two env vars in Vercel Production and redeploy calder-api");
  say("  node scripts/ses-wiring.mjs subscribe    refuses until that redeploy is live");
  say("  node scripts/ses-wiring.mjs test <verified-from-address>");
}

// ── apply ───────────────────────────────────────────────────────────────────
async function apply() {
  requireAws();
  const topic = topicArn();

  head(`1/4  SNS topic  ${topic}`);
  if (findTopic()) ok("already exists, leaving it alone");
  else {
    aws(["sns", "create-topic", "--name", TOPIC_NAME]);
    ok(dryRun ? "would create" : "created");
  }

  head(`2/4  Configuration set  ${CONFIG_SET}`);
  if (findConfigSet()) ok("already exists, leaving it alone");
  else {
    aws(["sesv2", "create-configuration-set", "--configuration-set-name", CONFIG_SET]);
    ok(dryRun ? "would create" : "created");
  }

  head(`3/4  Event destination  ${DESTINATION_NAME}`);
  const definition = JSON.stringify({
    Enabled: true,
    MatchingEventTypes: EVENT_TYPES,
    SnsDestination: { TopicArn: topic },
  });
  const existing = eventDestinations().find((d) => d.Name === DESTINATION_NAME);
  const destinationAction = existing
    ? "update-configuration-set-event-destination"
    : "create-configuration-set-event-destination";
  aws([
    "sesv2",
    destinationAction,
    "--configuration-set-name",
    CONFIG_SET,
    "--event-destination-name",
    DESTINATION_NAME,
    "--event-destination",
    definition,
  ]);
  const verb2 = existing ? "update" : "create";
  ok(dryRun ? `would ${verb2} -> ${topic}` : `${verb2}d -> ${topic}`);

  head("4/4  Attach configuration set to sending identities");
  for (const identity of IDENTITIES) {
    const state = identityState(identity);
    if (!state || state.__error) {
      warn(`${identity} not found in ${REGION}, skipped`);
      continue;
    }
    if (state.VerifiedForSendingStatus !== true) {
      warn(`${identity} is not verified for sending, skipped`);
      continue;
    }
    aws([
      "sesv2",
      "put-email-identity-configuration-set-attributes",
      "--email-identity",
      identity,
      "--configuration-set-name",
      CONFIG_SET,
    ]);
    ok(dryRun ? `would attach ${identity}` : `${identity} -> ${CONFIG_SET}`);
  }

  head("Now the part only you can do (Vercel)");
  say("  calder-api -> Settings -> Environment Variables -> Production:");
  say("");
  say(`    SES_SNS_TOPIC_ARNS    = ${topic}`);
  say(`    SES_CONFIGURATION_SET = ${CONFIG_SET}`);
  say("");
  say("  Then Redeploy calder-api and wait for Ready.");
  say("  Environment variables are only read when a deployment is created.");
  say("");
  say("  Then: node scripts/ses-wiring.mjs subscribe");
}

// ── subscribe ───────────────────────────────────────────────────────────────
async function subscribe() {
  requireAws();
  const topic = topicArn();
  const endpoint = `${API_URL}/v1/ses/events`;

  head("Gate: is the allowlist live in the deployment?");
  let configured = false;
  try {
    const res = await fetch(`${API_URL}/ready`, { signal: AbortSignal.timeout(20_000) });
    const body = await res.json();
    const de = body?.checks?.delivery_events;
    configured = de?.configured === true;
    say(`  delivery_events state=${de?.state} configured=${configured}`);
  } catch (err) {
    die(`could not read ${API_URL}/ready (${err.message}). Fix that before subscribing.`);
  }
  if (!configured) {
    die(
      [
        `${API_URL} does not have SES_SNS_TOPIC_ARNS yet, so it would refuse to confirm.`,
        "       Set SES_SNS_TOPIC_ARNS and SES_CONFIGURATION_SET in Vercel Production,",
        "       redeploy calder-api, then run this again.",
      ].join("\n")
    );
  }
  ok("allowlist is live");

  head("Subscribe");
  const already = subscriptions(topic).find((s) => s.Endpoint === endpoint);
  if (already && isConfirmed(already)) {
    ok(`already subscribed and confirmed: ${endpoint}`);
    return;
  }
  if (!already) {
    aws([
      "sns",
      "subscribe",
      "--topic-arn",
      topic,
      "--protocol",
      "https",
      "--notification-endpoint",
      endpoint,
    ]);
    ok(`requested subscription for ${endpoint}`);
  }

  head("Wait for the API to confirm (up to 90s)");
  for (let attempt = 1; attempt <= 18; attempt++) {
    const sub = subscriptions(topic).find((s) => s.Endpoint === endpoint);
    if (isConfirmed(sub)) {
      ok(`confirmed: ${sub.SubscriptionArn}`);
      say("\n  Next: node scripts/ses-wiring.mjs test <verified-from-address>");
      return;
    }
    console.log(`  ... ${attempt * 5}s (${sub?.SubscriptionArn ?? "no subscription"})`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  warn("still pending after 90s — check the API logs for 'SNS subscription confirmed'");
}

// ── check ───────────────────────────────────────────────────────────────────
async function check() {
  head(`Deployed API  ${API_URL}`);
  let body;
  try {
    const res = await fetch(`${API_URL}/ready`, { signal: AbortSignal.timeout(20_000) });
    body = await res.json();
  } catch (err) {
    die(`could not read ${API_URL}/ready: ${err.message}`);
  }
  say(`  status: ${body.status}`);
  for (const key of [
    "email_provider",
    "email_provider_reachability",
    "delivery_events",
    "delivery_outcomes",
  ]) {
    const c = body?.checks?.[key];
    if (!c) continue;
    say(`  ${key}: ${c.state}`);
    say(`      ${c.detail}`);
  }
}

// ── test ────────────────────────────────────────────────────────────────────
async function test() {
  const from = args[1];
  const kind = (args[2] ?? "bounce").toLowerCase();
  if (!from) {
    die("usage: node scripts/ses-wiring.mjs test <from@address> [bounce|success|complaint]");
  }
  if (!SIMULATORS[kind]) {
    die(`unknown kind '${kind}'. Use one of: ${Object.keys(SIMULATORS).join(", ")}`);
  }
  requireAws();
  const simulator = SIMULATORS[kind];
  head(`Simulator ${kind}  from ${from}  ->  ${simulator.address}`);
  const out = aws([
    "sesv2",
    "send-email",
    "--from-email-address",
    from,
    "--destination",
    `ToAddresses=${simulator.address}`,
    "--configuration-set-name",
    CONFIG_SET,
    "--content",
    JSON.stringify({
      Simple: {
        Subject: { Data: `Calder SES feedback check (${kind})` },
        Body: {
          Text: {
            Data:
              "SES simulator message. It never reaches a real inbox; it exists to " +
              "prove delivery feedback reaches Calder.",
          },
        },
      },
    }),
  ]);
  ok(`accepted, MessageId ${out?.MessageId ?? "(dry run)"}`);
  say("");
  say(`  Expected within ~60s: ${simulator.expect}`);
  say("  Ledger:   provider_events row with unmatched=false");
  say(`  API:      ${API_URL}/ready delivery_events becomes a measurement, not 'unknown'`);
  say("");
  say("  node scripts/ses-wiring.mjs check");
}

// ── policy ──────────────────────────────────────────────────────────────────
/**
 * The least-privilege IAM policy this setup needs. Printed rather than applied:
 * attaching IAM policy is an account-level decision, and a script that silently
 * widens its own permissions is a bad neighbour.
 */
function policyDocument() {
  const acct = account();
  const topic = `arn:aws:sns:${REGION}:${acct}:${TOPIC_NAME}`;
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ReadSesAndSnsState",
        Effect: "Allow",
        Action: [
          "sns:ListTopics",
          "sns:GetTopicAttributes",
          "sns:ListSubscriptionsByTopic",
          "ses:GetAccount",
          "ses:ListEmailIdentities",
          "ses:GetEmailIdentity",
          "ses:ListConfigurationSets",
          "ses:GetConfigurationSetEventDestinations",
        ],
        Resource: "*",
      },
      {
        // CreateTopic does not support resource-level permissions.
        Sid: "CreateTopic",
        Effect: "Allow",
        Action: ["sns:CreateTopic"],
        Resource: "*",
      },
      {
        Sid: "SubscribeOurTopic",
        Effect: "Allow",
        Action: ["sns:Subscribe"],
        Resource: topic,
      },
      {
        Sid: "ConfigurationSetWiring",
        Effect: "Allow",
        Action: [
          "ses:CreateConfigurationSet",
          "ses:PutConfigurationSetEventDestination",
          "ses:PutEmailIdentityConfigurationSetAttributes",
        ],
        Resource: "*",
      },
      {
        Sid: "SimulatorTestSend",
        Effect: "Allow",
        Action: ["ses:SendEmail"],
        Resource: "*",
      },
    ],
  };
}

function policy() {
  requireAws();
  head("Attach this to the IAM user running the setup");
  say("  Console -> IAM -> Users -> <user> -> Add permissions -> Create inline policy -> JSON");
  say("");
  say(JSON.stringify(policyDocument(), null, 2));
  say("");
  say("  Then: node scripts/ses-wiring.mjs apply");
}

const commands = { plan, apply, subscribe, check, test, policy };
if (!command || !commands[command]) {
  say("usage: node scripts/ses-wiring.mjs <plan|apply|subscribe|check|test|policy> [--dry-run]");
  say("");
  say("  plan       read-only inventory: identities, topic, config set, deployed API");
  say("  apply      topic + config set + event destination + attach to identities");
  say("  subscribe  gate on the deployed allowlist, then subscribe and wait for confirmation");
  say("  check      what the deployed API reports right now");
  say("  test       simulator send: bounce | success | complaint (default bounce)");
  say("  policy     print the least-privilege IAM policy this setup needs");
  say("");
  say(`  region ${REGION}   api ${API_URL}   config set ${CONFIG_SET}`);
  process.exit(command ? 1 : 0);
}

await commands[command]();
