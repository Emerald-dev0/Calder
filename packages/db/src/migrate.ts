import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, closeDb } from "./client.js";

async function main() {
  console.log("Running migrations...");
  const db = getDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await closeDb();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
