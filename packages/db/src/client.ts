import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

let client: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

function getConnectionString(): string {
  return process.env.DATABASE_URL ?? "postgresql://avenor:avenor@localhost:5432/avenor";
}

export function getDb(): DbClient {
  if (dbInstance) return dbInstance;
  const url = getConnectionString();
  client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}

/**
 * Lazy db singleton for convenience. Prefer getDb() in app code.
 */
export const db = new Proxy({} as DbClient, {
  get(_target, prop) {
    const instance = getDb();
    const value = (instance as unknown as Record<string, unknown>)[prop as string];
    if (typeof value === "function") return (value as (...a: unknown[]) => unknown).bind(instance);
    return value;
  },
});

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    dbInstance = null;
  }
}
