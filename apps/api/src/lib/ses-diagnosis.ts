/**
 * The facts needed to explain a failing SES call, gathered without echoing a
 * single secret.
 *
 * Written after an outage where every send failed for hours and the only trace
 * was the word "provider_error". Nothing in the system could say whether the
 * key was dead, the identity unverified, the region wrong or the configuration
 * set missing — four causes that look identical from the outside and have four
 * different fixes. `diagnose:ses` exists so that question takes one command.
 */

/** Names of the configuration-set variables the provider reads, in priority order. */
export const CONFIG_SET_VARS = [
  "SES_CONFIGURATION_SET_TRANSACTIONAL",
  "SES_CONFIGURATION_SET_BROADCAST",
  "SES_CONFIGURATION_SET",
] as const;

export interface ConfigSetVar {
  name: string;
  /** Set but empty counts as unset: the provider treats it the same way. */
  value: string | null;
}

export interface SesEnvSummary {
  region: string;
  /** True when the default was used rather than an explicit variable. */
  regionIsDefault: boolean;
  /** Last four characters only. The rest of an access key is a credential. */
  accessKeyTail: string | null;
  secretSet: boolean;
  /** Set when credentials come from the environment rather than an instance role. */
  configSets: ConfigSetVar[];
  /** Any other variable worth knowing about, reported by presence alone. */
  flags: { name: string; set: boolean }[];
}

/**
 * Last four characters of a credential, never more.
 *
 * Four is enough to answer "is this the key I rotated this morning?" and too
 * few to reconstruct anything. Anything shorter than eight characters is
 * refused entirely rather than truncated.
 */
export function maskTail(value: string | undefined | null): string | null {
  if (typeof value !== "string" || value.length < 8) return null;
  return value.slice(-4);
}

export function summarizeSesEnv(env: NodeJS.ProcessEnv): SesEnvSummary {
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
  const regionIsDefault = !env.AWS_REGION?.trim() && !env.AWS_DEFAULT_REGION?.trim();
  const secret = env.AWS_SECRET_ACCESS_KEY?.trim();

  return {
    region,
    regionIsDefault,
    accessKeyTail: maskTail(env.AWS_ACCESS_KEY_ID?.trim()),
    secretSet: Boolean(secret && secret.length > 0),
    configSets: CONFIG_SET_VARS.map((name) => ({
      name,
      value: env[name]?.trim() ? env[name]!.trim() : null,
    })),
    flags: ["AWS_SESSION_TOKEN", "AWS_PROFILE"].map((name) => ({
      name,
      set: Boolean(env[name]?.trim()),
    })),
  };
}

/** One line per fact, for a terminal. No secret ever reaches this string. */
export function formatSesEnv(summary: SesEnvSummary): string[] {
  const lines = [
    `region        ${summary.region}${summary.regionIsDefault ? "  (default — AWS_REGION is not set)" : ""}`,
    `access key    ${summary.accessKeyTail ? `…${summary.accessKeyTail}` : "not set in the environment"}`,
    `secret key    ${summary.secretSet ? "set" : "NOT SET"}`,
  ];
  for (const flag of summary.flags) {
    if (flag.set) lines.push(`${flag.name.padEnd(13)} set`);
  }
  const sets = summary.configSets.filter((c) => c.value);
  if (sets.length === 0) {
    lines.push("config set    none configured (sends will omit ConfigurationSetName)");
  } else {
    for (const c of sets) lines.push(`config set    ${c.value}  (${c.name})`);
  }
  return lines;
}
