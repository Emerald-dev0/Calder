import { getConfig } from "@calder/config";
import { logger } from "@calder/observability";
import { startWorker } from "./worker.js";
import { startWebhookConsumer } from "./webhook-consumer.js";
import { createHealthServer } from "./health.js";

const config = getConfig();

async function main() {
  logger.info({ env: config.NODE_ENV }, "Starting Calder worker...");

  // Start health server (liveness/readiness for worker)
  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 3003);
  const healthServer = createHealthServer();
  healthServer.listen(healthPort, () => {
    logger.info({ port: healthPort }, `Worker health server listening on :${healthPort}`);
  });

  // Start queue consumers: email:send + webhook:deliver (M3.1).
  await startWorker();
  try {
    startWebhookConsumer();
  } catch (err) {
    logger.error({ err }, "Webhook consumer failed to start; email worker unaffected");
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down worker...");
    healthServer.close();
    // Queue close handled in worker
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Worker failed to start");
  process.exit(1);
});
