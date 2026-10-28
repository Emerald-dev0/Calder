/**
 * Which part of the SES call is broken?
 *
 *   pnpm --filter @calder/api diagnose:ses -- \
 *     --from "Intake <noreply@intake.calder.click>" --to you@example.com
 *
 * Run this with the environment the deployment runs with (`vercel env pull`, a
 * shell that exports the same variables, or the same values pasted into your
 * shell). It walks the send path in the order a failure can occur and stops at
 * the first one:
 *
 *   1. environment      — which region, which key, which configuration set
 *   2. GetAccount       — is sending enabled, is the account in the sandbox
 *   3. GetEmailIdentity — is the From domain verified for sending
 *   4. GetConfigurationSet — does the set every send attaches actually exist
 *   5. Send             — through @calder/providers, the same code the drain uses
 *
 * The first four answer "is the configuration right?"; only the fifth answers
 * "can this exact message leave?", which is the question the panel could not
 * answer while every send failed with `provider_error`.
 *
 * Nothing here is imported by the running API: it is an operator tool.
 */
import {
  GetAccountCommand,
  GetConfigurationSetCommand,
  GetEmailIdentityCommand,
  SESv2Client,
} from "@aws-sdk/client-sesv2";
import { createSesProvider } from "@calder/providers";
import { formatSesEnv, summarizeSesEnv } from "../lib/ses-diagnosis.js";

interface Args {
  from: string;
  to: string | null;
  region: string | null;
  send: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : null;
  };
  const to = get("to");
  return {
    from: get("from") ?? "",
    to,
    region: get("region"),
    send: Boolean(to),
  };
}

/** `Name <addr@domain>` → `domain`, so the identity check asks about the right thing. */
function domainOf(from: string): string | null {
  const address = from.includes("<")
    ? from.slice(from.indexOf("<") + 1, from.lastIndexOf(">"))
    : from;
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain.includes(".") ? domain : null;
}

function describeError(err: unknown): string {
  const e = err as {
    name?: string;
    message?: string;
    code?: string;
    statusCode?: number;
    $metadata?: { httpStatusCode?: number; requestId?: string };
  };
  const status = e.$metadata?.httpStatusCode ?? e.statusCode;
  const parts = [e.code && e.code !== e.name ? `${e.code}` : null, e.name ?? "Error"];
  const head = status
    ? `${parts.filter(Boolean).join(" ")} (HTTP ${status})`
    : parts.filter(Boolean).join(" ");
  // The message is the point of the exercise and this is the operator's own
  // terminal — but it is never written anywhere by this script.
  return e.message ? `${head}: ${e.message}` : head;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.from) {
    console.error('usage: diagnose:ses -- --from "Sender <addr@domain>" [--to you@example.com]');
    process.exitCode = 2;
    return;
  }

  const summary = summarizeSesEnv(process.env);
  const region = args.region ?? summary.region;
  console.log("environment");
  for (const line of formatSesEnv(summary)) console.log(`  ${line}`);
  console.log(`  region used   ${region}${args.region ? "  (--region override)" : ""}`);

  const client = new SESv2Client({ region });
  let failed = false;

  const step = async (label: string, run: () => Promise<string>): Promise<void> => {
    try {
      console.log(`\n${label}\n  ok    ${await run()}`);
    } catch (err) {
      failed = true;
      console.log(`\n${label}\n  FAIL  ${describeError(err)}`);
      throw new Error("stop");
    }
  };

  try {
    await step("account", async () => {
      const out = await client.send(new GetAccountCommand({}));
      const quota = out.SendQuota;
      return [
        `sending ${out.SendingEnabled ? "enabled" : "DISABLED"}`,
        out.ProductionAccessEnabled ? "production access" : "SANDBOX — only verified recipients",
        quota ? `${quota.SentLast24Hours ?? 0}/${quota.Max24HourSend ?? 0} sent in 24h` : null,
      ]
        .filter(Boolean)
        .join(", ");
    });

    const domain = domainOf(args.from);
    if (domain) {
      await step(`identity ${domain}`, async () => {
        const out = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
        return `verification ${out.VerificationStatus ?? "unknown"}, sending ${
          out.VerifiedForSendingStatus ? "verified" : "NOT verified"
        }`;
      });
    }

    const configSets = summary.configSets.filter((c) => c.value);
    for (const set of configSets) {
      await step(`configuration set ${set.value}`, async () => {
        const out = await client.send(
          new GetConfigurationSetCommand({ ConfigurationSetName: set.value! })
        );
        return `exists (${out.ConfigurationSetName ?? set.value})`;
      });
    }

    if (args.send && args.to) {
      await step(`send ${args.from} → ${args.to}`, async () => {
        const provider = createSesProvider(region);
        const result = await provider.send({
          from: args.from,
          to: args.to!,
          subject: "Calder send diagnostic",
          text: "If you can read this, the provider path works end to end.",
          html: "<p>If you can read this, the provider path works end to end.</p>",
          stream: "transactional",
        });
        return `accepted, MessageId ${result.providerMessageId}`;
      });
    } else {
      console.log("\nsend\n  skipped  (pass --to <address> to send one real message)");
    }
  } catch {
    // `step` already printed the failing call; the verdict is the only thing left.
  }

  console.log(failed ? "\nverdict: FAILED at the step above." : "\nverdict: every step passed.");
  if (failed) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(describeError(err));
  process.exitCode = 1;
});
