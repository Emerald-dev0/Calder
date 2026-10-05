import { describe, it, expect, afterEach } from "vitest";
import {
  assertQueueBootConfig,
  describeBoot,
  getConfig,
  getDeployEnv,
  getRedisUrl,
  isHostedEnv,
  redisRequiredFor,
  redisTargetLabel,
  resetConfig,
  ConfigurationError,
} from "./index.js";

const ORIGINAL = { ...process.env };

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetConfig();
});

describe("deployment environment", () => {
  it("derives development/test/production from NODE_ENV", () => {
    setEnv({ NODE_ENV: "development", CALDER_ENV: undefined });
    expect(getDeployEnv()).toBe("development");
    setEnv({ NODE_ENV: "test", CALDER_ENV: undefined });
    expect(getDeployEnv()).toBe("test");
    setEnv({ NODE_ENV: "production", CALDER_ENV: undefined });
    expect(getDeployEnv()).toBe("production");
  });

  it("staging is what a production build on separate infrastructure sets explicitly", () => {
    setEnv({ NODE_ENV: "production", CALDER_ENV: "staging" });
    expect(getDeployEnv()).toBe("staging");
    expect(isHostedEnv()).toBe(true);
  });

  it("refuses contradictory combinations instead of guessing", () => {
    setEnv({ NODE_ENV: "development", CALDER_ENV: "production" });
    expect(() => getDeployEnv()).toThrow(/requires NODE_ENV=production/);

    setEnv({ NODE_ENV: "development", CALDER_ENV: "staging" });
    expect(() => getDeployEnv()).toThrow(/requires a production build/);

    setEnv({ NODE_ENV: "production", CALDER_ENV: "development" });
    expect(() => getDeployEnv()).toThrow(/not allowed with NODE_ENV=production/);
  });
});

describe("redis requirement", () => {
  it("is optional in development and test", () => {
    setEnv({ NODE_ENV: "development", CALDER_ENV: undefined, REDIS_URL: undefined });
    expect(getRedisUrl()).toBeNull();
    expect(redisRequiredFor("api")).toBe(false);
    expect(assertQueueBootConfig("api")).toBeNull();
  });

  it("fails loudly in staging without REDIS_URL", () => {
    setEnv({ NODE_ENV: "production", CALDER_ENV: "staging", REDIS_URL: undefined });
    expect(() => assertQueueBootConfig("api")).toThrow(ConfigurationError);
    expect(() => assertQueueBootConfig("api")).toThrow(/REDIS_URL is required in staging/);
    expect(() => assertQueueBootConfig("worker")).toThrow(/REDIS_URL is required in staging/);
  });

  it("fails loudly in production without REDIS_URL", () => {
    setEnv({ NODE_ENV: "production", CALDER_ENV: undefined, REDIS_URL: undefined });
    expect(() => assertQueueBootConfig("api")).toThrow(/REDIS_URL is required in production/);
  });

  it("never treats a blank REDIS_URL as configured", () => {
    setEnv({ NODE_ENV: "production", CALDER_ENV: undefined, REDIS_URL: "   " });
    expect(getRedisUrl()).toBeNull();
    expect(() => assertQueueBootConfig("worker")).toThrow(/REDIS_URL is required/);
  });

  it("rejects a non-redis scheme in any environment", () => {
    setEnv({ NODE_ENV: "development", REDIS_URL: "postgresql://calder:secret@localhost/calder" });
    expect(() => assertQueueBootConfig("api")).toThrow(/redis:\/\/ or rediss:\/\//);
  });

  it("accepts redis:// and rediss:// and returns the URL for the caller", () => {
    setEnv({ NODE_ENV: "production", REDIS_URL: "rediss://default:secret@redis.example:6380" });
    expect(assertQueueBootConfig("worker")).toBe("rediss://default:secret@redis.example:6380");
  });

  it("the marketing site never requires redis", () => {
    setEnv({ NODE_ENV: "production", REDIS_URL: undefined });
    expect(redisRequiredFor("web")).toBe(false);
    expect(assertQueueBootConfig("web")).toBeNull();
  });
});

describe("credential-free reporting", () => {
  it("describes boot state without exposing secrets", () => {
    setEnv({
      NODE_ENV: "production",
      CALDER_ENV: "staging",
      REDIS_URL: "rediss://default:supersecret@redis.example:6380",
    });
    const summary = describeBoot("api");
    expect(summary).toEqual({
      service: "api",
      deployEnv: "staging",
      nodeEnv: "production",
      queueDriver: "redis",
      redisRequired: true,
      errorTracking: false,
    });
    expect(JSON.stringify(summary)).not.toContain("supersecret");
  });

  it("labels redis targets as host:port only", () => {
    expect(redisTargetLabel("rediss://default:supersecret@redis.example:6380")).toBe(
      "rediss://redis.example:6380"
    );
    expect(redisTargetLabel(null)).toBe("unset");
    expect(redisTargetLabel("not a url")).toBe("invalid");
  });
});

describe("alert thresholds", () => {
  it("have safe defaults and are overridable", () => {
    setEnv({ QUEUE_DEPTH_WARN: undefined, QUEUE_OLDEST_JOB_WARN_MINUTES: undefined });
    expect(getConfig().QUEUE_DEPTH_WARN).toBe(500);
    expect(getConfig().QUEUE_OLDEST_JOB_WARN_MINUTES).toBe(15);

    setEnv({ QUEUE_DEPTH_WARN: "25", QUEUE_OLDEST_JOB_WARN_MINUTES: "2.5" });
    expect(getConfig().QUEUE_DEPTH_WARN).toBe(25);
    expect(getConfig().QUEUE_OLDEST_JOB_WARN_MINUTES).toBe(2.5);
  });
});
