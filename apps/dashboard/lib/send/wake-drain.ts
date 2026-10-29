import { after } from "next/server";
import { wakeDeliveryDrain } from "@calder/queue";
import { logger } from "@calder/observability";

/** Register inside the request so Next keeps the wake-up alive after response. */
export function scheduleDeliveryDrain(): void {
  after(async () => {
    const result = await wakeDeliveryDrain();
    if (!result.ok) logger.warn(result, "Dashboard delivery drain wake-up failed");
  });
}
